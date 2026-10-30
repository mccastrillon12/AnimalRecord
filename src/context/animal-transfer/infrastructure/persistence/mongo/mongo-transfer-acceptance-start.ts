import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { Animal, AnimalPrimitiveType } from '../../../../animal/domain/animal';
import { AnimalEntity } from '../../../../animal/infrastructure/persistence/mongo/animal.schema';
import {
  DiaryEntry,
  DiaryEntryPrimitiveType,
} from '../../../../diary/domain/diary-entry';
import { DiaryEntryEntity } from '../../../../diary/infrastructure/persistence/mongo/diary-entry.schema';
import {
  MedicalDocument,
  MedicalDocumentPrimitiveType,
  MedicalDocumentStatus,
} from '../../../../medical-document/domain/medical-document';
import { MedicalDocumentEntity } from '../../../../medical-document/infrastructure/persistence/mongo/medical-document.schema';
import {
  AnimalMediaUpload,
  isDirectAnimalMediaKey,
  isReservedArchiveGenerationKey,
} from '../../../../animal-media/domain/animal-media-upload';
import { ANIMAL_MEDIA_UPLOAD_MODEL } from '../../../../animal-media/infrastructure/mongo-animal-media-upload-repository';
import { UserEntity } from '../../../../user/infrastructure/persistence/mongo/user.schema';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import {
  AcceptanceSelection,
  buildAcceptanceCandidate,
} from '../../../domain/transfer-acceptance-preparation';
import {
  AcceptanceArchiveKeyResolver,
  AcceptanceStartStore,
  acceptanceStartReceipt,
  buildAcceptanceStartBinding,
  readAcceptanceStartReceipt,
} from '../../../domain/transfer-acceptance-start';
import {
  ArchiveDefinition,
  ArchiveRecordInput,
  OwnershipArchive,
  archiveHash,
  buildArchiveEntry,
} from '../../../domain/ownership-archive';
import { buildArchiveReservation } from '../../../domain/ownership-archive-reservation';
import { drainedAnimalReservationFilter } from '../../../domain/drained-animal-reservation-filter';
import { reservationEpochMatch } from '../../../domain/reservation-epoch';
import { transferRecordId } from '../../../domain/transfer-record-id';
import {
  TransferRequestItem,
  TransferRequestRecord,
} from '../../../domain/transfer-request';
import { MongoTransferAcceptancePreparation } from './mongo-transfer-acceptance-preparation';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';
import { OWNERSHIP_ARCHIVE_MODEL } from './ownership-archive.schema';
import {
  RequestClaim,
  TransferEvent,
  TRANSFER_EVENT_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_MODEL,
} from './transfer-request.schema';
import { fenceArchiveReservation } from './archive-reservation-fence';

