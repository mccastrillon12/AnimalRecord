import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import {
  AnimalWriteJournal,
  ANIMAL_WRITE_PROTOCOL,
} from '../../animal-transfer/domain/animal-write-journal';
import { ANIMAL_WRITE_JOURNAL_MODEL } from '../../animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';
import { AnimalOwnershipControlEntity } from '../../animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  AnimalMediaUpload,
  MediaRevision,
} from '../domain/animal-media-upload';
import {
  MediaPromotionScope,
  promotionId,
  promotionJournalBinding,
  promotionScope,
  promotionDefinition,
  promotionDefinitionHash,
} from '../domain/media-promotion-effect';
import {
  MediaPromotionCommand,
  advanceMediaPromotion,
} from '../domain/media-promotion-machine';
import {
  MEDIA_PROMOTION_STORAGE_PROTOCOL,
  MediaPromotionPersistence,
  PromotionAudit,
  PromotionAttemptRow,
  PromotionEffectRow,
  PromotionGateRow,
  PromotionObservationRow,
  PromotionRow,
  PromotionSelection,
  PromotionStoredCommand,
  assertPromotionSelection,
  decodePromotionAudit,
  decodePromotionRow,
  promotionInteger,
  promotionTransitionView,
  validatePromotionObservation,
  validatePromotionSelection,
} from '../domain/media-promotion-persistence';
import { ANIMAL_MEDIA_UPLOAD_MODEL } from './mongo-animal-media-upload-repository';
import { MEDIA_PROMOTION_RECORD_MODEL } from './media-promotion-record.schema';
import {
  capturePromotionSealSubject,
  MediaPromotionSealingPersistence,
  PromotionMatch,
  PromotionSealSubject,
} from '../domain/media-promotion-sealing';

