import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import {
  assertArchiveCallerTransaction,
  fenceArchiveReservation,
} from './archive-reservation-fence';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import {
  ArchiveEntry,
  ArchiveFile,
  ArchiveHistoryProgress,
  OwnershipArchive,
  archiveHash,
} from '../../../domain/ownership-archive';
import { archiveReservationEpoch } from '../../../domain/ownership-archive-reservation';
import {
  PublishedHistoryCopyInput,
  PublishedHistoryCopyIntent,
  PublishedHistoryCopyAttemptInput,
  PublishedHistoryCopyRepresentation,
  PublishedHistoryPutDeclaration,
  PublishedHistoryPutDeclarationInput,
  PublishedHistoryPutReadInput,
  PublishedHistoryPutAttempt,
  buildPublishedHistoryPutAttempt,
  publishedHistoryCopyAttemptInput,
  publishedHistoryPutReadInput,
  buildPublishedHistoryCopyIntent,
  publishedHistoryCopyIntentDefinition,
  publishedHistoryCopyInput,
} from '../../../domain/published-history-copy';
import {
  PublishedHistoryStagingInput,
  buildPublishedHistoryStagingIntent,
  publishedHistoryStagingInput,
} from '../../../domain/published-history-staging';
import {
  PublishedHistoryPutHeldEvidence,
  PublishedHistoryPutPermissionInput,
  PublishedHistoryPutTransportObservationInput,
  buildPublishedHistoryPutPermission,
  publishedHistoryPutPermissionInput,
} from '../../../domain/published-history-put-permission';
import { buildPublishedHistoryPutTransportObservation } from '../../../domain/transfer-item-historical-put-transport';
import {
  PublishedHistoryPutVersionRecord,
  matchPublishedHistoryPutVersionRecord,
} from '../../../domain/published-history-put-reconciliation';
import { assertHistoricalPutVersionUsable } from '../../../domain/transfer-item-historical-put-reconciliation';
import {
  ItemHistoricalPutDestinationScope,
  PublishedHistoryPutDestinationAccreditation,
  protectPublishedHistoryPutDestination,
  publishedHistoryPutDestinationScope,
  putDestinationAdmissionWindowContains,
} from '../../../domain/transfer-item-historical-put-destination-protection';
import type { MongoItemSourceProfileState } from './mongo-item-source-profile-state';
import { OwnershipArchiveHistoryRepository } from '../../../domain/ownership-archive-history';
import { sourceHashValid } from '../../../domain/transfer-item-historical-observation';
import {
  appendItemManifestFileDigest,
  ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
  ITEM_MANIFEST_FILES_DIGEST_SEED,
} from '../../../domain/transfer-item-manifest-digest';
import type { MongoTransferItemCapture } from './mongo-transfer-item-capture';
import {
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
} from './ownership-archive.schema';

type PublishedHistoryDestinationConfirmation = Readonly<{
  controls: Pick<MongoItemSourceProfileState, 'fenceActiveSharedControls'>;
  now: () => Date;
  accreditationFor: (
    scope: ItemHistoricalPutDestinationScope,
    expectedAccreditationHash: string,
  ) => PublishedHistoryPutDestinationAccreditation | null;
  /** Local check of the open custodian and the prepared transport in the calling instance. */
  permissionEvidenceFor?: (
    input: PublishedHistoryPutPermissionInput,
    attempt: PublishedHistoryPutAttempt,
  ) => PublishedHistoryPutHeldEvidence | null;
}>;

@Injectable()
export class MongoOwnershipArchiveHistory implements OwnershipArchiveHistoryRepository {
  constructor(
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(OWNERSHIP_ARCHIVE_ENTRY_MODEL)
    private readonly entries: Model<ArchiveEntry>,
    @InjectModel(OWNERSHIP_ARCHIVE_FILE_MODEL)
    private readonly files: Model<ArchiveFile>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @Optional()
    @Inject('PublishedOwnershipPredecessor')
    private readonly published?: Pick<
      MongoTransferItemCapture,
      'readPublishedHistoryPredecessorWithinTransaction'
    > &
      Partial<
        Pick<
          MongoTransferItemCapture,
          'fencePublishedHistoryFileVersionWithinTransaction'
        >
      >,
    @Optional()
    @Inject('PublishedHistoryDestinationConfirmation')
    private readonly destination?: PublishedHistoryDestinationConfirmation,
  ) {}

  preparePublishedCopy(
    raw: PublishedHistoryCopyInput,
    keyFromUrl: (url: string) => string | undefined,
  ) {
    const input = publishedHistoryCopyInput(raw);
    return this.withPublishedCopy(
      input,
      keyFromUrl,
      async ({ intent, file, filter, session }) => {
        if (
          file.publishedHistoryPutDeclaration !== undefined &&
          file.publishedHistoryCopyIntent === undefined
        )
          throw new ConflictError(
            'The published history copy declaration has no original intent',
          );
        if (file.publishedHistoryCopyIntent === undefined) {
          const result = await this.files
            .updateOne(
              { ...filter, publishedHistoryCopyIntent: { $exists: false } },
              { $set: { publishedHistoryCopyIntent: intent } },
              { session },
            )
            .exec();
          if (result.modifiedCount !== 1)
            throw new ConflictError(
              'The published history copy intent changed',
            );
        }
        return Object.freeze({
          intent,
          requiredThrough: input.requiredThrough,
          replayed: file.publishedHistoryCopyIntent !== undefined,
          copyDispatch: 'NOT_AUTHORIZED' as const,
        });
      },
    );
  }

