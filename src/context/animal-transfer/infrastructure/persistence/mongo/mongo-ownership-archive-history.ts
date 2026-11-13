import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import { PublishedHistoryFinalCoverageObserver } from '../../../application/published-history-final-coverage-observer';
import {
  PublishedHistoryRecipientProjectionReader,
  PublishedHistoryRecipientProjectionSelection,
  publishedHistoryRecipientProjectionSelection,
} from '../../../application/published-history-recipient-projection-reader';
import type { ArchiveProjectionUrls } from '../../../domain/ownership-archive-recipient-projection';
import {
  buildPublishedHistoryStableCutScope,
  PublishedHistoryStableCutFile,
  PublishedHistoryStableCutScope,
} from '../../../domain/published-history-stable-cut-scope';
import {
  PublishedHistoryStableCutAccreditation,
  buildPublishedHistoryStableCutAccreditationRecord,
  buildPublishedHistoryStableCutConsumption,
  PublishedHistoryStableCutConsumption,
  matchPublishedHistoryStableCutAccreditation,
  publishedHistoryStableCutAccreditationRecordId,
} from '../../../domain/transfer-item-stable-cut-evidence';
import type { ItemCopyRecord } from '../../../domain/transfer-item-copy-record';
import { ITEM_COPY_RECORD_MODEL } from './transfer-item-copy-record.schema';
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
import {
  archiveReservationEpoch,
  archiveDefinitionOnly,
  assertArchiveReservationControl,
} from '../../../domain/ownership-archive-reservation';
import {
  PublishedHistoryFinalCoveragePage,
  PublishedHistoryFinalCoveragePageInput,
  PublishedHistoryFinalMediaRegistrationInput,
  PublishedHistoryPreparedCoveragePage,
  PublishedHistoryRetainedEntryPage,
  PublishedHistoryRetainedEntryPageInput,
  PublishedHistoryProjectionMediaPage,
  PublishedHistoryProjectionEntryPage,
  publishedHistoryFinalCoverageInput,
  publishedHistoryFinalCoverageSelection,
  publishedHistoryFinalMediaRegistrationInput,
} from '../../../domain/published-history-final-coverage';
import {
  TransferredMediaRegistration,
  PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL,
  assertSameMediaRegistration,
  buildPublishedHistoryFinalMediaRegistration,
} from '../../../domain/ownership-archive-media-registration';
import { persistTransferredMediaRegistration } from './mongo-ownership-archive-media-registration';
import { OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL } from './ownership-archive-media-registration.schema';
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
  PublishedHistoryStagingIntent,
  PublishedHistoryStagingAttemptInput,
  PublishedHistoryStagingDeclarationInput,
  PublishedHistoryStagingPutDeclaration,
  PublishedHistoryStagingPutAttempt,
  PublishedHistoryStagingReadInput,
  publishedHistoryStagingReadInput,
  buildPublishedHistoryStagingPutAttempt,
  publishedHistoryStagingAttemptInput,
  buildPublishedHistoryStagingIntent,
  publishedHistoryStagingInput,
} from '../../../domain/published-history-staging';
import {
  PublishedHistoryFinalAttemptInput,
  PublishedHistoryFinalDeclarationInput,
  PublishedHistoryFinalInput,
  PublishedHistoryFinalPutDeclaration,
  PublishedHistoryFinalPutAttempt,
  PublishedHistoryFinalReadInput,
  buildPublishedHistoryFinalIntent,
  buildPublishedHistoryFinalPutAttempt,
  publishedHistoryFinalAttemptInput,
  publishedHistoryFinalInput,
  publishedHistoryFinalReadInput,
} from '../../../domain/published-history-final';
import {
  PublishedHistoryFinalHeldEvidence,
  PublishedHistoryFinalPermissionInput,
  PublishedHistoryFinalTransportInput,
  buildPublishedHistoryFinalPermission,
  publishedHistoryFinalPermissionInput,
} from '../../../domain/published-history-final-permission';
import {
  PublishedHistoryStagingHeldEvidence,
  PublishedHistoryStagingPermissionInput,
  PublishedHistoryStagingTransportInput,
  buildPublishedHistoryStagingPermission,
  publishedHistoryStagingPermissionInput,
} from '../../../domain/published-history-staging-permission';
import {
  PublishedHistoryPutHeldEvidence,
  PublishedHistoryPutPermissionInput,
  PublishedHistoryPutTransportObservationInput,
  buildPublishedHistoryPutPermission,
  publishedHistoryPutPermissionInput,
} from '../../../domain/published-history-put-permission';
import {
  buildPublishedHistoryPutTransportObservation,
  buildPublishedHistoryStagingTransportObservation,
  buildPublishedHistoryFinalTransportObservation,
} from '../../../domain/transfer-item-historical-put-transport';
import {
  PublishedHistoryFinalPutVersionRecord,
  matchPublishedHistoryFinalPutVersionRecord,
} from '../../../domain/published-history-final-reconciliation';
import {
  PublishedHistoryStagingPutVersionRecord,
  matchPublishedHistoryStagingPutVersionRecord,
} from '../../../domain/published-history-staging-reconciliation';
import {
  PublishedHistoryPutVersionRecord,
  matchPublishedHistoryPutVersionRecord,
} from '../../../domain/published-history-put-reconciliation';
import {
  assertHistoricalPutVersionUsable,
  historicalPutEvidenceTime,
} from '../../../domain/transfer-item-historical-put-reconciliation';
import {
  ItemHistoricalPutDestinationScope,
  PublishedHistoryFinalPutDestinationAccreditation,
  PublishedHistoryPutDestinationAccreditation,
  PublishedHistoryStagingPutDestinationAccreditation,
  protectPublishedHistoryPutDestination,
  protectPublishedHistoryFinalPutDestination,
  protectPublishedHistoryStagingPutDestination,
  publishedHistoryStagingPutDestinationScope,
  publishedHistoryFinalPutDestinationScope,
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
  ITEM_MANIFEST_PAGE_SIZE,
  captureItemManifestDigest,
  ItemManifestDigestResult,
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

type PublishedHistoryProjectionSnapshot = {
  session: ClientSession;
  archive: OwnershipArchive;
  source: OwnershipArchive;
  manifest: ItemManifestDigestResult;
  lastCheckedAt: number;
  stableCutFiles?: PublishedHistoryStableCutFile[];
};

type PublishedHistoryStableCutSelection = Readonly<{
  selection: PublishedHistoryRecipientProjectionSelection;
  expectedScopeHash: string;
  expectedAccreditationHash: string;
}>;

type PublishedHistoryDestinationConfirmation = Readonly<{
  stableCutAccreditationFor?: (
    scope: PublishedHistoryStableCutScope,
    expectedAccreditationHash: string,
  ) => PublishedHistoryStableCutAccreditation | null;
  controls: Pick<MongoItemSourceProfileState, 'fenceActiveSharedControls'> &
    Partial<Pick<MongoItemSourceProfileState, 'assertActiveSharedControls'>>;
  now: () => Date;
  accreditationFor: (
    scope: ItemHistoricalPutDestinationScope,
    expectedAccreditationHash: string,
  ) => PublishedHistoryPutDestinationAccreditation | null;
  stagingAccreditationFor?: (
    scope: ItemHistoricalPutDestinationScope,
    expectedAccreditationHash: string,
  ) => PublishedHistoryStagingPutDestinationAccreditation | null;
  finalAccreditationFor?: (
    scope: ItemHistoricalPutDestinationScope,
    expectedAccreditationHash: string,
  ) => PublishedHistoryFinalPutDestinationAccreditation | null;
  /** Local check of the open custodian and the prepared transport in the calling instance. */
  permissionEvidenceFor?: (
    input: PublishedHistoryPutPermissionInput,
    attempt: PublishedHistoryPutAttempt,
  ) => PublishedHistoryPutHeldEvidence | null;
  stagingPermissionEvidenceFor?: (
    input: PublishedHistoryStagingPermissionInput,
    attempt: PublishedHistoryStagingPutAttempt,
  ) => PublishedHistoryStagingHeldEvidence | null;
  finalPermissionEvidenceFor?: (
    input: PublishedHistoryFinalPermissionInput,
    attempt: PublishedHistoryFinalPutAttempt,
  ) => PublishedHistoryFinalHeldEvidence | null;
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
    @Optional()
    @InjectModel(OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL)
    private readonly registrations?: Model<TransferredMediaRegistration>,
    @Optional()
    @InjectModel(ITEM_COPY_RECORD_MODEL)
    private readonly copyRecords?: Model<ItemCopyRecord>,
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
    return file && checked ? { filter, file, ...checked } : null;
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
    return this.withPublishedStaging(
      input,
      async ({ intent, file, filter, session }) => {
        const stored = file.publishedHistoryStagingIntent;
        if (stored === undefined) {
          if (file.publishedHistoryStagingPutDeclaration !== undefined)
            throw new ConflictError(
              'The staging declaration has no original intent',
            );
          const result = await this.files
            .updateOne(
              { ...filter, publishedHistoryStagingIntent: { $exists: false } },
              { $set: { publishedHistoryStagingIntent: intent } },
              { session },
            )
            .exec();
          if (result.modifiedCount !== 1)
            throw new ConflictError(
              'The published history staging intent changed',
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

  previewPublishedStagingAttempt(raw: PublishedHistoryStagingAttemptInput) {
    const input = publishedHistoryStagingAttemptInput(raw);
    return this.withPublishedStaging(
      input,
      ({ intent, file, historicalAttempt }) => {
        if (!file.publishedHistoryStagingIntent)
          throw new ConflictError(
            'The original published history staging intent is missing',
          );
        const attempt = buildPublishedHistoryStagingPutAttempt(
          intent,
          input,
          historicalAttempt,
        );
        const stored = file.publishedHistoryStagingPutDeclaration;
        if (
          stored !== undefined &&
          archiveHash(stored?.attempt) !== archiveHash(attempt)
        )
          throw new ConflictError(
            'The published history staging attempt cannot be replaced',
          );
        return Object.freeze({
          attempt,
          copyDispatch: 'NOT_AUTHORIZED' as const,
        });
      },
    );
  }

  declarePublishedStagingAttempt(raw: PublishedHistoryStagingDeclarationInput) {
    const input = publishedHistoryStagingAttemptInput(raw);
    const { expectedControlsHash, expectedAccreditationHash } = raw;
    const config = this.destination;
    if (
      !config ||
      ![expectedControlsHash, expectedAccreditationHash].every(sourceHashValid)
    )
      throw new ConflictError(
        'Published history staging protection is unavailable',
      );
    return this.withPublishedStaging(
      input,
      async ({ intent, file, filter, historicalAttempt, version, session }) => {
        if (!file.publishedHistoryStagingIntent)
          throw new ConflictError(
            'The original published history staging intent is missing',
          );
        const attempt = buildPublishedHistoryStagingPutAttempt(
          intent,
          input,
          historicalAttempt,
        );
        const stored = file.publishedHistoryStagingPutDeclaration;
        const scope = publishedHistoryStagingPutDestinationScope(
          attempt,
          expectedControlsHash,
        );
        const accreditation = structuredClone(
          stored === undefined
            ? config.stagingAccreditationFor?.(scope, expectedAccreditationHash)
            : stored?.accreditation,
        );
        if (!accreditation)
          throw new ConflictError(
            'The independent published history staging accreditation is absent',
          );
        const protection = protectPublishedHistoryStagingPutDestination(
          attempt,
          expectedControlsHash,
          expectedAccreditationHash,
          accreditation,
        );
        const declaration: PublishedHistoryStagingPutDeclaration = {
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
            'The published history staging declaration cannot be replaced',
          );
        if (
          expectedControlsHash !== intent.predecessor.conservationControlsHash
        )
          await config.controls.fenceActiveSharedControls(
            expectedControlsHash,
            session,
          );
        const checkedAt = config.now().getTime();
        assertHistoricalPutVersionUsable(
          version,
          input.requiredThrough,
          checkedAt,
        );
        if (!putDestinationAdmissionWindowContains(protection, checkedAt))
          throw new ConflictError(
            'The published history staging destination is outside its admission window',
          );
        if (stored === undefined) {
          const result = await this.files
            .updateOne(
              {
                ...filter,
                'publishedHistoryStagingIntent.definitionHash':
                  intent.definitionHash,
                publishedHistoryStagingPutDeclaration: { $exists: false },
              },
              { $set: { publishedHistoryStagingPutDeclaration: declaration } },
              { session },
            )
            .exec();
          if (result.modifiedCount !== 1)
            throw new ConflictError(
              'The published history staging declaration changed',
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

  readPublishedStagingAttempt(raw: PublishedHistoryStagingReadInput) {
    const input = publishedHistoryStagingReadInput(raw);
    return this.withUnpermittedPublishedStaging(input, ({ declaration }) =>
      Object.freeze({
        definition: declaration.attempt,
        destinationProtection: declaration.protection,
      }),
    );
  }

  recordInitialPublishedStagingPermission(
    raw: PublishedHistoryStagingPermissionInput,
  ) {
    const input = publishedHistoryStagingPermissionInput(raw);
    return this.withUnpermittedPublishedStaging(
      input,
      async ({ declaration, filter, version, session, config, checkedAt }) => {
        const evidence = config.stagingPermissionEvidenceFor?.(
          input,
          declaration.attempt,
        );
        if (!evidence)
          throw new ConflictError(
            'The open staging artifact and exact transport evidence are required',
          );
        const admitted = config.now().getTime();
        if (admitted < checkedAt)
          throw new ConflictError(
            'The staging admission clock moved backwards',
          );
        assertHistoricalPutVersionUsable(
          version,
          input.requiredThrough,
          admitted,
        );
        const permission = buildPublishedHistoryStagingPermission(
          input,
          declaration,
          evidence,
          new Date(admitted).toISOString(),
        );
        const result = await this.files
          .updateOne(
            {
              ...filter,
              'publishedHistoryStagingIntent.definitionHash':
                input.expectedStagingIntentHash,
              'publishedHistoryStagingPutDeclaration.attempt.definitionHash':
                input.expectedAttemptDefinitionHash,
              'publishedHistoryStagingPutDeclaration.protection.protectionHash':
                input.expectedProtectionHash,
              publishedHistoryStagingPutPermission: { $exists: false },
            },
            { $set: { publishedHistoryStagingPutPermission: permission } },
            { session },
          )
          .exec();
        if (result.modifiedCount !== 1)
          throw new ConflictError(
            'The published history staging permission changed',
          );
        return Object.freeze({ recorded: true as const, permission });
      },
    );
  }

  /** Reads a prior permit for reconciliation without current controls or a reader. */
  async observePublishedStagingPermission(
    raw: PublishedHistoryStagingPermissionInput,
  ) {
    const input = publishedHistoryStagingPermissionInput(raw);
    const current = await this.readPublishedStagingPermission(input);
    if (!current) return null;
    return Object.freeze({
      permission: current.context.permission,
      ...(current.transportObservation
        ? { transportObservation: current.transportObservation }
        : {}),
      copyDispatch: 'NOT_AUTHORIZED' as const,
    });
  }

  async recordPublishedStagingTransportObservation(
    raw: PublishedHistoryStagingTransportInput,
  ) {
    const input = publishedHistoryStagingPermissionInput(raw?.selection);
    const { expectedPermissionHash, localReturn } = raw;
    const current = await this.readPublishedStagingPermission(input);
    if (
      !current ||
      current.context.permission.permissionHash !== expectedPermissionHash
    )
      throw new ConflictError(
        'The exact published history staging permission is required',
      );
    const observation = buildPublishedHistoryStagingTransportObservation(
      current.context.permission,
      localReturn,
    );
    if (!current.transportObservation) {
      const saved = await this.files
        .updateOne(
          {
            ...current.filter,
            publishedHistoryStagingPutTransportObservation: { $exists: false },
          },
          {
            $set: {
              publishedHistoryStagingPutTransportObservation: observation,
            },
          },
          { writeConcern: { w: 'majority' } },
        )
        .exec();
      if (saved.modifiedCount === 1) return observation;
    }
    const persisted =
      current.transportObservation ??
      (await this.readPublishedStagingPermission(input))?.transportObservation;
    if (!persisted || archiveHash(persisted) !== archiveHash(observation))
      throw new ConflictError(
        'The published history staging transport observation cannot be replaced',
      );
    return persisted;
  }

  async readPublishedStagingVersionContext(
    raw: PublishedHistoryStagingPermissionInput,
  ) {
    const current = await this.readPublishedStagingPermission(
      publishedHistoryStagingPermissionInput(raw),
    );
    return current?.context ?? null;
  }

  recordPublishedStagingVersion(
    raw: PublishedHistoryStagingPermissionInput,
    version: PublishedHistoryStagingPutVersionRecord,
  ) {
    const input = publishedHistoryStagingPermissionInput(raw);
    const expected = structuredClone(version);
    if (this.files.db !== this.archives.db)
      throw new ConflictError(
        'Published staging version records require the archive connection',
      );
    return this.transaction(async (session) => {
      const current = await this.readPublishedStagingPermission(input, session);
      if (!current)
        throw new ConflictError(
          'The exact published history staging permission is required',
        );
      const record = matchPublishedHistoryStagingPutVersionRecord(
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
            'The published history staging version cannot be replaced',
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
            publishedHistoryStagingPutVersion: { $exists: false },
          },
          { $set: { publishedHistoryStagingPutVersion: record } },
          { session },
        )
        .exec();
      if (saved.modifiedCount !== 1)
        throw new ConflictError(
          'The published history staging version changed',
        );
      return record;
    });
  }

  async recordPublishedFinalTransportObservation(
    raw: PublishedHistoryFinalTransportInput,
  ) {
    const input = publishedHistoryFinalPermissionInput(raw?.selection);
    const { expectedPermissionHash, localReturn } = raw;
    const current = await this.readPublishedFinalPermission(input);
    if (
      !current ||
      current.context.permission.permissionHash !== expectedPermissionHash
    )
      throw new ConflictError(
        'The exact published history final permission is required',
      );
    const observation = buildPublishedHistoryFinalTransportObservation(
      current.context.permission,
      localReturn,
    );
    if (!current.transportObservation) {
      const saved = await this.files
        .updateOne(
          {
            ...current.filter,
            publishedHistoryFinalPutTransportObservation: { $exists: false },
          },
          {
            $set: {
              publishedHistoryFinalPutTransportObservation: observation,
            },
          },
          { writeConcern: { w: 'majority' } },
        )
        .exec();
      if (saved.modifiedCount === 1) return observation;
    }
    const persisted =
      current.transportObservation ??
      (await this.readPublishedFinalPermission(input))?.transportObservation;
    if (!persisted || archiveHash(persisted) !== archiveHash(observation))
      throw new ConflictError(
        'The published history final transport observation cannot be replaced',
      );
    return persisted;
  }

  async readPublishedFinalVersionContext(
    raw: PublishedHistoryFinalPermissionInput,
  ) {
    const current = await this.readPublishedFinalPermission(
      publishedHistoryFinalPermissionInput(raw),
    );
    return current?.context ?? null;
  }

  recordPublishedFinalVersion(
    raw: PublishedHistoryFinalPermissionInput,
    version: PublishedHistoryFinalPutVersionRecord,
  ) {
    const input = publishedHistoryFinalPermissionInput(raw);
    const expected = structuredClone(version);
    if (this.files.db !== this.archives.db)
      throw new ConflictError(
        'Published final version records require the archive connection',
      );
    return this.transaction(async (session) => {
      const current = await this.readPublishedFinalPermission(input, session);
      if (!current)
        throw new ConflictError(
          'The exact published history final permission is required',
        );
      const record = matchPublishedHistoryFinalPutVersionRecord(
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
            'The published history final version cannot be replaced',
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
            publishedHistoryFinalPutVersion: { $exists: false },
          },
          { $set: { publishedHistoryFinalPutVersion: record } },
          { session },
        )
        .exec();
      if (saved.modifiedCount !== 1)
        throw new ConflictError('The published history final version changed');
      return record;
    });
  }

  preparePublishedCopyFinal(raw: PublishedHistoryFinalInput) {
    const input = publishedHistoryFinalInput(raw);
    return this.withPublishedFinal(
      input,
      async ({ intent, file, filter, session }) => {
        const stored = file.publishedHistoryFinalIntent;
        if (stored === undefined) {
          if (file.publishedHistoryFinalPutDeclaration !== undefined)
            throw new ConflictError(
              'The final declaration has no original intent',
            );
          const result = await this.files
            .updateOne(
              { ...filter, publishedHistoryFinalIntent: { $exists: false } },
              { $set: { publishedHistoryFinalIntent: intent } },
              { session },
            )
            .exec();
          if (result.modifiedCount !== 1)
            throw new ConflictError(
              'The published history final intent changed',
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

  previewPublishedFinalAttempt(raw: PublishedHistoryFinalAttemptInput) {
    const input = publishedHistoryFinalAttemptInput(raw);
    return this.withPublishedFinal(input, ({ intent, file, staging }) => {
      if (!file.publishedHistoryFinalIntent)
        throw new ConflictError(
          'The original published history final intent is missing',
        );
      const attempt = buildPublishedHistoryFinalPutAttempt(
        input,
        intent,
        staging,
      );
      const stored = file.publishedHistoryFinalPutDeclaration;
      if (
        stored !== undefined &&
        (stored?.state !== 'INTENDED' ||
          archiveHash(stored.attempt) !== archiveHash(attempt))
      )
        throw new ConflictError(
          'The published history final attempt cannot be replaced',
        );
      return Object.freeze({
        attempt,
        copyDispatch: 'NOT_AUTHORIZED' as const,
      });
    });
  }

  declarePublishedFinalAttempt(raw: PublishedHistoryFinalDeclarationInput) {
    const input = publishedHistoryFinalAttemptInput(raw);
    const { expectedControlsHash, expectedAccreditationHash } = raw;
    const config = this.destination;
    if (
      !config ||
      ![expectedControlsHash, expectedAccreditationHash].every(sourceHashValid)
    )
      throw new ConflictError(
        'Published history final protection is unavailable',
      );
    return this.withPublishedFinal(
      input,
      async ({ intent, file, staging, version, filter, session }) => {
        if (!file.publishedHistoryFinalIntent)
          throw new ConflictError(
            'The original published history final intent is missing',
          );
        const attempt = buildPublishedHistoryFinalPutAttempt(
          input,
          intent,
          staging,
        );
        const scope = publishedHistoryFinalPutDestinationScope(
          attempt,
          expectedControlsHash,
        );
        const stored = file.publishedHistoryFinalPutDeclaration;
        const accreditation = structuredClone(
          stored === undefined
            ? config.finalAccreditationFor?.(scope, expectedAccreditationHash)
            : stored?.accreditation,
        );
        if (!accreditation)
          throw new ConflictError(
            'The independent published history final accreditation is absent',
          );
        const protection = protectPublishedHistoryFinalPutDestination(
          attempt,
          expectedControlsHash,
          expectedAccreditationHash,
          accreditation,
        );
        const declaration: PublishedHistoryFinalPutDeclaration = {
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
            'The published history final declaration cannot be replaced',
          );
        if (
          expectedControlsHash !== intent.predecessor.conservationControlsHash
        )
          await config.controls.fenceActiveSharedControls(
            expectedControlsHash,
            session,
          );
        const checkedAt = config.now().getTime();
        assertHistoricalPutVersionUsable(
          version,
          input.requiredThrough,
          checkedAt,
        );
        if (!putDestinationAdmissionWindowContains(protection, checkedAt))
          throw new ConflictError(
            'The published history final destination is outside its admission window',
          );
        if (stored === undefined) {
          const result = await this.files
            .updateOne(
              {
                ...filter,
                'publishedHistoryFinalIntent.definitionHash':
                  intent.definitionHash,
                publishedHistoryFinalPutDeclaration: { $exists: false },
              },
              { $set: { publishedHistoryFinalPutDeclaration: declaration } },
              { session },
            )
            .exec();
          if (result.modifiedCount !== 1)
            throw new ConflictError(
              'The published history final declaration changed',
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

  readPublishedFinalAttempt(raw: PublishedHistoryFinalReadInput) {
    return this.withUnpermittedPublishedFinal(
      publishedHistoryFinalReadInput(raw),
      ({ declaration }) =>
        Object.freeze({
          definition: declaration.attempt,
          destinationProtection: declaration.protection,
        }),
    );
  }

  recordInitialPublishedFinalPermission(
    raw: PublishedHistoryFinalPermissionInput,
  ) {
    const input = publishedHistoryFinalPermissionInput(raw);
    return this.withUnpermittedPublishedFinal(
      input,
      async ({ declaration, filter, version, session, config, checkedAt }) => {
        const evidence = config.finalPermissionEvidenceFor?.(
          input,
          declaration.attempt,
        );
        if (!evidence)
          throw new ConflictError(
            'The open final artifact and exact transport evidence are required',
          );
        const admitted = config.now().getTime();
        if (!Number.isSafeInteger(admitted) || admitted < checkedAt)
          throw new ConflictError('The final admission clock is invalid');
        assertHistoricalPutVersionUsable(
          version,
          input.requiredThrough,
          admitted,
        );
        const permission = buildPublishedHistoryFinalPermission(
          input,
          declaration,
          evidence,
          new Date(admitted).toISOString(),
        );
        const result = await this.files
          .updateOne(
            {
              ...filter,
              'publishedHistoryFinalIntent.definitionHash':
                input.expectedFinalIntentHash,
              'publishedHistoryFinalPutDeclaration.attempt.definitionHash':
                input.expectedAttemptDefinitionHash,
              'publishedHistoryFinalPutDeclaration.protection.protectionHash':
                input.expectedProtectionHash,
              publishedHistoryFinalPutPermission: { $exists: false },
            },
            { $set: { publishedHistoryFinalPutPermission: permission } },
            { session },
          )
          .exec();
        if (result.modifiedCount !== 1)
          throw new ConflictError(
            'The published history final permission changed',
          );
        return Object.freeze({ recorded: true as const, permission });
      },
    );
  }

  async observePublishedFinalPermission(
    raw: PublishedHistoryFinalPermissionInput,
  ) {
    const input = publishedHistoryFinalPermissionInput(raw);
    const current = await this.readPublishedFinalPermission(input);
    if (!current) return null;
    return Object.freeze({
      permission: current.context.permission,
      ...(current.transportObservation
        ? { transportObservation: current.transportObservation }
        : {}),
      copyDispatch: 'NOT_AUTHORIZED' as const,
    });
  }

  private async readPublishedFinalPermission(
    input: PublishedHistoryFinalPermissionInput,
    session?: ClientSession,
  ) {
    const historical = await this.readPublishedCopyPermission(
      input.staging.selection,
      session,
    );
    if (!historical) return null;
    const checked = this.checkedPublishedFinalPermission(
      input,
      historical.file,
    );
    return checked
      ? { ...checked, filter: { ...historical.filter, ...checked.filter } }
      : null;
  }

  private checkedPublishedFinalPermission(
    input: PublishedHistoryFinalPermissionInput,
    file: ArchiveFile,
  ) {
    const stored = file.publishedHistoryFinalPutPermission;
    const transport = file.publishedHistoryFinalPutTransportObservation;
    const finalVersion = file.publishedHistoryFinalPutVersion;
    if (
      stored === undefined &&
      transport === undefined &&
      finalVersion === undefined
    )
      return null;
    if (!stored)
      throw new ConflictError(
        'The stored published history final permission is inconsistent',
      );
    const { intent, version, staging, filter } =
      this.checkedPublishedFinalSource(input, file);
    const declaration = this.checkedPublishedFinalDeclaration(
      input,
      intent,
      staging,
      file,
    );
    assertHistoricalPutVersionUsable(
      version,
      input.requiredThrough,
      Date.parse(stored.admittedAt),
    );
    const permission = buildPublishedHistoryFinalPermission(
      input,
      declaration,
      {
        openedArtifactSeal: stored.artifact,
        transportRequestHash: stored.transportRequestHash,
      },
      stored.admittedAt,
    );
    if (archiveHash(stored) !== archiveHash(permission))
      throw new ConflictError(
        'The stored published history final permission is inconsistent',
      );
    const transportObservation =
      transport === undefined
        ? undefined
        : buildPublishedHistoryFinalTransportObservation(
            permission,
            transport?.localReturn,
          );
    if (
      transport !== undefined &&
      archiveHash(transport) !== archiveHash(transportObservation)
    )
      throw new ConflictError(
        'The stored final transport observation is inconsistent',
      );
    const context = { definition: declaration.attempt, permission };
    return {
      filter: {
        'publishedHistoryCopyIntent.definitionHash':
          input.staging.selection.expectedIntentHash,
        ...filter,
        'publishedHistoryStagingPutVersion.observation.observationHash':
          input.expectedStagingVersionObservationHash,
        'publishedHistoryFinalIntent.definitionHash':
          input.expectedFinalIntentHash,
        'publishedHistoryFinalPutDeclaration.attempt.definitionHash':
          input.expectedAttemptDefinitionHash,
        'publishedHistoryFinalPutDeclaration.protection.protectionHash':
          input.expectedProtectionHash,
        'publishedHistoryFinalPutPermission.permissionHash':
          permission.permissionHash,
      },
      transportObservation,
      context: Object.freeze({
        ...context,
        ...(finalVersion === undefined
          ? {}
          : {
              versionRecord: matchPublishedHistoryFinalPutVersionRecord(
                context,
                finalVersion,
              ),
            }),
      }),
    };
  }

  private checkedPublishedFinalDeclaration(
    input: PublishedHistoryFinalReadInput,
    intent: ReturnType<typeof buildPublishedHistoryFinalIntent>,
    staging: PublishedHistoryStagingPutAttempt,
    file: ArchiveFile,
  ): PublishedHistoryFinalPutDeclaration {
    const stored = file.publishedHistoryFinalPutDeclaration;
    if (!file.publishedHistoryFinalIntent || stored?.state !== 'INTENDED')
      throw new ConflictError(
        'The published history final declaration is absent',
      );
    const attempt = buildPublishedHistoryFinalPutAttempt(
      input,
      intent,
      staging,
    );
    const protection = protectPublishedHistoryFinalPutDestination(
      attempt,
      input.expectedControlsHash,
      input.expectedAccreditationHash,
      stored.accreditation,
    );
    const declaration: PublishedHistoryFinalPutDeclaration = {
      state: 'INTENDED',
      attempt,
      accreditation: stored.accreditation,
      protection,
    };
    if (
      attempt.definitionHash !== input.expectedAttemptDefinitionHash ||
      protection.protectionHash !== input.expectedProtectionHash ||
      archiveHash(stored) !== archiveHash(declaration)
    )
      throw new ConflictError(
        'The published history final declaration changed',
      );
    return declaration;
  }

  private withUnpermittedPublishedFinal<Result>(
    input: PublishedHistoryFinalReadInput,
    finish: (context: {
      declaration: PublishedHistoryFinalPutDeclaration;
      filter: FilterQuery<ArchiveFile>;
      version: PublishedHistoryStagingPutVersionRecord;
      session: ClientSession;
      config: PublishedHistoryDestinationConfirmation;
      checkedAt: number;
    }) => Result | Promise<Result>,
  ) {
    const config = this.destination;
    if (!config)
      throw new ConflictError(
        'Published history final protection is unavailable',
      );
    return this.withPublishedFinal(
      input,
      async ({ intent, file, staging, filter, version, session }) => {
        if (
          file.publishedHistoryFinalPutPermission !== undefined ||
          file.publishedHistoryFinalPutTransportObservation !== undefined ||
          file.publishedHistoryFinalPutVersion !== undefined
        )
          throw new ConflictError(
            'The published history final attempt already has a permission',
          );
        const declaration = this.checkedPublishedFinalDeclaration(
          input,
          intent,
          staging,
          file,
        );
        if (
          input.expectedControlsHash !==
          intent.predecessor.conservationControlsHash
        )
          await config.controls.fenceActiveSharedControls(
            input.expectedControlsHash,
            session,
          );
        const checkedAt = config.now().getTime();
        assertHistoricalPutVersionUsable(
          version,
          input.requiredThrough,
          checkedAt,
        );
        if (
          !putDestinationAdmissionWindowContains(
            declaration.protection,
            checkedAt,
          )
        )
          throw new ConflictError(
            'The published history final destination is outside its admission window',
          );
        return finish({
          declaration,
          filter,
          version,
          session,
          config,
          checkedAt,
        });
      },
    );
  }

  private checkedPublishedFinalSource(
    input: PublishedHistoryFinalInput,
    file: ArchiveFile,
  ) {
    const current = this.checkedPublishedStagingPermission(input.staging, file);
    const version = current?.context.versionRecord;
    if (!current || !version)
      throw new ConflictError(
        'The reconciled published history staging version is missing',
      );
    const intent = buildPublishedHistoryFinalIntent(
      input,
      file,
      current.context,
    );
    const stored = file.publishedHistoryFinalIntent;
    if (stored !== undefined && archiveHash(stored) !== archiveHash(intent))
      throw new ConflictError(
        'The published history final intent cannot be replaced',
      );
    return {
      intent,
      version,
      staging: current.context.definition,
      filter: current.filter,
    };
  }

  private withPublishedFinal<Result>(
    input: PublishedHistoryFinalInput,
    finish: (context: {
      intent: ReturnType<typeof buildPublishedHistoryFinalIntent>;
      staging: PublishedHistoryStagingPutAttempt;
      version: PublishedHistoryStagingPutVersionRecord;
      file: ArchiveFile;
      filter: FilterQuery<ArchiveFile>;
      session: ClientSession;
    }) => Result | Promise<Result>,
  ) {
    const config = this.destination;
    if (!config)
      throw new ConflictError(
        'Published history conservation controls are unavailable',
      );
    return this.withPublishedCopyFile(
      input.staging.selection,
      async ({ archive, file, filter, session }) => {
        const historical = publishedHistoryCopyIntentDefinition(
          input.staging.selection,
          archive,
          file,
        );
        if (
          historical.definitionHash !==
            input.staging.selection.expectedIntentHash ||
          archiveHash(historical) !==
            archiveHash(file.publishedHistoryCopyIntent)
        )
          throw new ConflictError(
            'The original published history intent is missing or changed',
          );
        const {
          intent,
          version,
          staging,
          filter: stagingFilter,
        } = this.checkedPublishedFinalSource(input, file);
        await config.controls.fenceActiveSharedControls(
          intent.predecessor.conservationControlsHash,
          session,
        );
        assertHistoricalPutVersionUsable(
          version,
          input.requiredThrough,
          config.now().getTime(),
        );
        return finish({
          intent,
          staging,
          version,
          file,
          filter: {
            ...filter,
            ...stagingFilter,
            'publishedHistoryCopyIntent.definitionHash':
              historical.definitionHash,
            'publishedHistoryStagingPutVersion.observation.observationHash':
              input.expectedStagingVersionObservationHash,
          },
          session,
        });
      },
    );
  }

  private async readPublishedStagingPermission(
    input: PublishedHistoryStagingPermissionInput,
    session?: ClientSession,
  ) {
    const current = await this.readPublishedCopyPermission(
      input.selection,
      session,
    );
    if (!current) return null;
    const checked = this.checkedPublishedStagingPermission(
      input,
      current.file,
      current,
    );
    return checked
      ? { ...checked, filter: { ...current.filter, ...checked.filter } }
      : null;
  }

  private checkedPublishedStagingPermission(
    input: PublishedHistoryStagingPermissionInput,
    file: ArchiveFile,
    historicalPermission = this.checkedPublishedCopyPermission(
      file,
      input.selection,
    ),
  ) {
    const permission = file.publishedHistoryStagingPutPermission;
    const transport = file.publishedHistoryStagingPutTransportObservation;
    const version = file.publishedHistoryStagingPutVersion;
    if (
      permission === undefined &&
      transport === undefined &&
      version === undefined
    )
      return null;
    const intent = file.publishedHistoryStagingIntent;
    const historical = file.publishedHistoryCopyIntent;
    if (
      !permission ||
      !historicalPermission?.context.versionRecord ||
      !intent ||
      !historical
    )
      throw new ConflictError(
        'The stored staging permission has no intact historical predecessor',
      );
    const rebuiltIntent = buildPublishedHistoryStagingIntent(
      input,
      historical,
      file,
      historicalPermission.context,
    );
    if (archiveHash(intent) !== archiveHash(rebuiltIntent))
      throw new ConflictError(
        'The stored staging permission has a different intent',
      );
    const declaration = this.checkedPublishedStagingDeclaration(
      input,
      rebuiltIntent,
      historicalPermission.context.definition,
      file,
    );
    assertHistoricalPutVersionUsable(
      historicalPermission.context.versionRecord,
      input.requiredThrough,
      Date.parse(permission.admittedAt),
    );
    const rebuilt = buildPublishedHistoryStagingPermission(
      input,
      declaration,
      {
        openedArtifactSeal: permission.artifact,
        transportRequestHash: permission.transportRequestHash,
      },
      permission.admittedAt,
    );
    if (archiveHash(rebuilt) !== archiveHash(permission))
      throw new ConflictError(
        'The stored published history staging permission is inconsistent',
      );
    const transportObservation =
      transport === undefined
        ? undefined
        : buildPublishedHistoryStagingTransportObservation(
            rebuilt,
            transport?.localReturn,
          );
    if (
      transport !== undefined &&
      archiveHash(transportObservation) !== archiveHash(transport)
    )
      throw new ConflictError(
        'The stored staging transport observation is inconsistent',
      );
    const context = { definition: declaration.attempt, permission: rebuilt };
    return {
      filter: {
        'publishedHistoryPutPermission.permissionHash':
          input.expectedPermissionHash,
        'publishedHistoryPutVersion.observation.observationHash':
          input.expectedVersionObservationHash,
        'publishedHistoryStagingIntent.definitionHash':
          input.expectedStagingIntentHash,
        'publishedHistoryStagingPutDeclaration.attempt.definitionHash':
          input.expectedAttemptDefinitionHash,
        'publishedHistoryStagingPutDeclaration.protection.protectionHash':
          input.expectedProtectionHash,
        'publishedHistoryStagingPutPermission.permissionHash':
          rebuilt.permissionHash,
      },
      transportObservation,
      context: Object.freeze({
        ...context,
        ...(version === undefined
          ? {}
          : {
              versionRecord: matchPublishedHistoryStagingPutVersionRecord(
                context,
                version,
              ),
            }),
      }),
    };
  }

  private checkedPublishedStagingDeclaration(
    input: PublishedHistoryStagingReadInput,
    intent: PublishedHistoryStagingIntent,
    historicalAttempt: PublishedHistoryPutAttempt,
    file: ArchiveFile,
  ): PublishedHistoryStagingPutDeclaration {
    const stored = file.publishedHistoryStagingPutDeclaration;
    if (!file.publishedHistoryStagingIntent || stored?.state !== 'INTENDED')
      throw new ConflictError(
        'The published history staging declaration is absent',
      );
    const attempt = buildPublishedHistoryStagingPutAttempt(
      intent,
      input,
      historicalAttempt,
    );
    const protection = protectPublishedHistoryStagingPutDestination(
      attempt,
      input.expectedControlsHash,
      input.expectedAccreditationHash,
      stored.accreditation,
    );
    const declaration: PublishedHistoryStagingPutDeclaration = {
      state: 'INTENDED',
      attempt,
      accreditation: stored.accreditation,
      protection,
    };
    if (
      attempt.definitionHash !== input.expectedAttemptDefinitionHash ||
      protection.protectionHash !== input.expectedProtectionHash ||
      archiveHash(stored) !== archiveHash(declaration)
    )
      throw new ConflictError(
        'The published history staging declaration changed',
      );
    return declaration;
  }

  private withUnpermittedPublishedStaging<Result>(
    input: PublishedHistoryStagingReadInput,
    finish: (context: {
      declaration: PublishedHistoryStagingPutDeclaration;
      filter: FilterQuery<ArchiveFile>;
      version: PublishedHistoryPutVersionRecord;
      session: ClientSession;
      config: PublishedHistoryDestinationConfirmation;
      checkedAt: number;
    }) => Result | Promise<Result>,
  ) {
    const config = this.destination;
    if (!config)
      throw new ConflictError(
        'Published history staging protection is unavailable',
      );
    return this.withPublishedStaging(
      input,
      async ({ intent, file, historicalAttempt, filter, version, session }) => {
        if (
          file.publishedHistoryStagingPutPermission !== undefined ||
          file.publishedHistoryStagingPutTransportObservation !== undefined ||
          file.publishedHistoryStagingPutVersion !== undefined
        )
          throw new ConflictError(
            'The published history staging attempt already has a permission',
          );
        const declaration = this.checkedPublishedStagingDeclaration(
          input,
          intent,
          historicalAttempt,
          file,
        );
        if (
          input.expectedControlsHash !==
          intent.predecessor.conservationControlsHash
        )
          await config.controls.fenceActiveSharedControls(
            input.expectedControlsHash,
            session,
          );
        const checkedAt = config.now().getTime();
        assertHistoricalPutVersionUsable(
          version,
          input.requiredThrough,
          checkedAt,
        );
        if (
          !putDestinationAdmissionWindowContains(
            declaration.protection,
            checkedAt,
          )
        )
          throw new ConflictError(
            'The published history staging destination is outside its admission window',
          );
        return finish({
          declaration,
          filter,
          version,
          session,
          config,
          checkedAt,
        });
      },
    );
  }

  private withPublishedStaging<Result>(
    input: PublishedHistoryStagingInput,
    finish: (context: {
      intent: PublishedHistoryStagingIntent;
      file: ArchiveFile;
      filter: FilterQuery<ArchiveFile>;
      historicalAttempt: PublishedHistoryPutAttempt;
      version: PublishedHistoryPutVersionRecord;
      session: ClientSession;
    }) => Result | Promise<Result>,
  ) {
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
        if (
          stored !== undefined &&
          archiveHash(stored) !== archiveHash(intent)
        ) {
          throw new ConflictError(
            'The published history staging intent cannot be replaced',
          );
        }
        return finish({
          intent,
          file,
          version,
          historicalAttempt: checked.context.definition,
          filter: {
            ...filter,
            'publishedHistoryCopyIntent.definitionHash':
              historical.definitionHash,
            'publishedHistoryPutPermission.permissionHash':
              input.expectedPermissionHash,
            'publishedHistoryPutVersion.observation.observationHash':
              input.expectedVersionObservationHash,
          },
          session,
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

  registerPublishedFinalMedia(
    raw: PublishedHistoryFinalMediaRegistrationInput,
  ) {
    const input = publishedHistoryFinalMediaRegistrationInput(raw);
    const { registrations, destination } = this;
    if (!registrations || !destination)
      throw new ConflictError(
        'Published history final media registration is unavailable',
      );
    return this.transaction(async (session) => {
      assertArchiveCallerTransaction(session, this.archives, [registrations]);
      const { archive, source, manifest } =
        await this.loadPublishedFinalCoverageArchives(input, session);
      await fenceArchiveReservation(
        archive,
        this.controls,
        this.periods,
        session,
      );
      const file = await this.files
        .findOne({
          archiveId: archive.id,
          id: input.fileId,
          definitionHash: input.expectedFileDefinitionHash,
        })
        .session(session)
        .lean()
        .exec();
      const retained = file?.retained;
      if (!file || !sourceHashValid(retained?.sourceFileId))
        throw new ConflictError('The original retained file is missing');
      const predecessors = await this.files
        .find({
          archiveId: source.id,
          id: retained.sourceFileId,
        })
        .select({
          _id: 0,
          id: 1,
          definitionHash: 1,
          historicalKey: 1,
          relativeKey: 1,
        })
        .limit(2)
        .session(session)
        .lean()
        .exec();
      const predecessor =
        predecessors.length === 1 ? predecessors[0] : undefined;
      const context = this.checkedPublishedFinalCoverageFile(
        input,
        archive,
        source,
        file,
        predecessor,
      );
      const record = context.versionRecord;
      if (
        record.observation.observationHash !==
        input.expectedVersionObservationHash
      )
        throw new ConflictError('The retained final version changed');
      await destination.controls.fenceActiveSharedControls(
        record.evidence.conservationControlsHash,
        session,
      );
      assertHistoricalPutVersionUsable(
        record,
        input.requiredThrough,
        destination.now().getTime(),
      );
      const registration = buildPublishedHistoryFinalMediaRegistration(
        archive,
        manifest,
        file,
        context,
      );
      await persistTransferredMediaRegistration(
        registrations,
        registration,
        session,
      );
      return registration;
    });
  }

  private async loadPublishedFinalCoverageArchives(
    input: PublishedHistoryFinalCoveragePageInput,
    session: ClientSession,
  ) {
    const { archive, source } = await this.loadPublishedCopyArchives(
      input,
      session,
    );
    if (
      archive.definitionHash !== input.expectedArchiveDefinitionHash ||
      !source.manifestDigest
    )
      throw new ConflictError(
        'Published history coverage requires the original sealed archive',
      );
    const manifest = captureItemManifestDigest(source.manifestDigest);
    if (manifest.manifestHash !== input.expectedSourceManifestHash)
      throw new ConflictError('The published predecessor manifest changed');
    return { archive, source, manifest };
  }

  private checkedPublishedFinalCoverageFile(
    input: PublishedHistoryFinalCoveragePageInput,
    archive: OwnershipArchive,
    source: OwnershipArchive,
    file: ArchiveFile,
    predecessor:
      | Pick<
          ArchiveFile,
          'id' | 'definitionHash' | 'historicalKey' | 'relativeKey'
        >
      | undefined,
  ) {
    const pins = publishedHistoryFinalCoverageSelection(input, file);
    const historical = publishedHistoryCopyIntentDefinition(
      pins.staging.selection,
      archive,
      file,
    );
    const retained = file.retained;
    if (
      !retained ||
      !predecessor ||
      predecessor.id !== retained.sourceFileId ||
      !sourceHashValid(retained.sourceDefinitionHash) ||
      predecessor.definitionHash !== retained.sourceDefinitionHash ||
      predecessor.historicalKey !== file.sourceKey ||
      predecessor.relativeKey !== retained.relativeKey ||
      archiveHash(historical) !==
        archiveHash(file.publishedHistoryCopyIntent) ||
      this.hasLegacyPublishedCopyState(file) ||
      file.sourceKey !==
        `users/${source.ownerId}/animals/${source.animalId}/ownership-archives/${source.id}/${retained.relativeKey}`
    )
      throw new ConflictError(
        'The retained file no longer matches the published predecessor',
      );
    const context = this.checkedPublishedFinalPermission(pins, file)?.context;
    if (!context?.versionRecord)
      throw new ConflictError(
        'The retained file has no reconciled final version',
      );
    return { ...context, versionRecord: context.versionRecord };
  }

  readPublishedFinalCoveragePage(
    raw: PublishedHistoryFinalCoveragePageInput,
  ): Promise<PublishedHistoryFinalCoveragePage> {
    return this.readPublishedCoveragePage(raw, false);
  }

  private readPublishedCoveragePage(
    raw: PublishedHistoryFinalCoveragePageInput,
    prepared: false,
  ): Promise<PublishedHistoryFinalCoveragePage>;
  private readPublishedCoveragePage(
    raw: PublishedHistoryFinalCoveragePageInput,
    prepared: true,
  ): Promise<PublishedHistoryPreparedCoveragePage>;
  private readPublishedCoveragePage(
    raw: PublishedHistoryFinalCoveragePageInput,
    prepared: true,
    projection: true,
    snapshot?: PublishedHistoryProjectionSnapshot,
  ): Promise<PublishedHistoryProjectionMediaPage>;
  private readPublishedCoveragePage(
    raw: PublishedHistoryFinalCoveragePageInput,
    prepared: boolean,
    projection = false,
    snapshot?: PublishedHistoryProjectionSnapshot,
  ): Promise<PublishedHistoryFinalCoveragePage> {
    const input = publishedHistoryFinalCoverageInput(raw);
    const config = this.destination;
    const registrations = prepared ? this.registrations : undefined;
    const assertActive = config?.controls.assertActiveSharedControls?.bind(
      config.controls,
    );
    if (!config || !assertActive || (prepared && !registrations))
      throw new ConflictError(
        'Published history coverage controls are unavailable',
      );
    const read = async (session: ClientSession) => {
      if (registrations)
        assertArchiveCallerTransaction(session, this.archives, [registrations]);
      const { archive, source, manifest } =
        snapshot ??
        (await this.loadPublishedFinalCoverageArchives(input, session));
      const control = await this.controls
        .findOne({ animalId: archive.animalId })
        .session(session)
        .lean()
        .exec();
      assertArchiveReservationControl(archive, control);
      const retainedFiles = {
        archiveId: archive.id,
        retained: { $exists: true },
      };
      const files = await this.files
        .find({
          ...retainedFiles,
          ...(input.afterSourceFileId === undefined
            ? {}
            : {
                'retained.sourceFileId': { $gt: input.afterSourceFileId },
              }),
        })
        .sort({ 'retained.sourceFileId': 1 })
        .collation({ locale: 'simple' })
        .limit(ITEM_MANIFEST_PAGE_SIZE)
        .session(session)
        .lean()
        .exec();
      const sourceIds = files.map((file) => file.retained?.sourceFileId);
      if (!sourceIds.every(sourceHashValid))
        throw new ConflictError(
          'The retained file has no valid predecessor identity',
        );
      if (!files.length) {
        const retainedCount = await this.files
          .countDocuments(retainedFiles)
          .session(session)
          .exec();
        const totalCount = await this.files
          .countDocuments({ archiveId: archive.id })
          .session(session)
          .exec();
        if (
          retainedCount !== manifest.fileCount ||
          totalCount !== archive.expectedFileCount
        )
          throw new ConflictError(
            'The archive file counts differ from the sealed counts',
          );
        if (registrations) {
          const preparedCount = await registrations
            .countDocuments({
              archiveId: archive.id,
              protocol: PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL,
            })
            .session(session)
            .exec();
          if (preparedCount !== retainedCount)
            throw new ConflictError(
              'The prepared retained reference count differs from the manifest',
            );
        }
      }
      const sourceFiles = files.length
        ? await this.files
            .find({ archiveId: source.id, id: { $in: sourceIds } })
            .select({
              _id: 0,
              id: 1,
              definitionHash: 1,
              historicalKey: 1,
              relativeKey: 1,
            })
            .limit(files.length + 1)
            .session(session)
            .lean()
            .exec()
        : [];
      const sourceById = new Map(sourceFiles.map((file) => [file.id, file]));
      if (
        sourceById.size !== sourceFiles.length ||
        sourceFiles.length !== files.length
      )
        throw new ConflictError(
          'The published predecessor file page is incomplete or duplicated',
        );

      const generations = new Set<string>();
      const versions = files.map((file) => {
        const retained = file.retained;
        const predecessor = retained && sourceById.get(retained.sourceFileId);
        if (!retained)
          throw new ConflictError('The retained file provenance is missing');
        const {
          definition,
          permission,
          versionRecord: record,
        } = this.checkedPublishedFinalCoverageFile(
          input,
          archive,
          source,
          file,
          predecessor,
        );
        const conservationControlsHash =
          record.evidence.conservationControlsHash;
        generations.add(conservationControlsHash);
        let historicalVersion: PublishedHistoryPutVersionRecord | undefined;
        if (snapshot?.stableCutFiles) {
          const pins = publishedHistoryFinalCoverageSelection(input, file);
          const historical = this.checkedPublishedCopyPermission(
            file,
            pins.staging.selection,
          )?.context;
          historicalVersion = historical?.versionRecord;
          const staging = file.publishedHistoryStagingPutPermission;
          if (
            !historical ||
            !historicalVersion ||
            !staging ||
            historicalVersion.observation.scope.target.key !==
              file.historicalKey ||
            historicalVersion.observation.scope.sha256 !==
              record.observation.scope.sha256
          )
            throw new ConflictError(
              'The retained historical version does not match the final copy',
            );
          const pin = ({
            attemptDefinitionHash,
            protectionHash,
            authorizationId,
            permissionHash,
          }:
            | typeof permission
            | typeof staging
            | typeof historical.permission) =>
            Object.freeze({
              attemptDefinitionHash,
              protectionHash,
              authorizationId,
              permissionHash,
            });
          const version = ({
            observation,
            evidence,
          }:
            | PublishedHistoryPutVersionRecord
            | PublishedHistoryFinalPutVersionRecord) =>
            Object.freeze({
              observationHash: observation.observationHash,
              target: observation.scope.target,
              revision: observation.revision,
              sha256: observation.scope.sha256,
              conservationControlsHash: evidence.conservationControlsHash,
            });
          generations.add(historicalVersion.evidence.conservationControlsHash);
          snapshot.stableCutFiles.push(
            Object.freeze({
              fileId: file.id,
              fileDefinitionHash: file.definitionHash,
              sourceFileId: retained.sourceFileId,
              attempts: Object.freeze([
                pin(historical.permission),
                pin(staging),
                pin(permission),
              ] as const),
              historical: version(historicalVersion),
              final: version(record),
            }),
          );
        }
        return {
          record,
          historicalVersion,
          ...(registrations
            ? {
                registration: buildPublishedHistoryFinalMediaRegistration(
                  archive,
                  manifest,
                  file,
                  { definition, permission, versionRecord: record },
                ),
              }
            : {}),
          row: Object.freeze({
            sourceFileId: retained.sourceFileId,
            sourceDefinitionHash: retained.sourceDefinitionHash,
            fileId: file.id,
            fileDefinitionHash: file.definitionHash,
            intentDefinitionHash: definition.intentDefinitionHash,
            attemptDefinitionHash: definition.definitionHash,
            permissionHash: permission.permissionHash,
            versionObservationHash: record.observation.observationHash,
            conservationControlsHash,
          }),
        };
      });
      if (registrations && files.length) {
        const stored = await registrations
          .find({
            archiveId: archive.id,
            fileId: { $in: files.map(({ id }) => id) },
          })
          .limit(files.length + 1)
          .session(session)
          .lean()
          .exec();
        const byFile = new Map(stored.map((row) => [row.fileId, row]));
        if (stored.length !== files.length || byFile.size !== stored.length)
          throw new ConflictError(
            'Prepared retained references are missing or duplicated',
          );
        for (const { row, registration } of versions) {
          const found = byFile.get(row.fileId);
          if (!found || !registration)
            throw new ConflictError(
              'The retained file has no prepared reference',
            );
          assertSameMediaRegistration(found, registration);
        }
      }
      for (const generation of generations)
        await assertActive(generation, session);
      const checkedAt = config.now().getTime();
      if (
        !Number.isSafeInteger(checkedAt) ||
        checkedAt > historicalPutEvidenceTime(input.requiredThrough)
      )
        throw new ConflictError(
          'The published history coverage horizon is no longer valid',
        );
      if (snapshot)
        snapshot.lastCheckedAt = Math.max(snapshot.lastCheckedAt, checkedAt);
      for (const { record, historicalVersion } of versions) {
        assertHistoricalPutVersionUsable(
          record,
          input.requiredThrough,
          checkedAt,
        );
        if (historicalVersion)
          assertHistoricalPutVersionUsable(
            historicalVersion,
            input.requiredThrough,
            checkedAt,
          );
      }
      return Object.freeze({
        archiveDefinitionHash: archive.definitionHash,
        reservationBindingHash: archive.reservation!.bindingHash,
        sourceArchiveId: source.id,
        publicationHash: input.expectedPublicationHash,
        sourceManifestHash: manifest.manifestHash,
        sourceFileCount: manifest.fileCount,
        sourceFilesDigest: manifest.filesDigest,
        ...(projection
          ? {
              media: Object.freeze(
                versions.map(({ registration }) => registration!),
              ),
            }
          : {}),
        rows: Object.freeze(
          versions.map(({ row, registration }) =>
            registration
              ? Object.freeze({
                  ...row,
                  registrationDefinitionHash: registration.definitionHash,
                })
              : row,
          ),
        ),
      });
    };
    return snapshot ? read(snapshot.session) : this.transaction(read);
  }

  readPublishedPreparedCoveragePage(
    raw: PublishedHistoryFinalCoveragePageInput,
  ) {
    return this.readPublishedCoveragePage(raw, true);
  }

  readPublishedProjectionMediaPage(
    raw: PublishedHistoryFinalCoveragePageInput,
  ) {
    return this.readPublishedCoveragePage(raw, true, true);
  }

  /** Rebuilds and fences the selected candidate in the transaction owned by its future consumer. */
  async fencePublishedRecipientProjectionWithinTransaction(
    raw: PublishedHistoryRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    const { projection } = await this.fenceSelectedPublishedProjection(
      raw,
      session,
      urls,
    );
    return projection;
  }

  /** Local scope for an independent stable-cut accreditation. */
  async fencePublishedStableCutScopeWithinTransaction(
    raw: PublishedHistoryRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    const files: PublishedHistoryStableCutFile[] = [];
    const { projection, scope } = await this.fenceSelectedPublishedProjection(
      raw,
      session,
      urls,
      files,
    );
    if (!scope)
      throw new ConflictError(
        'The published history stable-cut scope is unavailable',
      );
    return Object.freeze({ projection, scope });
  }

  /** Uses an independent report obtained outside Mongo and fences its controls in this session. */
  async matchPublishedStableCutAccreditationWithinTransaction(
    raw: PublishedHistoryStableCutSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    const { projection, scope, accreditation, observation } =
      await this.publishedStableCutAccreditationInTransaction(
        raw,
        session,
        urls,
        'MATCH',
      );
    return Object.freeze({ projection, scope, accreditation, observation });
  }

  registerPublishedStableCutAccreditationWithinTransaction(
    raw: PublishedHistoryStableCutSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    return this.publishedStableCutAccreditationInTransaction(
      raw,
      session,
      urls,
      'REGISTER',
    );
  }

  readPublishedStableCutAccreditationWithinTransaction(
    raw: PublishedHistoryStableCutSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    return this.publishedStableCutAccreditationInTransaction(
      raw,
      session,
      urls,
      'READ',
    );
  }

  /** The writer is internal and must apply retained references using the supplied session. */
  async consumePublishedStableCutWithinTransaction<Result>(
    raw: PublishedHistoryStableCutSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    writeBusiness: (
      input: Readonly<{
        projection: Awaited<
          ReturnType<PublishedHistoryRecipientProjectionReader['read']>
        >;
        consumption: PublishedHistoryStableCutConsumption;
      }>,
      session: ClientSession,
    ) => Promise<Result>,
  ) {
    assertArchiveCallerTransaction(session, this.archives, []);
    const transaction = session.transaction;
    try {
      const config = this.destination;
      if (!config || typeof writeBusiness !== 'function')
        throw new ConflictError(
          'Published history stable-cut consumption requires transactional business writes',
        );
      const { projection, record, observation } =
        await this.readPublishedStableCutAccreditationWithinTransaction(
          raw,
          session,
          urls,
        );
      const consumption = buildPublishedHistoryStableCutConsumption(
        record,
        observation.checkedAt,
      );
      const { binding } = consumption;
      const saved = await this.archives
        .updateOne(
          {
            id: binding.archiveId,
            definitionHash: binding.archiveDefinitionHash,
            state: 'COPYING',
            capture: { $exists: false },
            'history.phase': 'COMPLETE',
            'history.sourceArchiveId': binding.sourceArchiveId,
            'history.sourcePublicationHash': binding.publicationHash,
            'reservation.epoch': binding.reservationEpoch,
            'reservation.bindingHash': binding.reservationBindingHash,
            ownershipCommitHash: { $exists: false },
            evidenceConsumption: { $exists: false },
          },
          { $set: { evidenceConsumption: consumption } },
          { session },
        )
        .exec();
      if (saved.modifiedCount !== 1)
        throw new ConflictError(
          'The published history archive was changed or consumed',
        );

      const result = await writeBusiness(
        Object.freeze({ projection, consumption }),
        session,
      );
      if (session.transaction !== transaction)
        throw new ConflictError(
          'The published history consumption transaction changed',
        );
      assertArchiveCallerTransaction(session, this.archives, []);
      const { projectionHash, ...candidate } = projection;
      const { definitionHash, ...marker } = consumption;
      if (
        archiveHash(candidate) !== projectionHash ||
        archiveHash(marker) !== definitionHash
      )
        throw new ConflictError(
          'The published history projection or consumption changed during business writes',
        );
      const after = matchPublishedHistoryStableCutAccreditation(
        record.scope,
        record.accreditation,
        record.accreditationHash,
        config.now().getTime(),
      );
      if (after.checkedAt < consumption.consumedAt)
        throw new ConflictError(
          'The published history stable-cut clock moved before consumption',
        );
      return Object.freeze({ consumption, result });
    } catch (error) {
      if (session.transaction === transaction && session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
  }

  private async publishedStableCutAccreditationInTransaction(
    raw: PublishedHistoryStableCutSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    mode: 'MATCH' | 'REGISTER' | 'READ',
  ) {
    const config = this.destination;
    const records = mode === 'MATCH' ? undefined : this.copyRecords;
    const { selection, expectedScopeHash, expectedAccreditationHash } = raw;
    if (
      !config ||
      (mode === 'MATCH' && !config.stableCutAccreditationFor) ||
      (mode !== 'MATCH' && !records) ||
      ![expectedScopeHash, expectedAccreditationHash].every(sourceHashValid)
    )
      throw new ConflictError(
        'Published history stable-cut accreditation is unavailable',
      );
    assertArchiveCallerTransaction(
      session,
      this.archives,
      records ? [records] : [],
    );
    const transaction = session.transaction;
    try {
      const { projection, scope } =
        await this.fencePublishedStableCutScopeWithinTransaction(
          selection,
          session,
          urls,
        );
      if (scope.scopeHash !== expectedScopeHash)
        throw new ConflictError(
          'The published history stable-cut scope changed',
        );
      const id = publishedHistoryStableCutAccreditationRecordId(
        scope.scopeHash,
        expectedAccreditationHash,
      );
      const stored =
        records &&
        (await records
          .findOne({ id })
          .select({ _id: 0 })
          .session(session)
          .lean()
          .exec());
      if (stored && stored.row !== 'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION')
        throw new ConflictError(
          'The published history accreditation identity is already in use',
        );
      if (!stored && mode === 'READ')
        throw new ConflictError(
          'The selected published history accreditation is absent',
        );
      const accreditation = structuredClone(
        stored
          ? stored.accreditation
          : config.stableCutAccreditationFor?.(
              structuredClone(scope),
              expectedAccreditationHash,
            ),
      );
      if (!accreditation)
        throw new ConflictError(
          'The independent published history stable-cut accreditation is absent',
        );
      const observed = matchPublishedHistoryStableCutAccreditation(
        scope,
        accreditation,
        expectedAccreditationHash,
        config.now().getTime(),
      );
      if (session.transaction !== transaction)
        throw new ConflictError(
          'The published history accreditation transaction changed',
        );
      assertArchiveCallerTransaction(session, this.archives, []);
      if (
        !scope.retained.conservationControlsHashes.includes(
          observed.controlsHash,
        )
      )
        await config.controls.fenceActiveSharedControls(
          observed.controlsHash,
          session,
        );
      const observation = matchPublishedHistoryStableCutAccreditation(
        scope,
        accreditation,
        expectedAccreditationHash,
        config.now().getTime(),
      );
      if (
        session.transaction !== transaction ||
        observation.checkedAt < observed.checkedAt ||
        (stored && observation.checkedAt < stored.recordedAt)
      )
        throw new ConflictError(
          'The published history accreditation transaction or clock changed',
        );
      assertArchiveCallerTransaction(
        session,
        this.archives,
        records ? [records] : [],
      );
      const record = buildPublishedHistoryStableCutAccreditationRecord(
        scope,
        accreditation,
        expectedAccreditationHash,
        stored ? stored.recordedAt : observation.checkedAt,
      );
      if (stored && archiveHash(stored) !== archiveHash(record))
        throw new ConflictError(
          'The stored published history accreditation changed',
        );
      if (mode === 'REGISTER' && records && !stored)
        await records.create([record], { session });
      return Object.freeze({
        projection,
        scope,
        accreditation,
        observation,
        record,
      });
    } catch (error) {
      if (session.transaction === transaction && session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
  }

  private async fenceSelectedPublishedProjection(
    raw: PublishedHistoryRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    stableCutFiles?: PublishedHistoryStableCutFile[],
  ) {
    const { registrations, destination } = this;
    if (!registrations || !destination)
      throw new ConflictError(
        'Published history projection controls are unavailable',
      );
    assertArchiveCallerTransaction(session, this.archives, [
      this.entries,
      this.files,
      this.periods,
      this.controls,
      registrations,
    ]);
    const transaction = session.transaction;
    try {
      const selection = publishedHistoryRecipientProjectionSelection(raw);
      const { archive, source, manifest } =
        await this.loadPublishedFinalCoverageArchives(selection, session);
      await fenceArchiveReservation(
        archive,
        this.controls,
        this.periods,
        session,
      );
      const snapshot = {
        session,
        archive,
        source,
        manifest,
        lastCheckedAt: Number.NEGATIVE_INFINITY,
        stableCutFiles,
      };
      const observer = new PublishedHistoryFinalCoverageObserver({
        readPublishedProjectionMediaPage: (input) =>
          this.readPublishedCoveragePage(input, true, true, snapshot),
        readPublishedProjectionEntryPage: (input) =>
          this.readPublishedEntryPage(input, true, snapshot),
      });
      const projection = await new PublishedHistoryRecipientProjectionReader(
        observer,
        urls,
      ).read(selection);
      if (projection.projectionHash !== selection.expectedProjectionHash)
        throw new ConflictError(
          'The published history recipient projection changed',
        );
      if (session.transaction !== transaction)
        throw new ConflictError(
          'The published history projection transaction changed',
        );
      assertArchiveCallerTransaction(session, this.archives, [registrations]);
      const generations = new Set(
        projection.media.map(
          ({ publishedHistoryEvidence }) =>
            publishedHistoryEvidence.conservationControlsHash,
        ),
      );
      let scope:
        | ReturnType<typeof buildPublishedHistoryStableCutScope>
        | undefined;
      if (stableCutFiles) {
        if (stableCutFiles.length !== projection.media.length)
          throw new ConflictError(
            'The retained versions do not cover the selected projection',
          );
        scope = buildPublishedHistoryStableCutScope(projection, stableCutFiles);
        for (const generation of scope.retained.conservationControlsHashes)
          generations.add(generation);
      }
      for (const generation of generations)
        await destination.controls.fenceActiveSharedControls(
          generation,
          session,
        );
      const checkedAt = destination.now().getTime();
      if (
        !Number.isSafeInteger(checkedAt) ||
        checkedAt < snapshot.lastCheckedAt ||
        checkedAt > historicalPutEvidenceTime(selection.requiredThrough)
      )
        throw new ConflictError(
          'The published history projection horizon is no longer valid',
        );
      assertArchiveCallerTransaction(session, this.archives, [registrations]);
      return { projection, scope };
    } catch (error) {
      if (session.transaction === transaction && session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
  }

  readPublishedRetainedEntryPage(
    raw: PublishedHistoryRetainedEntryPageInput,
  ): Promise<PublishedHistoryRetainedEntryPage> {
    return this.readPublishedEntryPage(raw, false);
  }

  readPublishedProjectionEntryPage(
    raw: PublishedHistoryRetainedEntryPageInput,
  ) {
    return this.readPublishedEntryPage(raw, true);
  }

  private readPublishedEntryPage(
    raw: PublishedHistoryRetainedEntryPageInput,
    projection: false,
  ): Promise<PublishedHistoryRetainedEntryPage>;
  private readPublishedEntryPage(
    raw: PublishedHistoryRetainedEntryPageInput,
    projection: true,
    snapshot?: PublishedHistoryProjectionSnapshot,
  ): Promise<PublishedHistoryProjectionEntryPage>;
  private readPublishedEntryPage(
    raw: PublishedHistoryRetainedEntryPageInput,
    projection: boolean,
    snapshot?: PublishedHistoryProjectionSnapshot,
  ): Promise<PublishedHistoryRetainedEntryPage> {
    const input = publishedHistoryFinalCoverageInput(raw);
    const after = raw.afterSourceEntryId;
    if (after !== undefined && !sourceHashValid(after))
      throw new ConflictError('Invalid published retained entry cursor');
    const read = async (session: ClientSession) => {
      const { archive, source, manifest } =
        snapshot ??
        (await this.loadPublishedFinalCoverageArchives(input, session));
      const control = await this.controls
        .findOne({ animalId: archive.animalId })
        .session(session)
        .lean()
        .exec();
      assertArchiveReservationControl(archive, control);
      const retainedEntries = {
        archiveId: archive.id,
        kind: 'RETAINED_RECORD' as const,
      };
      const entries = await this.entries
        .find({
          ...retainedEntries,
          ...(after === undefined
            ? {}
            : { 'retained.sourceEntryId': { $gt: after } }),
        })
        .sort({ 'retained.sourceEntryId': 1 })
        .collation({ locale: 'simple' })
        .limit(ITEM_MANIFEST_PAGE_SIZE)
        .session(session)
        .lean()
        .exec();
      const sourceIds = entries.map(({ retained }) => retained?.sourceEntryId);
      if (!sourceIds.every(sourceHashValid))
        throw new ConflictError(
          'A retained entry has no valid predecessor identity',
        );
      if (!entries.length) {
        const count = await this.entries
          .countDocuments(retainedEntries)
          .session(session)
          .exec();
        const total = await this.entries
          .countDocuments({ archiveId: archive.id })
          .session(session)
          .exec();
        if (
          count !== manifest.entryCount ||
          total !== archive.expectedEntryCount
        )
          throw new ConflictError(
            'Retained entry counts differ from the sealed counts',
          );
      }
      const originals = entries.length
        ? await this.entries
            .find({
              archiveId: source.id,
              id: { $in: sourceIds },
            })
            .limit(entries.length + 1)
            .session(session)
            .lean()
            .exec()
        : [];
      const byId = new Map(originals.map((entry) => [entry.id, entry]));
      if (originals.length !== entries.length || byId.size !== originals.length)
        throw new ConflictError(
          'Published predecessor entries are missing or duplicated',
        );
      const rows = [];
      for (const entry of entries) {
        const original =
          entry.retained && byId.get(entry.retained.sourceEntryId);
        if (!original)
          throw new ConflictError(
            'The retained entry has no published predecessor',
          );
        rows.push(
          await this.checkedPublishedRetainedEntry(
            input,
            archive,
            source,
            original,
            entry,
            session,
          ),
        );
      }
      return Object.freeze({
        reservationBindingHash: archive.reservation!.bindingHash,
        sourceArchiveId: source.id,
        sourceEntryCount: manifest.entryCount,
        sourceEntriesDigest: manifest.entriesDigest,
        rows: Object.freeze(rows),
        ...(projection
          ? {
              sourceDefinition: archiveDefinitionOnly(source),
              entries: Object.freeze(
                entries.map(
                  ({
                    id,
                    archiveId,
                    kind,
                    resourceId,
                    payload,
                    fileBindings,
                    contentHash,
                    retained,
                  }) => ({
                    id,
                    archiveId,
                    kind,
                    resourceId,
                    payload,
                    fileBindings,
                    contentHash,
                    retained,
                  }),
                ),
              ),
            }
          : {}),
      });
    };
    return snapshot ? read(snapshot.session) : this.transaction(read);
  }

  private async checkedPublishedRetainedEntry(
    input: PublishedHistoryFinalCoveragePageInput,
    archive: OwnershipArchive,
    source: OwnershipArchive,
    original: ArchiveEntry,
    entry: ArchiveEntry,
    session: ClientSession,
  ) {
    const invalid = () =>
      new ConflictError(
        'The retained entry or its file bindings differ from the published predecessor',
      );
    if (
      source.ownershipVersion !== 1 ||
      original.retained !== undefined ||
      original.kind === 'RETAINED_RECORD' ||
      !['ANIMAL', 'DIARY_ENTRY', 'MEDICAL_DOCUMENT'].includes(original.kind) ||
      original.id !==
        archiveHash([source.id, original.kind, original.resourceId]) ||
      original.contentHash !==
        archiveHash({
          kind: original.kind,
          payload: original.payload,
          fileBindings: original.fileBindings,
        }) ||
      !Array.isArray(original.fileBindings) ||
      !Array.isArray(entry.fileBindings)
    )
      throw invalid();
    const retained = {
      rootArchiveId: source.id,
      rootEntryId: original.id,
      kind: original.kind,
      resourceId: original.resourceId,
      ownerId: source.ownerId,
      periodId: source.periodId,
      ownershipVersion: source.ownershipVersion,
      sourceArchiveId: source.id,
      sourceEntryId: original.id,
      sourceContentHash: original.contentHash,
      sourcePublicationHash: input.expectedPublicationHash,
    };
    const resourceId = archiveHash([source.id, original.id]);
    if (
      entry.id !== archiveHash([archive.id, 'RETAINED_RECORD', resourceId]) ||
      entry.resourceId !== resourceId ||
      archiveHash(entry.retained) !== archiveHash(retained) ||
      archiveHash(entry.payload) !== archiveHash(original.payload) ||
      entry.contentHash !==
        archiveHash({
          kind: 'RETAINED_RECORD',
          payload: entry.payload,
          fileBindings: entry.fileBindings,
          retained,
        }) ||
      entry.fileBindings.length !== original.fileBindings.length
    )
      throw invalid();

    const fileIds = new Set<string>();
    for (const binding of entry.fileBindings) {
      if (!sourceHashValid(binding?.fileId)) throw invalid();
      fileIds.add(binding.fileId);
    }
    const files = fileIds.size
      ? await this.files
          .find({
            archiveId: archive.id,
            id: { $in: [...fileIds] },
          })
          .select({ _id: 0, id: 1, retained: 1, sourceKey: 1 })
          .limit(fileIds.size + 1)
          .session(session)
          .lean()
          .exec()
      : [];
    const byId = new Map(files.map((file) => [file.id, file]));
    if (files.length !== fileIds.size || byId.size !== files.length)
      throw invalid();
    const paths = new Set<string>();
    for (const [index, binding] of entry.fileBindings.entries()) {
      const sourceBinding = original.fileBindings[index];
      const file = byId.get(binding.fileId);
      const origin = file?.retained;
      if (
        !sourceHashValid(sourceBinding?.fileId) ||
        typeof binding.path !== 'string' ||
        binding.path.length === 0 ||
        binding.path !== sourceBinding.path ||
        paths.has(binding.path) ||
        !file ||
        !origin ||
        file.sourceKey !==
          `users/${source.ownerId}/animals/${source.animalId}/ownership-archives/${source.id}/${origin.relativeKey}` ||
        binding.fileId !== archiveHash([archive.id, file.sourceKey]) ||
        origin.sourceArchiveId !== source.id ||
        origin.publishedSource?.publicationHash !==
          input.expectedPublicationHash ||
        origin.sourceFileId !== sourceBinding.fileId ||
        origin.rootArchiveId !== source.id ||
        origin.rootFileId !== sourceBinding.fileId
      )
        throw invalid();
      paths.add(binding.path);
    }
    return Object.freeze({
      sourceEntryId: original.id,
      sourceContentHash: original.contentHash,
      entryId: entry.id,
      contentHash: entry.contentHash,
    });
  }

  private hasLegacyPublishedCopyState(file: ArchiveFile) {
    return Object.keys(this.legacyPublishedCopyExclusions()).some(
      (key) => file[key as keyof ArchiveFile] !== undefined,
    );
  }

  private legacyPublishedCopyExclusions() {
    return {
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
      const { archive, source } = await this.loadPublishedCopyArchives(
        input,
        session,
      );
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
        ...this.legacyPublishedCopyExclusions(),
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

  private async loadPublishedCopyArchives(
    input: Pick<
      PublishedHistoryCopyInput,
      'archiveId' | 'expectedPublicationHash' | 'expectedReservationEpoch'
    >,
    session: ClientSession,
  ) {
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
    return { archive, source };
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