@Injectable()
export class MongoMediaPromotionPersistence
  implements MediaPromotionPersistence, MediaPromotionSealingPersistence
{
  constructor(
    @InjectModel(MEDIA_PROMOTION_RECORD_MODEL)
    private readonly records: Model<PromotionRow>,
    @InjectModel(ANIMAL_WRITE_JOURNAL_MODEL)
    private readonly journals: Model<AnimalWriteJournal>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(ANIMAL_MEDIA_UPLOAD_MODEL)
    private readonly uploads: Model<AnimalMediaUpload>,
  ) {}

  async open(input: PromotionSelection): Promise<PromotionGateRow> {
    const selection = validatePromotionSelection(input);
    return this.transaction(async (session) => {
      if (await this.find({ id: selection.operationId }, session))
        throw new ConflictError(
          'The promotion gate already exists; read its evidence',
        );
      const scope = await this.fenceJournal(
        selection,
        undefined,
        true,
        session,
      );
      await this.fenceControl(scope, session);
      const gate: PromotionGateRow = {
        id: selection.operationId,
        identityIds: [selection.operationId],
        operationId: selection.operationId,
        protocol: MEDIA_PROMOTION_STORAGE_PROTOCOL,
        kind: 'GATE',
        gateRevision: 0,
        data: { scope, gate: { state: 'OPEN' }, effectCount: 0 },
      };
      await this.insert(gate, session);
      return gate;
    });
  }

  async revoke(
    input: PromotionSelection,
    expectedRevision: number | undefined,
    inputAudit: PromotionAudit,
  ): Promise<PromotionGateRow> {
    const selection = validatePromotionSelection(input),
      audit = decodePromotionAudit(inputAudit);
    return this.transaction(async (session) => {
      const existing = await this.loadGate(selection, session);
      if (!existing) {
        if (expectedRevision !== undefined)
          throw new ConflictError('The promotion gate is missing');
        const scope = await this.fenceJournal(
          selection,
          undefined,
          false,
          session,
        );
        const gate: PromotionGateRow = {
          id: selection.operationId,
          identityIds: [selection.operationId, audit.requestId],
          operationId: selection.operationId,
          protocol: MEDIA_PROMOTION_STORAGE_PROTOCOL,
          kind: 'GATE',
          gateRevision: 1,
          data: { scope, gate: { state: 'REVOKED', ...audit }, effectCount: 0 },
        };
        await this.insert(gate, session);
        return gate;
      }
      const next = advanceMediaPromotion(
        promotionTransitionView(existing),
        expectedRevision!,
        {
          type: 'REVOKE',
          requestId: audit.requestId,
          evidenceRef: audit.evidenceRef,
        },
      );
      const gate: PromotionGateRow = {
        ...existing,
        identityIds: [existing.id, audit.requestId],
        gateRevision: next.revision,
        data: { ...existing.data, gate: { state: 'REVOKED', ...audit } },
      };
      await this.saveGate(existing, gate, session);
      return gate;
    });
  }

  async apply(
    input: PromotionSelection,
    expectedRevision: number,
    inputCommand: PromotionStoredCommand,
  ): Promise<PromotionGateRow> {
    const selection = validatePromotionSelection(input);
    const command = structuredClone(inputCommand);
    promotionInteger(expectedRevision);
    return this.transaction(async (session) => {
      const gate = await this.loadGate(selection, session);
      if (!gate || gate.gateRevision !== expectedRevision)
        throw new ConflictError('The promotion gate revision changed');
      const authorizing = [
        'DECLARE_EFFECT',
        'INTEND_ATTEMPT',
        'AUTHORIZE_ATTEMPT',
      ].includes(command.type);
      if (authorizing) {
        if (gate.data.gate.state !== 'OPEN')
          throw new ConflictError('The promotion gate is revoked');
        await this.fenceJournal(selection, gate.data.scope, true, session);
        await this.fenceControl(gate.data.scope, session);
      }
      let effect: PromotionEffectRow | undefined,
        attempt: PromotionAttemptRow | undefined;
      let pure: MediaPromotionCommand;
      if (command.type === 'DECLARE_EFFECT') {
        promotionId(command.effectId);
        promotionId(command.uploadId);
        const upload = await this.uploads
          .findOne({ id: command.uploadId })
          .session(session)
          .read('primary')
          .lean()
          .exec();
        if (!upload) throw new ConflictError('The promotion upload is missing');
        pure = {
          type: 'DECLARE_EFFECT',
          effectId: command.effectId,
          upload,
          bucket: command.bucket,
        };
      } else {
        effect = await this.effect(command.effectId, gate, session);
        if (command.type === 'INTEND_ATTEMPT') {
          if (effect.data.lastAttemptId)
            attempt = await this.attempt(
              effect.data.lastAttemptId,
              effect,
              gate,
              session,
            );
        } else if (command.type !== 'OBSERVE_DESTINATION') {
          attempt = await this.attempt(
            command.attemptId,
            effect,
            gate,
            session,
          );
          if (
            command.type === 'AUTHORIZE_ATTEMPT' &&
            promotionId(command.dispatcherInstanceId) !==
              attempt.data.dispatcherInstanceId
          )
            throw new ConflictError(
              'The promotion dispatcher instance changed',
            );
        }
        pure = command;
      }
      const next = advanceMediaPromotion(
        promotionTransitionView(gate, effect, attempt),
        expectedRevision,
        pure,
      );
      if (authorizing) {
        const declared =
          command.type === 'DECLARE_EFFECT' ? next.effects[0] : undefined;
        await this.fenceUpload(
          gate.data.scope,
          declared?.id ?? effect!.id,
          declared?.definitionHash ?? effect!.data.definitionHash,
          declared?.definition.bucket ?? effect!.bucket,
          declared?.definition.uploadId ?? effect!.uploadId,
          session,
        );
      }
      const changedGate: PromotionGateRow = {
        ...gate,
        gateRevision: next.revision,
        data: { ...gate.data },
      };
      const base = {
        operationId: gate.operationId,
        protocol: MEDIA_PROMOTION_STORAGE_PROTOCOL,
        gateRevision: next.revision,
      };
      if (command.type === 'DECLARE_EFFECT') {
        const e = next.effects[0];
        changedGate.data.effectCount = promotionInteger(
          gate.data.effectCount + 1,
        );
        await this.insert(
          {
            ...base,
            id: e.id,
            identityIds: [e.id],
            kind: 'EFFECT',
            effectId: e.id,
            uploadId: e.definition.uploadId,
            bucket: e.definition.bucket,
            destinationKey: e.definition.destinationKey,
            data: {
              definition: e.definition,
              definitionHash: e.definitionHash,
              attemptCount: 0,
            },
          },
          session,
          changedGate,
        );
      } else if (command.type === 'INTEND_ATTEMPT') {
        const ordinal = promotionInteger(effect!.data.attemptCount + 1, 1);
        const newAttempt =
          next.effects[0].attempts[next.effects[0].attempts.length - 1];
        await this.insert(
          {
            ...base,
            id: newAttempt.id,
            identityIds: [newAttempt.id],
            kind: 'ATTEMPT',
            effectId: effect!.id,
            ordinal,
            data: {
              dispatcherInstanceId: newAttempt.dispatcherInstanceId,
              origin: newAttempt.origin,
              ...(newAttempt.previousAttemptId === undefined
                ? {}
                : { previousAttemptId: newAttempt.previousAttemptId }),
            },
          },
          session,
          changedGate,
        );
        await this.updateRow(
          effect!,
          {
            $set: {
              'data.attemptCount': ordinal,
              'data.lastAttemptId': newAttempt.id,
              gateRevision: next.revision,
            },
          },
          session,
        );
      } else if (command.type === 'AUTHORIZE_ATTEMPT') {
        await this.updateRow(
          attempt!,
          {
            $set: {
              authorizationId: command.authorizationId,
              identityIds: [attempt!.id, command.authorizationId],
              gateRevision: next.revision,
            },
          },
          session,
        );
      } else if (command.type === 'RECORD_RESPONSE') {
        const response = next.effects[0].attempts[0].responses[0];
        await this.insert(
          {
            ...base,
            id: response.id,
            identityIds: [response.id],
            kind: 'RESPONSE',
            effectId: effect!.id,
            attemptId: attempt!.id,
            data: {
              outcome: response.outcome,
              evidenceRef: response.evidenceRef,
            },
          },
          session,
          changedGate,
        );
      } else {
        const o = next.effects[0].observations[0];
        const row: PromotionObservationRow = {
          ...base,
          id: o.id,
          identityIds: [o.id],
          kind: 'OBSERVATION',
          effectId: effect!.id,
          data:
            o.finding === 'MATCH'
              ? {
                  finding: o.finding,
                  evidenceRef: o.evidenceRef,
                  uploadId: o.uploadId,
                  sha256: o.sha256,
                  revision: o.revision,
                }
              : { finding: o.finding, evidenceRef: o.evidenceRef },
        };
        await this.insert(row, session, changedGate);
      }
      await this.saveGate(gate, changedGate, session);
      return changedGate;
    });
  }

  async readForSeal(
    input: PromotionSelection,
    effectId: string,
  ): Promise<PromotionSealSubject> {
    const selection = validatePromotionSelection(input);
    promotionId(effectId);
    return this.transaction(async (session) => {
      const gate = await this.loadGate(selection, session);
      if (!gate) throw new ConflictError('The promotion gate is missing');
      const effect = await this.effect(effectId, gate, session);
      if (effect.data.lastAttemptId)
        await this.attempt(effect.data.lastAttemptId, effect, gate, session);
      const upload = await this.uploads
        .findOne({ id: effect.uploadId })
        .session(session)
        .read('primary')
        .lean()
        .exec();
      if (
        !upload ||
        promotionDefinitionHash(
          gate.data.scope,
          effect.id,
          promotionDefinition(gate.data.scope, upload, effect.bucket),
        ) !== effect.data.definitionHash
      )
        throw new ConflictError('The promotion verification ticket changed');
      return capturePromotionSealSubject({
        gate,
        effect,
        ticketRevision: upload.mediaPromotionRevision,
      });
    });
  }

  async sealVerified(
    input: PromotionSelection,
    raw: PromotionSealSubject,
    rawObservation: PromotionMatch,
  ): Promise<void> {
    const selection = validatePromotionSelection(input),
      subject = capturePromotionSealSubject(raw);
    assertPromotionSelection(subject.gate, selection);
    const observation = structuredClone(rawObservation);
    if (observation.finding !== 'MATCH')
      throw new ConflictError('Sealing requires a matching observation');
    await this.transaction(async (session) => {
      const gate = await this.loadGate(selection, session);
      if (
        !gate ||
        gate.gateRevision !== subject.gate.gateRevision ||
        JSON.stringify(gate.data.scope) !==
          JSON.stringify(subject.gate.data.scope)
      )
        throw new ConflictError('The verification gate changed');
      const effect = await this.effect(subject.effect.id, gate, session);
      if (effect.data.definitionHash !== subject.effect.data.definitionHash)
        throw new ConflictError('The verification definition changed');
      if (effect.data.lastAttemptId)
        await this.attempt(effect.data.lastAttemptId, effect, gate, session);
      const next = advanceMediaPromotion(
        promotionTransitionView(gate, effect),
        gate.gateRevision,
        { type: 'OBSERVE_DESTINATION', effectId: effect.id, observation },
      );
      const observed = next.effects[0].observations[0];
      if (observed.finding !== 'MATCH')
        throw new ConflictError('Sealing requires a matching observation');
      await this.fenceJournal(selection, gate.data.scope, true, session);
      await this.fenceControl(gate.data.scope, session);
      await this.fenceUpload(
        gate.data.scope,
        effect.id,
        effect.data.definitionHash,
        effect.bucket,
        effect.uploadId,
        session,
        { counter: subject.ticketRevision, revision: observed.revision },
      );
      const changedGate = { ...gate, gateRevision: next.revision };
      await this.insert(
        {
          id: observed.id,
          identityIds: [observed.id],
          operationId: gate.operationId,
          protocol: MEDIA_PROMOTION_STORAGE_PROTOCOL,
          gateRevision: next.revision,
          kind: 'OBSERVATION',
          effectId: effect.id,
          data: {
            finding: 'MATCH',
            evidenceRef: observed.evidenceRef,
            uploadId: observed.uploadId,
            sha256: observed.sha256,
            revision: observed.revision,
          },
        },
        session,
        changedGate,
      );
      await this.saveGate(gate, changedGate, session);
      return true; // The transaction helper requires an explicit local result.
    });
  }

  async read(input: PromotionSelection, recordId?: string) {
    const selection = validatePromotionSelection(input);
    if (recordId !== undefined) promotionId(recordId);
    return this.transaction(async (session) => {
      const gate = await this.loadGate(selection, session);
      const raw =
        recordId === undefined
          ? null
          : await this.find(
              { id: recordId, operationId: selection.operationId },
              session,
            );
      if (!gate && raw)
        throw new ConflictError('A promotion record has no gate');
      const record = raw ? decodePromotionRow(raw, gate!) : null;
      if (record && record.kind !== 'GATE') {
        const effect =
          record.kind === 'EFFECT'
            ? record
            : await this.effect(record.effectId, gate!, session);
        if (gate!.data.effectCount < 1)
          throw new ConflictError(
            'The promotion effect counter is inconsistent',
          );
        if (record.kind === 'EFFECT' && effect.data.lastAttemptId)
          await this.attempt(effect.data.lastAttemptId, effect, gate!, session);
        if (record.kind === 'ATTEMPT')
          await this.attempt(record.id, effect, gate!, session);
        if (record.kind === 'RESPONSE') {
          const attempt = await this.attempt(
            record.attemptId,
            effect,
            gate!,
            session,
          );
          if (
            !attempt.authorizationId ||
            attempt.gateRevision > record.gateRevision
          )
            throw new ConflictError('The response has no authorization');
        }
        if (record.kind === 'OBSERVATION')
          validatePromotionObservation(gate!, effect, record);
      }
      return {
        coverage: 'INCOMPLETE' as const,
        remoteEffects: 'NOT_ASSESSED' as const,
        gate,
        record,
      };
    });
  }

  private async effect(
    id: string,
    gate: PromotionGateRow,
    session: ClientSession,
  ): Promise<PromotionEffectRow> {
    promotionId(id);
    const row = decodePromotionRow(
      await this.find({ id, operationId: gate.operationId }, session),
      gate,
    );
    if (row.kind !== 'EFFECT' || gate.data.effectCount < 1)
      throw new ConflictError(
        'The promotion effect is missing or inconsistent',
      );
    return row;
  }
  private async attempt(
    id: string,
    effect: PromotionEffectRow,
    gate: PromotionGateRow,
    session: ClientSession,
  ): Promise<PromotionAttemptRow> {
    promotionId(id);
    const row = decodePromotionRow(
      await this.find({ id, operationId: gate.operationId }, session),
      gate,
    );
    if (
      row.kind !== 'ATTEMPT' ||
      row.effectId !== effect.id ||
      row.ordinal > effect.data.attemptCount ||
      (row.ordinal === effect.data.attemptCount) !==
        (row.id === effect.data.lastAttemptId)
    )
      throw new ConflictError('The promotion attempt parent changed');
    if (row.data.previousAttemptId) {
      const previous = decodePromotionRow(
        await this.find(
          { id: row.data.previousAttemptId, operationId: gate.operationId },
          session,
        ),
        gate,
      );
      if (
        previous.kind !== 'ATTEMPT' ||
        previous.effectId !== effect.id ||
        previous.ordinal !== row.ordinal - 1 ||
        previous.gateRevision >= row.gateRevision ||
        !previous.authorizationId
      )
        throw new ConflictError('The promotion retry parent is inconsistent');
    }
    return row;
  }
  private async loadGate(
    selection: PromotionSelection,
    session: ClientSession,
  ): Promise<PromotionGateRow | null> {
    const raw = await this.find({ id: selection.operationId }, session);
    if (!raw) return null;
    const gate = decodePromotionRow(raw);
    if (gate.kind !== 'GATE')
      throw new ConflictError(
        'The promotion operation ID belongs to another row',
      );
    assertPromotionSelection(gate, selection);
    return gate;
  }
  private find(filter: object, session: ClientSession) {
    return this.records
      .findOne(filter)
      .session(session)
      .read('primary')
      .maxTimeMS(5000)
      .lean()
      .exec();
  }
  private async insert(
    row: PromotionRow,
    session: ClientSession,
    gate?: PromotionGateRow,
  ) {
    const canonical = decodePromotionRow(row, gate);
    await this.records.create([canonical], { session });
  }
  private async updateRow(
    row: PromotionRow,
    update: object,
    session: ClientSession,
  ) {
    const result = await this.records
      .updateOne(
        {
          id: row.id,
          operationId: row.operationId,
          protocol: row.protocol,
          kind: row.kind,
          gateRevision: row.gateRevision,
        },
        update,
        { session, runValidators: true },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new ConflictError('The promotion row CAS changed');
  }
  private async saveGate(
    before: PromotionGateRow,
    after: PromotionGateRow,
    session: ClientSession,
  ) {
    decodePromotionRow(after);
    await this.updateRow(
      before,
      {
        $set: {
          gateRevision: after.gateRevision,
          data: after.data,
          identityIds: after.identityIds,
        },
      },
      session,
    );
  }
  private async fenceJournal(
    selection: PromotionSelection,
    expected: MediaPromotionScope | undefined,
    active: boolean,
    session: ClientSession,
  ): Promise<MediaPromotionScope> {
    const j = await this.journals
      .findOne({ id: selection.operationId, instanceId: selection.instanceId })
      .session(session)
      .read('primary')
      .lean()
      .exec();
    if (!j) throw new ConflictError('The promotion journal is missing');
    if (j.mediaPromotionProtocol !== MEDIA_PROMOTION_STORAGE_PROTOCOL)
      throw new ConflictError(
        'The journal did not opt into promotion persistence at creation',
      );
    const scope = active
      ? promotionScope(j, selection.animalId)
      : promotionJournalBinding(j, selection.animalId);
    if (expected && JSON.stringify(expected) !== JSON.stringify(scope))
      throw new ConflictError('The promotion journal scope changed');
    const result = await this.journals
      .updateOne(
        {
          id: scope.operationId,
          instanceId: scope.instanceId,
          protocol: ANIMAL_WRITE_PROTOCOL,
          mediaPromotionProtocol: MEDIA_PROMOTION_STORAGE_PROTOCOL,
          actorId: scope.ownerId,
          kind: scope.kind,
          issuesUploadUrl: false,
          lifecycle: j.lifecycle,
          callback: j.callback,
          'claims.1': { $exists: false },
          claims: {
            $elemMatch: {
              animalId: scope.animalId,
              ownershipVersion: scope.ownershipVersion,
              state: j.claims[0].state,
            },
          },
          ...this.counterMatch(j.mediaPromotionRevision),
        },
        { $inc: { mediaPromotionRevision: 1 } },
        { session },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new ConflictError('The promotion journal fence changed');
    return scope;
  }
  private async fenceControl(
    scope: MediaPromotionScope,
    session: ClientSession,
  ) {
    const c = await this.controls
      .findOne({ animalId: scope.animalId })
      .session(session)
      .read('primary')
      .lean()
      .exec();
    const token = {
      token: scope.operationId,
      operationId: scope.operationId,
      instanceId: scope.instanceId,
    };
    if (
      !c ||
      c.ownerId !== scope.ownerId ||
      c.ownershipVersion !== scope.ownershipVersion ||
      c.transferLock !== undefined ||
      !Array.isArray(c.activeWrites) ||
      c.activeWrites.filter((t) => t.token === token.token).length !== 1 ||
      !c.activeWrites.some(
        (t) =>
          t.token === token.token &&
          t.operationId === token.operationId &&
          t.instanceId === token.instanceId,
      )
    )
      throw new ConflictError(
        'The promotion requires its current linked write claim',
      );
    const result = await this.controls
      .updateOne(
        {
          animalId: scope.animalId,
          ownerId: scope.ownerId,
          ownershipVersion: scope.ownershipVersion,
          transferLock: { $exists: false },
          activeWrites: { $elemMatch: token },
          ...this.counterMatch(c.mediaPromotionRevision),
        },
        { $inc: { mediaPromotionRevision: 1 } },
        { session },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new ConflictError('The promotion control fence changed');
  }
  private async fenceUpload(
    scope: MediaPromotionScope,
    effectId: string,
    expectedHash: string,
    bucket: string,
    uploadId: string,
    session: ClientSession,
    seal?: { counter: number | undefined; revision: MediaRevision },
  ): Promise<void> {
    const upload = await this.uploads
      .findOne({ id: uploadId })
      .session(session)
      .read('primary')
      .lean()
      .exec();
    if (!upload) throw new ConflictError('The promotion upload is missing');
    const definition = promotionDefinition(scope, upload, bucket);
    if (promotionDefinitionHash(scope, effectId, definition) !== expectedHash)
      throw new ConflictError('The promotion upload definition changed');
    if (seal && upload.mediaPromotionRevision !== seal.counter)
      throw new ConflictError('The verification ticket fence changed');
    const pin = definition.source;
    const result = await this.uploads
      .updateOne(
        {
          id: uploadId,
          ownerId: scope.ownerId,
          animalId: scope.animalId,
          finalKey: definition.destinationKey,
          stagingKey: pin.key,
          mimeType: definition.mimeType,
          size: pin.size,
          legacy: { $exists: false },
          sealed: { $exists: false },
          'pinned.etag': pin.etag,
          'pinned.sha256': pin.sha256,
          'pinned.size': pin.size,
          'pinned.versionId':
            pin.versionId === undefined ? { $exists: false } : pin.versionId,
          ...this.counterMatch(upload.mediaPromotionRevision),
        },
        {
          $inc: { mediaPromotionRevision: 1 },
          ...(seal ? { $set: { sealed: seal.revision } } : {}),
        },
        { session },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new ConflictError('The promotion upload fence changed');
  }

  private counterMatch(value: number | undefined) {
    if (value === undefined)
      return { mediaPromotionRevision: { $exists: false } };
    if (promotionInteger(value) >= Number.MAX_SAFE_INTEGER)
      throw new ConflictError('The promotion fence counter is exhausted');
    return { mediaPromotionRevision: value };
  }
  private async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    if (
      [this.journals, this.controls, this.uploads].some(
        (m) => m.db !== this.records.db,
      )
    )
      throw new ConflictError(
        'Promotion models must share their Mongo connection',
      );
    const session = await this.records.db.startSession();
    try {
      const result = await session.withTransaction(() => work(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });
      if (result === undefined)
        throw new ConflictError('The promotion transaction returned no result');
      return result;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000)
        throw new ConflictError(
          'The promotion identity or resource has already been used',
        );
      throw error;
    } finally {
      try {
        await session.endSession();
      } catch {
        /* Do not hide an acknowledged result or the original failure. */
      }
    }
  }
}