  previewPublishedCopyAttempt(
    raw: PublishedHistoryCopyAttemptInput,
    keyFromUrl: (url: string) => string | undefined,
  ) {
    const input = publishedHistoryCopyAttemptInput(raw);
    return this.withPublishedCopy(
      input,
      keyFromUrl,
      ({ intent, file, representation }) => {
        if (!file.publishedHistoryCopyIntent)
          throw new ConflictError(
            'The original published history copy intent is missing',
          );
        const attempt = buildPublishedHistoryPutAttempt(
          intent,
          input,
          representation,
        );
        const stored = file.publishedHistoryPutDeclaration;
        if (
          stored !== undefined &&
          archiveHash(stored?.attempt) !== archiveHash(attempt)
        )
          throw new ConflictError(
            'The published history copy attempt cannot be replaced',
          );
        return Object.freeze({
          attempt,
          copyDispatch: 'NOT_AUTHORIZED' as const,
        });
      },
    );
  }

  declarePublishedCopyAttempt(
    raw: PublishedHistoryPutDeclarationInput,
    keyFromUrl: (url: string) => string | undefined,
  ) {
    const input = publishedHistoryCopyAttemptInput(raw);
    const { expectedControlsHash, expectedAccreditationHash } = raw;
    const config = this.destination;
    if (
      !config ||
      ![expectedControlsHash, expectedAccreditationHash].every(sourceHashValid)
    )
      throw new ConflictError(
        'The published history destination protection is unavailable',
      );
    return this.withPublishedCopy(
      input,
      keyFromUrl,
      async ({ intent, file, filter, representation, session }) => {
        if (!file.publishedHistoryCopyIntent)
          throw new ConflictError(
            'The original published history copy intent is missing',
          );
        const attempt = buildPublishedHistoryPutAttempt(
          intent,
          input,
          representation,
        );
        const stored = file.publishedHistoryPutDeclaration;
        const scope = publishedHistoryPutDestinationScope(
          attempt,
          expectedControlsHash,
        );
        const accreditation = structuredClone(
          stored === undefined
            ? config.accreditationFor(scope, expectedAccreditationHash)
            : stored?.accreditation,
        );
        if (!accreditation)
          throw new ConflictError(
            'The independent published history destination accreditation is absent',
          );
        const protection = protectPublishedHistoryPutDestination(
          attempt,
          expectedControlsHash,
          expectedAccreditationHash,
          accreditation,
        );
        const declaration: PublishedHistoryPutDeclaration = {
          state: 'INTENDED',
          attempt,
          accreditation,
          protection,
        };
        if (
          stored !== undefined &&
          archiveHash(stored) !== archiveHash(declaration)
        )
          throw new ConflictError(
            'The published history copy declaration cannot be replaced',
          );
        await config.controls.fenceActiveSharedControls(
          expectedControlsHash,
          session,
        );
        if (
          !putDestinationAdmissionWindowContains(
            protection,
            config.now().getTime(),
          )
        )
          throw new ConflictError(
            'The published history destination is outside its admission window',
          );
        if (stored === undefined) {
          const result = await this.files
            .updateOne(
              {
                ...filter,
                'publishedHistoryCopyIntent.definitionHash':
                  intent.definitionHash,
                publishedHistoryPutDeclaration: { $exists: false },
              },
              { $set: { publishedHistoryPutDeclaration: declaration } },
              { session },
            )
            .exec();
          if (result.modifiedCount !== 1)
            throw new ConflictError(
              'The published history copy declaration changed',
            );
        }
        return Object.freeze({
          declaration,
          replayed: stored !== undefined,
          copyDispatch: 'NOT_AUTHORIZED' as const,
        });
      },
    );
  }

  readPublishedCopyAttempt(
    raw: PublishedHistoryPutReadInput,
    keyFromUrl: (url: string) => string | undefined,
  ) {
    const input = publishedHistoryPutReadInput(raw);
    return this.withPublishedCopyAttempt(
      input,
      keyFromUrl,
      ({ declaration, source }) =>
        Object.freeze({
          definition: declaration.attempt,
          destinationProtection: declaration.protection,
          versionObservationHash: source.versionObservationHash,
          conservationControlsHash: source.conservationControlsHash,
          requiredThrough: input.requiredThrough,
        }),
    );
  }