/** Explicit internal Mongo-only start. Does not use capture.start or dispatch S3. */
@Injectable()
export class MongoTransferAcceptanceStart
  extends MongoTransferAcceptancePreparation
  implements AcceptanceStartStore
{
  constructor(
    @InjectModel(TRANSFER_REQUEST_MODEL) requests: Model<TransferRequestRecord>,
    @InjectModel(TRANSFER_REQUEST_ITEM_MODEL) items: Model<TransferRequestItem>,
    @InjectModel(TRANSFER_REQUEST_CLAIM_MODEL) claims: Model<RequestClaim>,
    @InjectModel(AnimalEntity.name) animals: Model<AnimalEntity>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    periods: Model<AnimalOwnershipPeriodEntity>,
    @InjectModel(MedicalDocumentEntity.name)
    medical: Model<MedicalDocumentEntity>,
    @InjectModel(DiaryEntryEntity.name)
    private readonly diary: Model<DiaryEntryEntity>,
    @InjectModel(ANIMAL_MEDIA_UPLOAD_MODEL)
    private readonly media: Model<AnimalMediaUpload>,
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(TRANSFER_EVENT_MODEL)
    private readonly events: Model<TransferEvent>,
    @InjectModel(UserEntity.name) private readonly users: Model<UserEntity>,
    @Inject('AcceptanceArchiveKeyResolver')
    private readonly keys: AcceptanceArchiveKeyResolver,
  ) {
    super(requests, items, claims, animals, controls, periods, medical);
  }

  protected get additionalModels() {
    return [this.diary, this.media, this.archives, this.events, this.users];
  }
  protected get additionalCollections() {
    return [
      'diary_entries',
      'animal_media_uploads',
      'animal_ownership_archives',
      'animal_transfer_events',
      'users',
    ];
  }
  protected unavailable() {
    return new ServiceUnavailableException(
      'Acceptance start could not be acknowledged; reconcile the same operation and selection without releasing reservations or dispatching work',
    );
  }
  protected async validateAdditionalSources() {
    const required: Array<{
      name: string;
      key: Record<string, number>;
      partial?: Record<string, string>;
    }> = [
      { name: 'animals', key: { id: 1 } },
      { name: 'users', key: { id: 1 } },
      { name: 'animal_ownership_controls', key: { animalId: 1 } },
      { name: 'animal_ownership_periods', key: { id: 1 } },
      {
        name: 'animal_ownership_periods',
        key: { animalId: 1 },
        partial: { status: 'ACTIVE' },
      },
      { name: 'animal_ownership_archives', key: { id: 1 } },
      {
        name: 'animal_ownership_archives',
        key: { periodId: 1, transferId: 1 },
      },
      { name: 'animal_media_uploads', key: { finalKey: 1 } },
      { name: 'diary_entries', key: { id: 1 } },
      { name: 'medical_documents', key: { id: 1 } },
    ];
    for (const name of [
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animals',
      'animal_ownership_controls',
      'animal_ownership_periods',
      'medical_documents',
      ...this.additionalCollections,
    ]) {
      const indexes = (await this.requests.db
        .db!.collection(name)
        .listIndexes({
          readPreference: 'primary',
          maxTimeMS: 5000,
          timeoutMS: 5000,
        })
        .toArray()) as Array<{
        key: unknown;
        unique?: unknown;
        sparse?: unknown;
        hidden?: unknown;
        buildUUID?: unknown;
        partialFilterExpression?: unknown;
        expireAfterSeconds?: unknown;
        collation?: { locale?: unknown };
      }>;
      if (
        indexes.some((i) => i.expireAfterSeconds !== undefined) ||
        required
          .filter((r) => r.name === name)
          .some(
            (r) =>
              !indexes.some(
                (i) =>
                  JSON.stringify(i.key) === JSON.stringify(r.key) &&
                  i.unique === true &&
                  i.sparse !== true &&
                  i.hidden !== true &&
                  i.buildUUID === undefined &&
                  archiveHash(i.partialFilterExpression) ===
                    archiveHash(r.partial) &&
                  (!i.collation || i.collation.locale === 'simple'),
              ),
          )
      )
        throw this.unavailable();
    }
  }

  start(raw: AcceptanceSelection) {
    return this.visit(
      raw,
      async (snapshot, session, input) => {
        const at = new Date().toISOString();
        const candidate = buildAcceptanceCandidate(input, snapshot, at);
        const binding = buildAcceptanceStartBinding(candidate, input, at);
        // All local preflight uses this snapshot, and all source fences are WRITES
        // in this same transaction. A previous candidate is never accepted as input.
        const participant = await this.users
          .findOneAndUpdate(
            { id: input.actorId },
            { $inc: { transferRequestRevision: 1 } },
            { session, new: true },
          )
          .select({ _id: 0, id: 1, transferRequestRevision: 1 })
          .lean()
          .exec();
        if (
          !participant ||
          !Number.isSafeInteger(participant.transferRequestRevision) ||
          participant.transferRequestRevision! < 1
        )
          throw new ConflictError(
            'Acceptance recipient changed or its fence is inconsistent',
          );
        for (const selected of candidate.selected) {
          const definition = selected.definition;
          const animal = await this.animals
            .findOneAndUpdate(
              {
                id: definition.animalId,
                ownerId: definition.ownerId,
                $or: [
                  { isActive: true },
                  { isActive: { $type: 'null' } },
                  { isActive: { $exists: false } },
                ],
              },
              { $inc: { transferRequestRevision: 1 } },
              { session, new: true },
            )
            .lean()
            .exec();
          if (
            !animal ||
            !Number.isSafeInteger(animal.transferRequestRevision) ||
            animal.transferRequestRevision! < 1
          )
            throw new ConflictError(
              'Acceptance animal eligibility or source fence changed',
            );
          const locked = await this.controls
            .updateOne(
              {
                ...drainedAnimalReservationFilter(
                  definition.animalId,
                  definition.ownerId,
                  definition.ownershipVersion,
                ),
                reservationEpoch: reservationEpochMatch(
                  selected.expectedReservationEpoch,
                ),
              },
              {
                $set: {
                  transferLock: { transferId: input.transferId, lockedAt: at },
                },
                $inc: { reservationEpoch: 1 },
              },
              { session },
            )
            .exec();
          this.changed(locked, 'Acceptance reservation changed');
          await this.preflight(
            definition,
            Animal.fromPrimitives(animal as AnimalPrimitiveType).toPrimitives(),
            session,
          );
        }
        // No item is decided if ANY selected dossier fails preflight. The writes
        // above are still uncommitted and roll back with this transaction.
        const decided = await this.requests
          .updateOne(
            {
              _id: input.transferId,
              recipientId: input.actorId,
              senderId: candidate.senderId,
              status: 'PENDING',
              version: input.expectedVersion,
              decidedAt: { $exists: false },
              decisionOperationId: { $exists: false },
              decisionExpectedVersion: { $exists: false },
              acceptanceStart: { $exists: false },
            },
            {
              $set: {
                status: 'PROCESSING',
                version: input.expectedVersion + 1,
                decidedAt: at,
                decisionOperationId: input.operationId,
                decisionExpectedVersion: input.expectedVersion,
                acceptanceStart: binding,
              },
            },
            { session },
          )
          .exec();
        this.changed(decided, 'Transfer request decision changed');
        for (const selected of candidate.selected) {
          const saved = await this.items
            .updateOne(
              {
                _id: selected.itemId,
                transferId: input.transferId,
                animalId: selected.animalId,
                expectedOwnerId: candidate.senderId,
                expectedOwnershipVersion: selected.definition.ownershipVersion,
                status: 'PENDING',
                captureArchiveId: { $exists: false },
                captureReservationEpoch: { $exists: false },
              },
              {
                $set: {
                  status: 'PROCESSING',
                  captureArchiveId: selected.definition.id,
                  captureReservationEpoch: selected.proposedReservationEpoch,
                },
              },
              { session },
            )
            .exec();
          this.changed(saved, 'Selected transfer item changed');
          // A real write fences the exact claim; do not infer ownership from its snapshot.
          const claim = await this.claims
            .updateOne(
              {
                _id: selected.animalId,
                transferId: input.transferId,
                acceptanceOperationId: { $exists: false },
              },
              { $set: { acceptanceOperationId: input.operationId } },
              { session },
            )
            .exec();
          this.changed(claim, 'Selected transfer claim changed');
          const archive: OwnershipArchive = {
            ...selected.definition,
            definitionHash: archiveHash(selected.definition),
            reservation: buildArchiveReservation(
              selected.definition,
              selected.proposedReservationEpoch,
            ),
            state: 'COLLECTING',
            createdAt: at,
            capture: { revision: 0, phase: 'ANIMAL', entryCount: 0 },
          };
          // No adoption/reset of an existing header, even for the same definition.
          if (
            await this.archives
              .exists({
                $or: [
                  { id: archive.id },
                  {
                    periodId: archive.periodId,
                    transferId: archive.transferId,
                  },
                ],
              })
              .session(session)
              .exec()
          )
            throw new ConflictError(
              'Acceptance archive already exists; no header adoption',
            );
          await fenceArchiveReservation(
            archive,
            this.controls,
            this.periods,
            session,
          );
          await this.archives.create([archive], { session });
        }
        if (candidate.rejectedItemIds.length) {
          const rejected = await this.items
            .updateMany(
              {
                _id: { $in: candidate.rejectedItemIds },
                transferId: input.transferId,
                status: 'PENDING',
                captureArchiveId: { $exists: false },
                captureReservationEpoch: { $exists: false },
              },
              { $set: { status: 'REJECTED' } },
              { session },
            )
            .exec();
          if (
            rejected.matchedCount !== candidate.rejectedItemIds.length ||
            rejected.modifiedCount !== candidate.rejectedItemIds.length
          )
            throw new ConflictError('Unselected transfer items changed');
          const unselected = snapshot.items
            .filter((i) => candidate.rejectedItemIds.includes(i._id))
            .map((i) => i.animalId);
          const released = await this.claims
            .deleteMany(
              { _id: { $in: unselected }, transferId: input.transferId },
              { session },
            )
            .exec();
          if (released.deletedCount !== unselected.length)
            throw new ConflictError('Unselected transfer claims changed');
        }
        await this.events.create(
          [
            {
              _id: transferRecordId(
                'acceptance-start',
                input.transferId,
                input.operationId,
              ),
              transferId: input.transferId,
              actorId: input.actorId,
              type: 'REQUEST_ACCEPTANCE_STARTED',
              createdAt: at,
              version: input.expectedVersion + 1,
              operationId: input.operationId,
            },
          ],
          { session },
        );
        return acceptanceStartReceipt(input.transferId, binding, false);
      },
      (request, _session, input) => {
        const receipt = readAcceptanceStartReceipt(input, request);
        return Promise.resolve(receipt ? { result: receipt } : undefined);
      },
    );
  }

  private changed(
    result: { matchedCount: number; modifiedCount: number },
    message: string,
  ) {
    if (result.matchedCount !== 1 || result.modifiedCount !== 1)
      throw new ConflictError(message);
  }
  private async preflight(
    definition: ArchiveDefinition,
    animal: AnimalPrimitiveType,
    session: ClientSession,
  ) {
    await this.assertRecord(
      definition,
      { kind: 'ANIMAL', data: animal },
      session,
    );
    await this.pages(
      this.diary,
      { animalId: definition.animalId },
      session,
      async (row) => {
        await this.assertRecord(
          definition,
          {
            kind: 'DIARY_ENTRY',
            data: DiaryEntry.fromPrimitives(
              row as DiaryEntryPrimitiveType,
            ).toPrimitives(),
          },
          session,
        );
      },
    );
    await this.pages(
      this.medical,
      {
        animalIds: definition.animalId,
        status: MedicalDocumentStatus.Accepted,
      },
      session,
      async (row) => {
        await this.assertRecord(
          definition,
          {
            kind: 'MEDICAL_DOCUMENT',
            data: MedicalDocument.fromPrimitives(
              row as MedicalDocumentPrimitiveType,
            ).toPrimitives(),
          },
          session,
        );
      },
    );
  }
  private async pages<T extends { id: string }>(
    model: Model<T>,
    filter: Record<string, unknown>,
    session: ClientSession,
    check: (row: T) => Promise<void>,
  ) {
    let after: string | undefined;
    while (true) {
      const page = await model
        .find({ ...filter, ...(after ? { id: { $gt: after } } : {}) })
        .collation({ locale: 'simple' })
        .sort({ id: 1 })
        .limit(100)
        .session(session)
        .lean()
        .exec();
      if (page.length > 100)
        throw new ConflictError('Acceptance preflight page exceeded its bound');
      let previous = after ?? '';
      for (const row of page) {
        if (typeof row.id !== 'string' || row.id <= previous)
          throw new ConflictError(
            'Acceptance preflight cursor did not advance',
          );
        previous = row.id;
        await check(row as T);
      }
      if (page.length < 100) return;
      after = previous;
    }
  }
  private async assertRecord(
    definition: ArchiveDefinition,
    record: ArchiveRecordInput,
    session: ClientSession,
  ) {
    const { files } = buildArchiveEntry(definition, record, (url) =>
      this.keys.keyFromUrl(url),
    );
    for (const file of files) {
      if (!isDirectAnimalMediaKey(file.sourceKey)) continue;
      if (isReservedArchiveGenerationKey(file.sourceKey))
        throw new ConflictError(
          'Archive generation media cannot be captured by the upload protocol',
        );
      const ticket = await this.media
        .findOne({ finalKey: file.sourceKey })
        .select({ _id: 0, pinned: 1, sealed: 1 })
        .session(session)
        .lean()
        .exec();
      if (!ticket?.pinned || !ticket.sealed)
        throw new ConflictError(
          'Legacy or unconfirmed animal media must be migrated before transfer capture',
        );
    }
  }
}