  recordInitialPublishedCopyPermission(
    raw: PublishedHistoryPutPermissionInput,
    keyFromUrl: (url: string) => string | undefined,
  ) {
    const input = publishedHistoryPutPermissionInput(raw);
    return this.withPublishedCopyAttempt(
      input,
      keyFromUrl,
      async ({ declaration, source, filter, session, now }) => {
        const evidence = this.destination?.permissionEvidenceFor?.(
          input,
          declaration.attempt,
        );
        if (!evidence)
          throw new ConflictError(
            'The open historical artifact and exact transport evidence are required',
          );
        const admitted = now().getTime();
        if (
          !Number.isSafeInteger(admitted) ||
          admitted < source.conservationCheckedAt
        )
          throw new ConflictError(
            'The historical copy admission clock is inconsistent',
          );
        const permission = buildPublishedHistoryPutPermission(
          input,
          declaration,
          evidence,
          source,
          new Date(admitted).toISOString(),
        );
        const result = await this.files
          .updateOne(
            {
              ...filter,
              'publishedHistoryCopyIntent.definitionHash':
                input.expectedIntentHash,
              'publishedHistoryPutDeclaration.attempt.definitionHash':
                input.expectedAttemptDefinitionHash,
              'publishedHistoryPutDeclaration.protection.protectionHash':
                input.expectedProtectionHash,
              publishedHistoryPutPermission: { $exists: false },
            },
            { $set: { publishedHistoryPutPermission: permission } },
            { session },
          )
          .exec();
        if (result.modifiedCount !== 1)
          throw new ConflictError(
            'The published history copy permission changed',
          );
        return Object.freeze({ recorded: true as const, permission });
      },
    );
  }

  /** Reconciliation only. No current reservation or live reader is required to see a prior permit. */
  async observePublishedCopyPermission(
    raw: PublishedHistoryPutPermissionInput,
  ) {
    const input = publishedHistoryPutPermissionInput(raw);
    const observation = await this.readPublishedCopyPermission(input);
    if (!observation) return null;
    return Object.freeze({
      permission: observation.permission,
      ...(observation.transportObservation
        ? { transportObservation: observation.transportObservation }
        : {}),
      copyDispatch: 'NOT_AUTHORIZED' as const,
    });
  }

  async recordPublishedCopyTransportObservation(
    raw: PublishedHistoryPutTransportObservationInput,
  ) {
    const input = publishedHistoryPutPermissionInput(raw?.selection);
    const { expectedPermissionHash, localReturn } = raw;
    const current = await this.readPublishedCopyPermission(input);
    if (
      !current ||
      current.permission.permissionHash !== expectedPermissionHash
    )
      throw new ConflictError(
        'The exact published history copy permission is required',
      );
    const observation = buildPublishedHistoryPutTransportObservation(
      current.permission,
      localReturn,
    );
    if (!current.transportObservation) {
      const saved = await this.files
        .updateOne(
          {
            ...current.filter,
            'publishedHistoryPutPermission.permissionHash':
              expectedPermissionHash,
            publishedHistoryPutTransportObservation: { $exists: false },
          },
          { $set: { publishedHistoryPutTransportObservation: observation } },
          { writeConcern: { w: 'majority' } },
        )
        .exec();
      if (saved.modifiedCount === 1) return observation;
    }
    const persisted =
      current.transportObservation ??
      (await this.readPublishedCopyPermission(input))?.transportObservation;
    if (!persisted || archiveHash(persisted) !== archiveHash(observation))
      throw new ConflictError(
        'The published history transport observation cannot be replaced',
      );
    return persisted;
  }

  async readPublishedCopyVersionContext(
    raw: PublishedHistoryPutPermissionInput,
  ) {
    const current = await this.readPublishedCopyPermission(
      publishedHistoryPutPermissionInput(raw),
    );
    return current?.context ?? null;
  }

  recordPublishedCopyVersion(
    raw: PublishedHistoryPutPermissionInput,
    version: PublishedHistoryPutVersionRecord,
  ) {
    const input = publishedHistoryPutPermissionInput(raw);
    const expected = structuredClone(version);
    if (this.files.db !== this.archives.db)
      throw new ConflictError(
        'Published history version records require the archive connection',
      );
    return this.transaction(async (session) => {
      const current = await this.readPublishedCopyPermission(input, session);
      if (!current)
        throw new ConflictError(
          'The exact published history copy permission is required',
        );
      const record = matchPublishedHistoryPutVersionRecord(
        current.context,
        expected,
      );
      const stored = current.context.versionRecord;
      if (stored) {
        if (
          stored.observation.evidenceHash !== record.observation.evidenceHash ||
          stored.observation.requiredThrough !==
            record.observation.requiredThrough
        )
          throw new ConflictError(
            'The published history copy version cannot be replaced',
          );
        return stored;
      }
      const config = this.destination;
      if (!config)
        throw new ConflictError(
          'Published history conservation controls are unavailable',
        );
      await config.controls.fenceActiveSharedControls(
        record.evidence.conservationControlsHash,
        session,
      );
      assertHistoricalPutVersionUsable(
        record,
        record.observation.requiredThrough,
        config.now().getTime(),
      );
      const saved = await this.files
        .updateOne(
          {
            ...current.filter,
            'publishedHistoryPutPermission.permissionHash':
              current.permission.permissionHash,
            publishedHistoryPutVersion: { $exists: false },
          },
          { $set: { publishedHistoryPutVersion: record } },
          { session },
        )
        .exec();
      if (saved.modifiedCount !== 1)
        throw new ConflictError('The published history copy version changed');
      return record;
    });
  }

  private async readPublishedCopyPermission(
    input: PublishedHistoryPutPermissionInput,
    session?: ClientSession,
  ) {
    const filter = {
      archiveId: input.archiveId,
      id: input.fileId,
      definitionHash: input.expectedFileDefinitionHash,
      'publishedHistoryCopyIntent.definitionHash': input.expectedIntentHash,
      'publishedHistoryCopyIntent.reservationEpoch':
        input.expectedReservationEpoch,
      'publishedHistoryCopyIntent.publicationHash':
        input.expectedPublicationHash,
    };
    const query = this.files.findOne(filter);
    const file = await (
      session
        ? query.session(session)
        : query.read('primary').readConcern('majority')
    )
      .lean()
      .exec();
    const checked = this.checkedPublishedCopyPermission(file, input);
    return checked && { filter, ...checked };
  }

  private checkedPublishedCopyPermission(
    file: ArchiveFile | null,
    input: PublishedHistoryPutPermissionInput,
  ) {
    const permission = file?.publishedHistoryPutPermission;
    const stored = file?.publishedHistoryPutTransportObservation;
    const version = file?.publishedHistoryPutVersion;
    if (
      permission === undefined &&
      stored === undefined &&
      version === undefined
    )
      return null;
    const declaration = file?.publishedHistoryPutDeclaration;
    if (!declaration || !permission)
      throw new ConflictError(
        'The stored historical copy permission is inconsistent',
      );
    const rebuilt = buildPublishedHistoryPutPermission(
      input,
      declaration,
      {
        openedArtifactSeal: permission.artifact,
        transportRequestHash: permission.transportRequestHash,
      },
      permission,
      permission.admittedAt,
    );
    if (archiveHash(permission) !== archiveHash(rebuilt))
      throw new ConflictError(
        'The stored historical copy permission is inconsistent',
      );
    const transportObservation =
      stored === undefined
        ? undefined
        : buildPublishedHistoryPutTransportObservation(
            rebuilt,
            stored?.localReturn,
          );
    if (
      stored !== undefined &&
      archiveHash(stored) !== archiveHash(transportObservation)
    )
      throw new ConflictError(
        'The stored published history transport observation is inconsistent',
      );
    const context = { definition: declaration.attempt, permission: rebuilt };
    return {
      permission: rebuilt,
      transportObservation,
      context: Object.freeze({
        ...context,
        ...(version === undefined
          ? {}
          : {
              versionRecord: matchPublishedHistoryPutVersionRecord(
                context,
                version,
              ),
            }),
      }),
    };
  }

  preparePublishedCopyStaging(raw: PublishedHistoryStagingInput) {
    const input = publishedHistoryStagingInput(raw);
    const config = this.destination;
    if (!config)
      throw new ConflictError(
        'Published history conservation controls are unavailable',
      );
    return this.withPublishedCopyFile(
      input.selection,
      async ({ archive, file, filter, session }) => {
        const historical = publishedHistoryCopyIntentDefinition(
          input.selection,
          archive,
          file,
        );
        if (
          historical.definitionHash !== input.selection.expectedIntentHash ||
          archiveHash(historical) !==
            archiveHash(file.publishedHistoryCopyIntent)
        )
          throw new ConflictError(
            'The original published history intent is missing or changed',
          );
        const checked = this.checkedPublishedCopyPermission(
          file,
          input.selection,
        );
        if (!checked?.context.versionRecord)
          throw new ConflictError(
            'The reconciled historical version is missing',
          );
        const version = checked.context.versionRecord;
        const intent = buildPublishedHistoryStagingIntent(
          input,
          historical,
          file,
          checked.context,
        );
        await config.controls.fenceActiveSharedControls(
          intent.predecessor.conservationControlsHash,
          session,
        );
        assertHistoricalPutVersionUsable(
          version,
          input.requiredThrough,
          config.now().getTime(),
        );
        const stored = file.publishedHistoryStagingIntent;
        if (stored === undefined) {
          const result = await this.files
            .updateOne(
              {
                ...filter,
                'publishedHistoryCopyIntent.definitionHash':
                  historical.definitionHash,
                'publishedHistoryPutPermission.permissionHash':
                  input.expectedPermissionHash,
                'publishedHistoryPutVersion.observation.observationHash':
                  input.expectedVersionObservationHash,
                publishedHistoryStagingIntent: { $exists: false },
              },
              { $set: { publishedHistoryStagingIntent: intent } },
              { session },
            )
            .exec();
          if (result.modifiedCount !== 1)
            throw new ConflictError(
              'The published history staging intent changed',
            );
        } else if (archiveHash(stored) !== archiveHash(intent)) {
          throw new ConflictError(
            'The published history staging intent cannot be replaced',
          );
        }
        return Object.freeze({
          intent,
          replayed: stored !== undefined,
          copyDispatch: 'NOT_AUTHORIZED' as const,
        });
      },
    );
  }

  private withPublishedCopyAttempt<Result>(
    input: PublishedHistoryPutReadInput,
    keyFromUrl: (url: string) => string | undefined,
    finish: (context: {
      declaration: PublishedHistoryPutDeclaration;
      source: {
        versionObservationHash: string;
        conservationControlsHash: string;
        conservationCheckedAt: number;
      };
      filter: FilterQuery<ArchiveFile>;
      session: ClientSession;
      now: () => Date;
    }) => Result | Promise<Result>,
  ) {
    const config = this.destination;
    if (!config)
      throw new ConflictError(
        'The published history destination protection is unavailable',
      );
    return this.withPublishedCopy(
      input,
      keyFromUrl,
      async ({
        intent,
        file,
        representation,
        versionObservationHash,
        conservationControlsHash,
        conservationCheckedAt,
        filter,
        session,
      }) => {
        const stored = file.publishedHistoryPutDeclaration;
        if (!file.publishedHistoryCopyIntent || stored?.state !== 'INTENDED')
          throw new ConflictError(
            'The published history copy declaration is absent',
          );
        if (
          file.publishedHistoryPutPermission !== undefined ||
          file.publishedHistoryPutTransportObservation !== undefined ||
          file.publishedHistoryPutVersion !== undefined
        )
          throw new ConflictError(
            'The published history copy attempt already has a permission',
          );
        const definition = buildPublishedHistoryPutAttempt(
          intent,
          input,
          representation,
        );
        const destinationProtection = protectPublishedHistoryPutDestination(
          definition,
          input.expectedControlsHash,
          input.expectedAccreditationHash,
          stored.accreditation,
        );
        if (
          definition.definitionHash !== input.expectedAttemptDefinitionHash ||
          destinationProtection.protectionHash !==
            input.expectedProtectionHash ||
          archiveHash(stored) !==
            archiveHash({
              state: 'INTENDED',
              attempt: definition,
              accreditation: stored.accreditation,
              protection: destinationProtection,
            })
        )
          throw new ConflictError(
            'The published history copy declaration changed',
          );
        await config.controls.fenceActiveSharedControls(
          input.expectedControlsHash,
          session,
        );
        if (
          !putDestinationAdmissionWindowContains(
            destinationProtection,
            config.now().getTime(),
          )
        )
          throw new ConflictError(
            'The published history destination is outside its admission window',
          );
        return finish({
          declaration: {
            state: 'INTENDED',
            attempt: definition,
            accreditation: stored.accreditation,
            protection: destinationProtection,
          },
          source: {
            versionObservationHash,
            conservationControlsHash,
            conservationCheckedAt,
          },
          filter,
          session,
          now: () => config.now(),
        });
      },
    );
  }

  private withPublishedCopy<Result>(
    input: PublishedHistoryCopyInput,
    keyFromUrl: (url: string) => string | undefined,
    finish: (context: {
      intent: PublishedHistoryCopyIntent;
      file: ArchiveFile;
      filter: FilterQuery<ArchiveFile>;
      representation: PublishedHistoryCopyRepresentation;
      versionObservationHash: string;
      conservationControlsHash: string;
      conservationCheckedAt: number;
      session: ClientSession;
    }) => Result | Promise<Result>,
  ) {
    const published = this.published;
    if (!published?.fencePublishedHistoryFileVersionWithinTransaction)
      throw new ConflictError(
        'The versioned published predecessor reader is unavailable',
      );
    return this.withPublishedCopyFile(
      input,
      async ({ archive, file, source, filter, session }) => {
        const retained = file.retained!;
        const entry = await this.entries
          .findOne({
            archiveId: archive.id,
            kind: 'RETAINED_RECORD',
            'fileBindings.fileId': file.id,
            'retained.sourceArchiveId': source.id,
            'retained.sourcePublicationHash': input.expectedPublicationHash,
          })
          .sort({ id: 1 })
          .session(session)
          .lean()
          .exec();
        const sourceEntryId = entry?.retained?.sourceEntryId;
        if (
          !entry ||
          !sourceHashValid(sourceEntryId) ||
          entry.contentHash !==
            archiveHash({
              kind: entry.kind,
              payload: entry.payload,
              fileBindings: entry.fileBindings,
              retained: entry.retained,
            })
        )
          throw new ConflictError(
            'The retained file has no intact published entry binding',
          );
        const version =
          await published.fencePublishedHistoryFileVersionWithinTransaction!(
            {
              actorId: source.ownerId,
              periodId: source.periodId,
              publicationHash: input.expectedPublicationHash,
              entryId: sourceEntryId,
              fileId: retained.sourceFileId,
              requiredThrough: input.requiredThrough,
            },
            keyFromUrl,
            session,
            this.archives.db,
          );
        const intent = buildPublishedHistoryCopyIntent(
          input,
          archive,
          file,
          version,
        );
        const stored = file.publishedHistoryCopyIntent;
        if (stored !== undefined && archiveHash(stored) !== archiveHash(intent))
          throw new ConflictError(
            'The published history copy intent cannot be replaced',
          );
        return finish({
          intent,
          file,
          filter,
          representation: version.representation,
          versionObservationHash: version.versionObservationHash,
          conservationControlsHash: version.conservationControlsHash,
          conservationCheckedAt: version.conservationCheckedAt,
          session,
        });
      },
    );
  }

  private withPublishedCopyFile<Result>(
    input: PublishedHistoryCopyInput,
    finish: (context: {
      archive: OwnershipArchive;
      source: OwnershipArchive;
      file: ArchiveFile;
      filter: FilterQuery<ArchiveFile>;
      session: ClientSession;
    }) => Result | Promise<Result>,
  ) {
    return this.transaction(async (session) => {
      const archive = await this.archives
        .findOne({ id: input.archiveId })
        .session(session)
        .lean()
        .exec();
      const history = archive?.history;
      if (
        !archive ||
        archive.state !== 'COPYING' ||
        archive.capture !== undefined ||
        history?.phase !== 'COMPLETE' ||
        history.sourcePublicationHash !== input.expectedPublicationHash ||
        history.entryCount !== history.expectedEntryCount ||
        !sourceHashValid(history.sourceEntriesDigest) ||
        !Number.isSafeInteger(archive.expectedFileCount) ||
        archive.expectedFileCount! < history.expectedFileCount ||
        archiveReservationEpoch(archive) !== input.expectedReservationEpoch
      )
        throw new ConflictError(
          'The retained copy requires the sealed archive and original reservation',
        );
      const source = await this.loadSource(
        archive,
        history.sourceArchiveId,
        session,
        input.expectedPublicationHash,
      );
      this.assertPinned(history, source);
      if (history.sourceEntriesDigest !== source.manifestDigest?.entriesDigest)
        throw new ConflictError('The retained copy source manifest changed');
      await fenceArchiveReservation(
        archive,
        this.controls,
        this.periods,
        session,
      );
      const pendingFile = {
        id: input.fileId,
        archiveId: archive.id,
        definitionHash: input.expectedFileDefinitionHash,
        state: 'PENDING' as const,
        'retained.sourceArchiveId': source.id,
        'retained.publishedSource.publicationHash':
          input.expectedPublicationHash,
        leaseToken: { $exists: false },
        leaseUntil: { $exists: false },
        verified: { $exists: false },
        historicalCopyIntent: { $exists: false },
        sourceByteObservation: { $exists: false },
        sourceRetentionObservation: { $exists: false },
        sourceProfileObservationSet: { $exists: false },
        historicalByteObservation: { $exists: false },
        stagingCopyIntent: { $exists: false },
        stagingByteObservation: { $exists: false },
        recipientFinalCopyIntent: { $exists: false },
        materialization: { $exists: false },
      };
      const file = await this.files
        .findOne(pendingFile)
        .session(session)
        .lean()
        .exec();
      const retained = file?.retained;
      if (
        !file ||
        !retained?.publishedSource ||
        file.sourceKey !==
          `users/${source.ownerId}/animals/${source.animalId}/ownership-archives/${source.id}/${retained.relativeKey}`
      )
        throw new ConflictError(
          'The pending retained file is missing or changed',
        );
      return finish({ archive, source, file, filter: pendingFile, session });
    });
  }

  async start(
    archiveId: string,
    sourceArchiveId: string,
    sourcePublicationHash?: string,
  ): Promise<OwnershipArchive> {
    if (
      sourcePublicationHash !== undefined &&
      !sourceHashValid(sourcePublicationHash)
    )
      throw new ConflictError(
        'A published predecessor requires its exact receipt hash',
      );
    return this.transaction(async (session) => {
      const archive = await this.archives
        .findOne({ id: archiveId })
        .session(session)
        .lean()
        .exec();
      if (
        !archive ||
        archive.capture ||
        archive.state !== 'COLLECTING' ||
        (archive.history &&
          (archive.history.sourceArchiveId !== sourceArchiveId ||
            archive.history.sourcePublicationHash !== sourcePublicationHash))
      ) {
        throw new ConflictError(
          'History import requires the same collecting manual archive',
        );
      }
      await fenceArchiveReservation(
        archive,
        this.controls,
        this.periods,
        session,
      );
      const source = await this.loadSource(
        archive,
        sourceArchiveId,
        session,
        sourcePublicationHash,
      );
      if (archive.history) {
        this.assertPinned(archive.history, source);
        return archive;
      }
      const history: ArchiveHistoryProgress = {
        sourceArchiveId,
        sourceDefinitionHash: source.definitionHash,
        ...(sourcePublicationHash === undefined
          ? {}
          : {
              sourcePublicationHash,
              sourceEntriesDigest: ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
            }),
        expectedEntryCount: source.expectedEntryCount!,
        expectedFileCount: source.expectedFileCount!,
        revision: 0,
        phase: 'IMPORTING',
        entryCount: 0,
      };
      const result = await this.archives
        .updateOne(
          {
            id: archiveId,
            state: 'COLLECTING',
            capture: { $exists: false },
            history: { $exists: false },
          },
          { $set: { history }, $inc: { __v: 1 } },
          { session },
        )
        .exec();
      if (result.modifiedCount !== 1)
        throw new ConflictError(
          'The history import changed; refresh before retrying',
        );
      return { ...archive, history };
    });
  }

  async source(archive: OwnershipArchive): Promise<OwnershipArchive> {
    if (!archive.history)
      throw new ConflictError('Start the explicit history import first');
    return this.transaction(async (session) => {
      const source = await this.loadSource(
        archive,
        archive.history!.sourceArchiveId,
        session,
        archive.history!.sourcePublicationHash,
      );
      this.assertPinned(archive.history!, source);
      return source;
    });
  }

  async findFile(
    archiveId: string,
    fileId: string,
  ): Promise<ArchiveFile | null> {
    return this.files
      .findOne({ archiveId, id: fileId })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  }

  async checkpoint(
    archiveId: string,
    expected: ArchiveHistoryProgress,
    next: ArchiveHistoryProgress,
  ): Promise<boolean> {
    const publicationHash = expected.sourcePublicationHash;
    if (
      next.revision !== expected.revision + 1 ||
      expected.phase !== 'IMPORTING' ||
      !['IMPORTING', 'COMPLETE'].includes(next.phase) ||
      !Number.isSafeInteger(next.entryCount) ||
      next.sourceArchiveId !== expected.sourceArchiveId ||
      next.sourceDefinitionHash !== expected.sourceDefinitionHash ||
      next.sourcePublicationHash !== publicationHash ||
      (publicationHash === undefined
        ? expected.sourceEntriesDigest !== undefined ||
          next.sourceEntriesDigest !== undefined
        : !sourceHashValid(publicationHash) ||
          !sourceHashValid(next.sourceEntriesDigest) ||
          (!sourceHashValid(expected.sourceEntriesDigest) &&
            (expected.sourceEntriesDigest !== undefined ||
              expected.revision !== 0 ||
              expected.entryCount !== 0 ||
              expected.afterId !== undefined))) ||
      next.expectedEntryCount !== expected.expectedEntryCount ||
      next.expectedFileCount !== expected.expectedFileCount ||
      next.entryCount < expected.entryCount ||
      next.entryCount > expected.expectedEntryCount ||
      (expected.afterId &&
        (!next.afterId ||
          next.afterId < expected.afterId ||
          (next.afterId === expected.afterId && next.phase !== 'COMPLETE')))
    ) {
      throw new ConflictError('Invalid retained history checkpoint');
    }
    return this.transaction(async (session) => {
      // Serialize against append/seal before counting the final persisted page.
      const archive = await this.archives
        .findOne({ id: archiveId })
        .session(session)
        .lean()
        .exec();
      if (!archive)
        throw new ConflictError('The history target archive is missing');
      await fenceArchiveReservation(
        archive,
        this.controls,
        this.periods,
        session,
      );
      const updated = await this.archives
        .updateOne(
          { id: archiveId, state: 'COLLECTING', history: expected },
          { $set: { history: next }, $inc: { __v: 1 } },
          { session },
        )
        .exec();
      if (updated.modifiedCount !== 1) return false;
      if (next.phase === 'COMPLETE') {
        let expectedFilesDigest: string | undefined;
        if (publicationHash !== undefined) {
          const source = await this.loadSource(
            archive,
            expected.sourceArchiveId,
            session,
            publicationHash,
          );
          this.assertPinned(expected, source);
          if (
            !source.manifestDigest ||
            next.sourceEntriesDigest !== source.manifestDigest.entriesDigest
          )
            throw new ConflictError(
              'The published predecessor digest differs at completion',
            );
          expectedFilesDigest = source.manifestDigest.filesDigest;
        }
        const entryCount = await this.entries
          .countDocuments({ archiveId, kind: 'RETAINED_RECORD' })
          .session(session)
          .exec();
        const fileCount = await this.files
          .countDocuments({
            archiveId,
            'retained.sourceArchiveId': next.sourceArchiveId,
            ...(publicationHash === undefined
              ? {}
              : {
                  'retained.publishedSource.publicationHash': publicationHash,
                }),
          })
          .session(session)
          .exec();
        if (
          next.entryCount !== next.expectedEntryCount ||
          entryCount !== next.expectedEntryCount ||
          fileCount !== next.expectedFileCount
        ) {
          throw new ConflictError(
            'Retained history is incomplete; refusing completion',
          );
        }
        if (publicationHash !== undefined) {
          const foreignEntry = await this.entries
            .exists({
              archiveId,
              kind: 'RETAINED_RECORD',
              $or: [
                { 'retained.sourceArchiveId': { $ne: next.sourceArchiveId } },
                { 'retained.sourcePublicationHash': { $ne: publicationHash } },
              ],
            })
            .session(session)
            .exec();
          const foreignFile = await this.files
            .exists({
              archiveId,
              retained: { $exists: true },
              $or: [
                { 'retained.sourceArchiveId': { $ne: next.sourceArchiveId } },
                {
                  'retained.publishedSource.publicationHash': {
                    $ne: publicationHash,
                  },
                },
              ],
            })
            .session(session)
            .exec();
          if (foreignEntry || foreignFile)
            throw new ConflictError(
              'The retained history has records from another publication',
            );
          const cursor = this.files
            .find({
              archiveId,
              'retained.publishedSource.publicationHash': publicationHash,
            })
            .select({
              _id: 0,
              'retained.sourceFileId': 1,
              'retained.sourceDefinitionHash': 1,
            })
            .sort({ 'retained.sourceFileId': 1 })
            .collation({ locale: 'simple' })
            .session(session)
            .lean()
            .cursor();
          let digest = ITEM_MANIFEST_FILES_DIGEST_SEED;
          let after: string | undefined;
          try {
            for await (const file of cursor) {
              const id = file.retained?.sourceFileId;
              const hash = file.retained?.sourceDefinitionHash;
              if (
                !sourceHashValid(id) ||
                !sourceHashValid(hash) ||
                (after !== undefined && id <= after)
              )
                throw new ConflictError(
                  'The published history file sequence is inconsistent',
                );
              digest = appendItemManifestFileDigest(digest, id, hash);
              after = id;
            }
          } finally {
            await cursor.close();
          }
          if (digest !== expectedFilesDigest)
            throw new ConflictError(
              'The published history files differ from the sealed manifest',
            );
        }
      }
      return true;
    });
  }

  private assertPinned(
    history: ArchiveHistoryProgress,
    source: OwnershipArchive,
  ): void {
    if (
      history.sourceDefinitionHash !== source.definitionHash ||
      history.sourcePublicationHash !== source.ownershipCommitHash ||
      history.expectedEntryCount !== source.expectedEntryCount ||
      history.expectedFileCount !== source.expectedFileCount
    ) {
      throw new ConflictError('The retained history source definition changed');
    }
  }

  private async loadSource(
    destination: OwnershipArchive,
    sourceId: string,
    session: ClientSession,
    sourcePublicationHash?: string,
  ): Promise<OwnershipArchive> {
    const source = await this.archives
      .findOne({ id: sourceId })
      .session(session)
      .lean()
      .exec();
    const active = await this.periods
      .findOne({
        id: destination.periodId,
        animalId: destination.animalId,
        ownerId: destination.ownerId,
        ownershipVersion: destination.ownershipVersion,
        status: 'ACTIVE',
      })
      .session(session)
      .lean()
      .exec();
    const previous = await this.periods
      .find({
        animalId: destination.animalId,
        ownershipVersion: destination.ownershipVersion - 1,
      })
      .limit(2)
      .session(session)
      .lean()
      .exec();
    const period = previous[0];
    if (
      !source ||
      !active ||
      previous.length !== 1 ||
      period.status !== AnimalOwnershipPeriodStatus.Closed ||
      !period.endedAt ||
      period.archiveId !== source.id ||
      source.periodId !== period.id ||
      source.ownerId !== period.ownerId ||
      source.animalId !== destination.animalId ||
      source.ownershipVersion !== destination.ownershipVersion - 1 ||
      source.recipientId !== destination.ownerId ||
      active.sourceTransferId !== source.transferId ||
      source.id === destination.id ||
      source.ownershipCommitHash !== sourcePublicationHash ||
      (sourcePublicationHash === undefined
        ? source.state !== 'READY'
        : !['COPYING', 'READY'].includes(source.state)) ||
      !Number.isSafeInteger(source.expectedEntryCount) ||
      source.expectedEntryCount! < 1 ||
      !Number.isSafeInteger(source.expectedFileCount) ||
      source.expectedFileCount! < 0 ||
      (source.capture && source.capture.phase !== 'COMPLETE') ||
      (source.ownershipVersion > 1 &&
        (!source.history ||
          source.history.phase !== 'COMPLETE' ||
          source.history.entryCount !== source.history.expectedEntryCount))
    ) {
      throw new ConflictError(
        'History import requires the effective immediate predecessor',
      );
    }
    if (sourcePublicationHash !== undefined) {
      if (!this.published || !sourceHashValid(sourcePublicationHash))
        throw new ConflictError(
          'The published predecessor reader is unavailable',
        );
      assertArchiveCallerTransaction(session, this.archives, [
        this.entries,
        this.files,
        this.periods,
        this.controls,
      ]);
      const published =
        await this.published.readPublishedHistoryPredecessorWithinTransaction(
          { actorId: period.ownerId, periodId: period.id },
          session,
          this.archives.db,
        );
      if (
        published.receipt.commitHash !== sourcePublicationHash ||
        published.receipt.archiveId !== source.id ||
        published.receipt.activePeriodId !== active.id ||
        published.receipt.ownerId !== active.ownerId ||
        published.receipt.ownershipVersion !== active.ownershipVersion ||
        published.receipt.effectiveAt !== active.startedAt ||
        !active.startedAtKnown ||
        published.definitionHash !== source.definitionHash ||
        published.entryCount !== source.expectedEntryCount ||
        published.fileCount !== source.expectedFileCount
      )
        throw new ConflictError(
          'The predecessor receipt does not match the destination period',
        );
    }
    const entries = await this.entries
      .countDocuments({ archiveId: source.id })
      .session(session)
      .exec();
    const files = await this.files
      .countDocuments({ archiveId: source.id })
      .session(session)
      .exec();
    const profiles = await this.entries
      .countDocuments({ archiveId: source.id, kind: 'ANIMAL' })
      .session(session)
      .exec();
    const pending =
      sourcePublicationHash === undefined &&
      (await this.files
        .exists({ archiveId: source.id, state: { $ne: 'VERIFIED' } })
        .session(session)
        .exec());
    if (
      profiles !== 1 ||
      entries !== source.expectedEntryCount ||
      files !== source.expectedFileCount ||
      pending
    ) {
      throw new ConflictError(
        'The retained predecessor has an incomplete manifest',
      );
    }
    if (source.history) {
      const retainedEntries = await this.entries
        .countDocuments({ archiveId: source.id, kind: 'RETAINED_RECORD' })
        .session(session)
        .exec();
      const retainedFiles = await this.files
        .countDocuments({
          archiveId: source.id,
          'retained.sourceArchiveId': source.history.sourceArchiveId,
        })
        .session(session)
        .exec();
      if (
        retainedEntries !== source.history.expectedEntryCount ||
        retainedFiles !== source.history.expectedFileCount
      )
        throw new ConflictError('The predecessor omitted retained antecedents');
    }
    return source;
  }

  private async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.archives.db.startSession();
    try {
      return await session.withTransaction(() => work(session), {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      });
    } finally {
      await session.endSession();
    }
  }
}
