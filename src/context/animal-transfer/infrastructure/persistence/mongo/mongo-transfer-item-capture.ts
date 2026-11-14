import {
  Injectable,
  HttpException,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, STATES } from 'mongoose';
import { DomainError } from '../../../../shared/domain/DomainError';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../../../shared/domain/errors/ResourceNotFoundError';
import { ItemRecipientFinalCoverageObserver } from '../../../application/item-recipient-final-coverage-observer';
import { ItemRecipientProjectionReader } from '../../../application/item-recipient-projection-reader';
import {
  ItemCaptureAdmission,
  ItemCaptureInput,
  ItemCaptureProgress,
  ItemCaptureSnapshot,
  ItemCopyPreparationInspection,
  ItemCaptureStore,
  assessItemCapture,
  assessLaterPeriodItemDossier,
  assessLaterPeriodItemPreparation,
  itemCaptureInput,
  inspectItemCopyPreparation,
  nextItemCaptureFence,
  selectItemCapture,
} from '../../../domain/transfer-item-capture';
import {
  TransferRequestItem,
  TransferRequestRecord,
} from '../../../domain/transfer-request';
import {
  AcceptanceStartBinding,
  acceptedRequestStatus,
} from '../../../domain/transfer-acceptance-start';
import {
  buildItemOwnershipCommit,
  buildLaterPeriodItemOwnershipCommit,
  type ItemOwnershipCommit,
  type LaterPeriodItemOwnershipCommit,
  type TransferItemOwnershipCommit,
} from '../../../domain/transfer-item-ownership-commit';
import { transferRecordId } from '../../../domain/transfer-record-id';
import {
  archiveDefinitionOnly,
  buildArchiveReservation,
} from '../../../domain/ownership-archive-reservation';
import { writeOwnershipPeriodsAndControl } from './write-ownership-periods-and-control';
import {
  PublishedHistoryPageInput,
  PublishedHistoryFileVersion,
  PublishedHistoryFileInput,
  PublishedHistoryVersionInput,
  projectPublishedHistoryEntry,
  projectPublishedRetainedEntry,
  publishedHistoryPageInput,
  publishedHistoryVersionInput,
  publishedHistoryFileInput,
} from '../../../domain/published-ownership-history';
import {
  PublishedHistoryConservationEvidence,
  PublishedHistoryConservationScope,
  assertPublishedHistoryConservationWindow,
  buildPublishedHistoryConservation,
  publishedHistoryConservationId,
  publishedHistoryConservationScope,
} from '../../../domain/published-history-conservation';
import type { UserEntity } from '../../../../user/infrastructure/persistence/mongo/user.schema';
import {
  OwnershipArchive,
  ArchiveDefinition,
  ArchiveFile,
  ArchiveEntry,
  archiveHash,
  buildArchiveEntry,
} from '../../../domain/ownership-archive';
import {
  ItemRecipientFinalMediaRegistration,
  TransferredMediaRegistration,
  assertSameMediaRegistration,
  buildItemRecipientFinalMediaRegistration,
} from '../../../domain/ownership-archive-media-registration';
import {
  RequestClaim,
  TransferEvent,
  TransferNotice,
  TransferOutbox,
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
} from './transfer-request.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
} from './ownership-archive.schema';
import {
  ItemArchiveCopyIntent,
  ItemCopyIntentContext,
  ItemHistoricalCopyPreparationInput,
  ItemHistoricalCopyPreparationReceipt,
  ItemHistoricalSourceAnchorInput,
  ItemHistoricalSourceAnchorMaterial,
  ItemObservedCopyPreparationReceipt,
  ITEM_ARCHIVE_COPY_INTENT_PROTOCOL,
  buildItemHistoricalCopyIntent,
  captureItemArchiveFileDefinition,
  captureItemPutVersionSource,
  historicalCopyPreparationInput,
  historicalSourceAnchorInput,
  isPinnedItemSourceVersion,
} from '../../../domain/transfer-item-copy-intent';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';
import {
  assertArchiveCallerTransaction,
  fenceArchiveReservation,
} from './archive-reservation-fence';
import {
  ArchiveProjectionUrls,
  projectItemRecipientEntries,
} from '../../../domain/ownership-archive-recipient-projection';
import {
  LaterPeriodLiveMediaEvidence,
  LaterPeriodLiveMediaScope,
  LaterPeriodLiveMediaSelection,
  assertSameLaterPeriodLiveCopies,
  buildLaterPeriodLiveMediaRecord,
  laterPeriodLiveMediaRecordId,
  laterPeriodLiveMediaScope,
  laterPeriodLiveMediaSelection,
  matchLaterPeriodLiveMediaEvidence,
} from '../../../domain/later-period-live-media';
import {
  assertLaterPeriodLivePutWindow,
  buildLaterPeriodLivePutAttempt,
  buildLaterPeriodLivePutDeclaration,
  buildLaterPeriodLivePutPermission,
  buildLaterPeriodLivePutRecord,
  LaterPeriodLivePutDeclarationInput,
  LaterPeriodLivePutHeldEvidence,
  LaterPeriodLivePutKey,
  LaterPeriodLivePutPermissionSelection,
  laterPeriodLivePutId,
  laterPeriodLivePutEffect,
  laterPeriodLivePutKey,
  laterPeriodLivePutPermissionSelection,
  matchLaterPeriodLivePutRecord,
} from '../../../domain/later-period-live-put';
import type { ItemOwnershipResourceChange } from '../../../domain/transfer-item-ownership-resources';
import type { MongoOwnershipArchiveSource } from './mongo-ownership-archive-source';
import type { PublishedHistoryCopyRepresentation } from '../../../domain/published-history-copy';
import type { PublishedHistoryFinalCoverageInput } from '../../../domain/published-history-final-coverage';
import {
  buildPublishedHistoryStableCutScope,
  type PublishedHistoryStableCutFile,
} from '../../../domain/published-history-stable-cut-scope';
import {
  ItemRecipientProjectionSelection,
  itemRecipientProjectionSelection,
} from '../../../domain/transfer-item-recipient-projection-selection';
import {
  ITEM_STABLE_CUT_SCOPE_PROTOCOL,
  ItemStableCutAccreditation,
  ItemStableCutAccreditationRecord,
  ItemStableCutAccreditationSelection,
  ItemStableCutConsumption,
  ItemStableCutCopyInventory,
  ItemStableCutScope,
  buildItemStableCutAccreditationRecord,
  buildItemStableCutConsumption,
  buildItemStableCutScope,
  itemStableCutAccreditationRecordId,
  itemStableCutAccreditationSelection,
  itemStableCutAttemptPin,
  matchItemStableCutAccreditation,
  LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
  LaterPeriodStableCutScope,
  LaterPeriodStableCutAccreditation,
  buildLaterPeriodStableCutAccreditationRecord,
  buildLaterPeriodStableCutConsumption,
  buildPublishedHistoryStableCutAccreditationRecord,
  buildPublishedHistoryStableCutConsumption,
  LaterPeriodStableCutConsumption,
  laterPeriodStableCutAccreditationRecordId,
  matchLaterPeriodStableCutAccreditation,
} from '../../../domain/transfer-item-stable-cut-evidence';
import {
  ItemHistoricalByteObservation,
  ItemStagingCopyPreparationReceipt,
  buildStagingCopyPreparation,
  captureHistoricalByteObservation,
  ItemSourceByteObservation,
  ItemSourceObservationReceipt,
  captureSourceByteObservation,
  matchSourceByteObservation,
  ItemSourceRetentionObservation,
  ItemSourceRetentionPreparationInput,
  ItemSourceRetentionReceipt,
  captureItemSourceRetentionObservation,
  matchItemSourceRetentionObservation,
  sourceRetentionPreparationInput,
  ItemSourceProfilePreparationInput,
  ItemSourceProfileRecord,
  ItemSourceProfileObservationSet,
  ItemSourceProfileObservationReceipt,
  ItemSourceLastReadBound,
  ItemSourceDelegationBound,
  assertItemSourceProfileWindow,
  captureItemSourceProfileObservationSet,
  evaluateItemSourceReadWindow,
  evaluateRecordedItemSourceReadWindow,
  matchItemSourceDelegationBound,
  matchItemSourceProfileObservationSet,
  sourceProfilePreparationInput,
  ItemStagingByteObservation,
  ItemStagingObservationReceipt,
  captureStagingByteObservation,
  matchStagingByteObservation,
  persistedItemStagingIntent,
  sourceHashValid,
} from '../../../domain/transfer-item-historical-observation';
import {
  ItemManifestReadInput,
  ItemManifestPage,
  itemManifestReadInput,
  ITEM_MANIFEST_PAGE_SIZE,
  ItemManifestDigestInput,
  ItemManifestDigestResult,
  ItemManifestPreparationReceipt,
  itemManifestDigestInput,
  captureItemManifestDigest,
  matchItemManifestDigest,
  rebuildItemManifestEntry,
  ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
  ITEM_MANIFEST_FILES_DIGEST_SEED,
  appendItemManifestEntryDigest,
  appendItemManifestFileDigest,
} from '../../../domain/transfer-item-manifest-digest';
import type { MongoOwnershipArchiveHistory } from './mongo-ownership-archive-history';
import type { MongoOwnershipArchiveRepository } from './mongo-ownership-archive-repository';
import type { OwnershipArchiveHistoryImporter } from '../../../application/ownership-archive-history-importer';
import type { OwnershipArchivePreparer } from '../../../application/ownership-archive-preparer';
import type { LaterPeriodLiveMediaStore } from '../../../application/later-period-live-media-reconciler';
import type { OwnershipArchiveSource } from '../../../domain/ownership-archive-source';
import type { OwnershipArchiveStorage } from '../../../domain/ownership-archive';
import { isReservedArchiveGenerationKey } from '../../../../animal-media/domain/animal-media-upload';
import type { PublishedHistoryRetainedReferencesReceipt } from '../../../domain/published-history-retained-references';
import {
  buildPublishedHistoryRetainedReferencesPublication,
  buildPublishedHistoryRetainedReferencesReceipt,
} from '../../../domain/published-history-retained-references';
import {
  PublishedHistoryRecipientProjectionSelection,
  publishedHistoryRecipientProjectionSelection,
} from '../../../application/published-history-recipient-projection-reader';
import {
  ItemRecipientFinalCoverageInput,
  ItemRecipientFinalCoverageFile,
  ItemRecipientFinalCoveragePage,
  ItemRecipientFinalCoveragePageInput,
  recipientFinalCoveragePageInput,
  ItemRecipientFinalMediaRegistrationInput,
  ItemRecipientPreparedCoveragePage,
  ItemRecipientProjectionMediaPage,
  recipientFinalMediaRegistrationInput,
} from '../../../domain/transfer-item-recipient-final-coverage';
import {
  ItemCopyRecordStore,
  ItemCopyRecord,
  ItemCopyGateRecord,
  ItemCopyRecordReceipt,
  ItemCopyDeclarationInput,
  ItemCopyRevocationInput,
  ItemCopyAttemptRecord,
  ItemHistoricalPutAttemptRecord,
  ItemHistoricalPutAttemptV2Record,
  ItemHistoricalPutDeclarationInput,
  ItemHistoricalPutDeclarationV2Input,
  ItemHistoricalPutReadInput,
  ItemHistoricalPutDestinationProtectionInput,
  ItemHistoricalPutDestinationProtectionReceipt,
  ItemHistoricalPutPermissionObservation,
  ItemHistoricalPutPermissionReadInput,
  ItemHistoricalPutPermissionRecordInput,
  ItemHistoricalPutStagingInput,
  ItemPutVersionPreparationInput,
  ItemRecipientFinalPutAttemptRecord,
  ItemRecipientFinalPutDeclarationInput,
  ItemRecipientFinalPutReadInput,
  ItemRecipientFinalPutPermissionObservation,
  ItemRecipientFinalPutPermissionRecordInput,
  ItemStagingPutAttemptRecord,
  ItemStagingPutDeclarationInput,
  ItemStagingPutReadInput,
  ItemStagingPutPermissionObservation,
  ItemStagingPutPermissionRecordInput,
  ItemHistoricalPutTransportObservationInput,
  ItemPutTransportObservationInput,
  ItemSourceWindowAssessmentInput,
  ItemSourceDelegationBoundInput,
  ItemSourceDelegationBoundReceipt,
  copyDeclarationInput,
  copyRevocationInput,
  buildItemCopyGate,
  buildItemCopyGateDefinition,
  captureItemCopyGate,
  newItemCopyGate,
  newItemCopyAttempt,
  newIntendedCopyRecord,
  matchItemCopyAttempt,
  nextCopyGateRevision,
  sourceWindowAssessmentInput,
  sourceDelegationBoundInput,
  historicalPutDeclarationInput,
  historicalPutDeclarationV2Input,
  historicalPutReadInput,
  historicalPutDestinationProtectionInput,
  historicalPutPermissionReadInput,
  historicalPutPermissionRecordInput,
  putVersionPreparationInput,
  recipientFinalPutDeclarationInput,
  recipientFinalPutReadInput,
  recipientFinalPutPermissionRecordInput,
  stagingPutDeclarationInput,
  stagingPutReadInput,
  stagingPutPermissionRecordInput,
  putTransportObservationInput,
  matchHistoricalPutV2Record,
} from '../../../domain/transfer-item-copy-record';
import {
  buildItemHistoricalPutAttempt,
  buildItemHistoricalPutAttemptV2,
  matchItemHistoricalPutAttemptV2,
} from '../../../domain/transfer-item-historical-put-attempt';
import {
  ItemHistoricalPutDestinationProtection,
  ItemRecipientFinalPutDestinationAccreditation,
  ItemStagingPutDestinationAccreditation,
  matchItemHistoricalPutDestinationProtection,
  protectStagingPutDestinationFromAccreditation,
  protectRecipientFinalPutDestinationFromAccreditation,
} from '../../../domain/transfer-item-historical-put-destination-protection';
import {
  ItemRecipientFinalPutAttempt,
  buildItemRecipientFinalPutAttempt,
} from '../../../domain/transfer-item-recipient-final-put-attempt';
import {
  ItemRecipientFinalPutPermission,
  ItemRecipientFinalPutPermissionInput,
  buildInitialRecipientFinalPutPermission,
  observeInitialRecipientFinalPutPermission,
} from '../../../domain/transfer-item-recipient-final-put-permission';
import { buildItemStagingPutAttempt } from '../../../domain/transfer-item-staging-put-attempt';
import {
  buildInitialStagingPutPermission,
  ItemStagingPutPermission,
  ItemStagingPutPermissionInput,
  observeInitialStagingPutPermission,
} from '../../../domain/transfer-item-staging-put-permission';
import {
  ItemStagingPutVersionContext,
  ItemStagingPutVersionRecord,
  ItemRecipientFinalPutVersionContext,
  ItemRecipientFinalPutVersionRecord,
  buildFinalFromStagingPutVersion,
  matchRecipientFinalPutVersionRecord,
  matchStagingPutVersionRecord,
} from '../../../domain/transfer-item-staging-put-reconciliation';
import {
  buildItemSourceArtifactMetadata,
  matchItemSourceArtifactMetadata,
} from '../../../domain/transfer-item-source-artifact-metadata';
import {
  buildInitialHistoricalPutPermission,
  ItemHistoricalPutPermission,
  ItemHistoricalPutPermissionInput,
  observeInitialHistoricalPutPermission,
} from '../../../domain/transfer-item-historical-put-permission';
import {
  ItemHistoricalPutTransportObservation,
  ItemStagingPutTransportObservation,
  ItemRecipientFinalPutTransportObservation,
  buildHistoricalPutTransportObservation,
  buildStagingPutTransportObservation,
  buildRecipientFinalPutTransportObservation,
  matchRecipientFinalPutTransportObservation,
  matchStagingPutTransportObservation,
} from '../../../domain/transfer-item-historical-put-transport';
import {
  ItemHistoricalPutVersionContext,
  ItemHistoricalPutVersionRecord,
  assertHistoricalPutVersionUsable,
  buildStagingFromHistoricalPutVersion,
  historicalPutEvidenceTime,
  matchHistoricalPutVersionRecord,
} from '../../../domain/transfer-item-historical-put-reconciliation';
import {
  ITEM_COPY_RECORD_MODEL,
  ITEM_COPY_RECORD_COLLECTION,
} from './transfer-item-copy-record.schema';
import {
  OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_COLLECTION,
  OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
} from './ownership-archive-media-registration.schema';
import { persistTransferredMediaRegistration } from './mongo-ownership-archive-media-registration';
import { MongoItemSourceProfileState } from './mongo-item-source-profile-state';

const manifestFileProjection = {
  _id: 0,
  id: 1,
  archiveId: 1,
  sourceKey: 1,
  relativeKey: 1,
  historicalKey: 1,
  recipientStagingKey: 1,
  recipientFinalKey: 1,
  source: 1,
  definitionHash: 1,
  state: 1,
  retained: 1,
};
const finalVersionFileProjection = {
  ...manifestFileProjection,
  leaseToken: 1,
  leaseUntil: 1,
  verified: 1,
  materialization: 1,
  historicalCopyIntent: 1,
  historicalByteObservation: 1,
  stagingCopyIntent: 1,
  recipientFinalCopyIntent: 1,
};
type MatchedRecipientFinalVersion =
  Required<ItemRecipientFinalPutVersionContext> & {
    file: ArchiveFile;
    historicalSource: ItemHistoricalPutStagingInput['source'];
  };
type RecipientRegistryRead = 'PREPARED' | 'PROJECTION';
type ItemStableCutRetainedVersions = {
  fileCount: number;
  versionsDigest: string;
  controls: Set<string>;
};
type SelectedRecipientProjection = Readonly<{
  selection: ItemRecipientProjectionSelection;
  projection: Awaited<ReturnType<ItemRecipientProjectionReader['read']>>;
}>;
type CheckedItemStableCutAccreditation = SelectedRecipientProjection &
  Readonly<{
    record: ItemStableCutAccreditationRecord;
    observation: ReturnType<typeof matchItemStableCutAccreditation>;
  }>;
type OwnershipCommitModels = Readonly<{
  users: Model<UserEntity>;
  events: Model<TransferEvent>;
  notices: Model<TransferNotice>;
  outbox: Model<TransferOutbox>;
}>;
type LaterPeriodAccreditationSelection = Readonly<{
  selector: ItemCaptureInput;
  retainedSelection: PublishedHistoryRecipientProjectionSelection;
  expectedScopeHash: string;
  expectedAccreditationHash: string;
}>;
type LaterPeriodOwnershipSelection = LaterPeriodAccreditationSelection &
  Readonly<{ expectedRetainedAccreditationHash: string }>;
type SelectedItemStableCut = SelectedRecipientProjection &
  Readonly<{
    scope: ItemStableCutScope;
    snapshot: ItemCaptureSnapshot;
    selected: ReturnType<typeof selectItemCapture>['selected'];
  }>;

type SourceProfileConfirmation = Readonly<{
  profiles: Pick<MongoItemSourceProfileState, 'fenceActiveSourceProfile'> &
    Partial<
      Pick<
        MongoItemSourceProfileState,
        | 'readActiveSourceAccreditation'
        | 'readActiveSourceProfile'
        | 'assertActiveSharedControls'
        | 'fenceActiveSharedControls'
      >
    >;
  now: () => Date;
  /** Local lookup of independent evidence obtained outside Mongo. */
  laterPeriodLiveMediaFor?: (
    scope: LaterPeriodLiveMediaScope,
  ) => LaterPeriodLiveMediaEvidence | null;
  laterPeriodStableCutAccreditationFor?: (
    scope: LaterPeriodStableCutScope,
    expectedAccreditationHash: string,
  ) => LaterPeriodStableCutAccreditation | null;
  /** Local lookup of an independent report acquired outside this transaction. */
  stableCutAccreditationFor?: (
    scope: ItemStableCutScope,
    expectedAccreditationHash: string,
  ) => ItemStableCutAccreditation | null;
  /** Trusted local lookup. The report is acquired before opening the transaction. */
  publishedHistoryConservationFor?: (
    scope: PublishedHistoryConservationScope,
    expectedEvidenceHash: string,
  ) => PublishedHistoryConservationEvidence | null;
  /** Trusted, synchronous validation of a held reader and the exact prepared request. */
  permissionEvidenceFor?: (
    pins: ItemHistoricalPutPermissionRecordInput,
    definition: ItemHistoricalPutAttemptV2Record['definition'],
  ) => Pick<
    ItemHistoricalPutPermissionInput,
    'openedArtifactSeal' | 'accreditation' | 'transportRequestHash'
  > | null;
  /** Trusted synchronous check of the held staging reader and prepared request. */
  stagingPermissionEvidenceFor?: (
    pins: ItemStagingPutPermissionRecordInput,
    definition: ItemStagingPutAttemptRecord['definition'],
  ) => Pick<
    ItemStagingPutPermissionInput,
    'openedArtifactSeal' | 'transportRequestHash'
  > | null;
  /** Trusted synchronous check of the held final reader and prepared request. */
  finalPermissionEvidenceFor?: (
    pins: ItemRecipientFinalPutPermissionRecordInput,
    definition: ItemRecipientFinalPutAttemptRecord['definition'],
  ) => Pick<
    ItemRecipientFinalPutPermissionInput,
    'openedArtifactSeal' | 'transportRequestHash'
  > | null;
  assessment?: Readonly<{
    expectedBucketOwner: string;
    /** Local trusted lookup only. Do not call a provider while holding the snapshot. */
    boundFor?: (
      attemptDefinitionHash: string,
      signerContextHash: string,
    ) => ItemSourceLastReadBound | null;
  }>;
}>;
type SourceWindowAssessment =
  | ReturnType<typeof evaluateItemSourceReadWindow>
  | ReturnType<typeof evaluateRecordedItemSourceReadWindow>;
type SourceProfilePreparation = Omit<
  ItemSourceProfilePreparationInput,
  'anchor'
> &
  Readonly<{ observation?: ItemSourceProfileObservationSet }>;
type SourceBoundAction = {
  mode: 'SOURCE_BOUND';
  input: ItemSourceDelegationBoundInput;
  bound?: ItemSourceDelegationBound;
};
type DestinationProtectionAction = {
  mode: 'DESTINATION_PROTECTION';
  input: ItemHistoricalPutDestinationProtectionInput;
  protection?: ItemHistoricalPutDestinationProtection;
};
type HistoricalPutPermissionAction =
  | {
      mode: 'RECORD_PUT_PERMISSION';
      input: ItemHistoricalPutPermissionRecordInput;
    }
  | {
      mode: 'READ_PUT_PERMISSION';
      input: ItemHistoricalPutPermissionReadInput;
    }
  | {
      mode: 'RECORD_PUT_TRANSPORT_OBSERVATION';
      input: ItemHistoricalPutTransportObservationInput;
    };
type PutReconciliationAction =
  | {
      mode: 'READ_PUT_RECONCILIATION';
      input: ItemHistoricalPutPermissionReadInput;
    }
  | {
      mode: 'RECORD_PUT_VERSION';
      input: ItemHistoricalPutPermissionReadInput;
      version: ItemHistoricalPutVersionRecord;
    };
type StagingPutAction =
  | {
      mode: 'DECLARE_STAGING_PUT';
      input: ItemStagingPutDeclarationInput;
      accreditation: ItemStagingPutDestinationAccreditation;
    }
  | { mode: 'READ_STAGING_PUT'; input: ItemStagingPutReadInput }
  | {
      mode: 'RECORD_STAGING_PUT_PERMISSION';
      input: ItemStagingPutPermissionRecordInput;
    };
type RecipientFinalPutAction =
  | {
      mode: 'DECLARE_FINAL_PUT';
      input: ItemRecipientFinalPutDeclarationInput;
      accreditation: ItemRecipientFinalPutDestinationAccreditation;
    }
  | { mode: 'READ_FINAL_PUT'; input: ItemRecipientFinalPutReadInput }
  | {
      mode: 'RECORD_FINAL_PUT_PERMISSION';
      input: ItemRecipientFinalPutPermissionRecordInput;
    };
type RecipientFinalPutPermissionHistoryAction =
  | {
      mode: 'READ_FINAL_PUT_PERMISSION';
      input: ItemHistoricalPutPermissionReadInput;
    }
  | {
      mode: 'RECORD_FINAL_PUT_TRANSPORT_OBSERVATION';
      input: ItemPutTransportObservationInput;
    };
type RecipientFinalPutReconciliationAction =
  | {
      mode: 'READ_FINAL_PUT_RECONCILIATION';
      input: ItemHistoricalPutPermissionReadInput;
    }
  | {
      mode: 'RECORD_FINAL_PUT_VERSION';
      input: ItemHistoricalPutPermissionReadInput;
      version: ItemRecipientFinalPutVersionRecord;
    };
type StagingPutReconciliationAction =
  | {
      mode: 'READ_STAGING_PUT_RECONCILIATION';
      input: ItemHistoricalPutPermissionReadInput;
    }
  | {
      mode: 'RECORD_STAGING_PUT_VERSION';
      input: ItemHistoricalPutPermissionReadInput;
      version: ItemStagingPutVersionRecord;
    };
type StagingPutPermissionHistoryAction =
  | {
      mode: 'READ_STAGING_PUT_PERMISSION';
      input: ItemHistoricalPutPermissionReadInput;
    }
  | {
      mode: 'RECORD_STAGING_PUT_TRANSPORT_OBSERVATION';
      input: ItemPutTransportObservationInput;
    };
type CopyRecordAction =
  | { mode: 'READ' }
  | { mode: 'OPEN' }
  | { mode: 'REVOKE'; input: ItemCopyRevocationInput }
  | { mode: 'DECLARE'; input: ItemCopyDeclarationInput }
  | {
      mode: 'DECLARE_PUT';
      input:
        | ItemHistoricalPutDeclarationInput
        | ItemHistoricalPutDeclarationV2Input;
    }
  | { mode: 'ASSESS_SOURCE_WINDOW'; input: ItemSourceWindowAssessmentInput }
  | { mode: 'READ_PUT_V2'; input: ItemHistoricalPutReadInput }
  | DestinationProtectionAction
  | HistoricalPutPermissionAction
  | PutReconciliationAction
  | StagingPutAction
  | RecipientFinalPutAction
  | RecipientFinalPutPermissionHistoryAction
  | RecipientFinalPutReconciliationAction
  | StagingPutPermissionHistoryAction
  | StagingPutReconciliationAction
  | { mode: 'PREPARE_PUT_STAGING'; input: ItemHistoricalPutStagingInput }
  | { mode: 'PREPARE_PUT_FINAL'; input: ItemPutVersionPreparationInput }
  | SourceBoundAction;

@Injectable()
export class MongoTransferItemCapture
  implements ItemCaptureStore, ItemCopyRecordStore
{
  constructor(
    @InjectModel(TRANSFER_REQUEST_MODEL)
    private readonly requests: Model<TransferRequestRecord>,
    @InjectModel(TRANSFER_REQUEST_ITEM_MODEL)
    private readonly items: Model<TransferRequestItem>,
    @InjectModel(TRANSFER_REQUEST_CLAIM_MODEL)
    private readonly claims: Model<RequestClaim>,
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
    @InjectModel(OWNERSHIP_ARCHIVE_FILE_MODEL)
    private readonly files: Model<ArchiveFile>,
    @InjectModel(OWNERSHIP_ARCHIVE_ENTRY_MODEL)
    private readonly entries: Model<ArchiveEntry>,
    @InjectModel(ITEM_COPY_RECORD_MODEL)
    private readonly copyRecords?: Model<ItemCopyRecord>,
    @Optional()
    @Inject('ItemSourceProfileConfirmation')
    private readonly sourceProfileConfirmation?: SourceProfileConfirmation,
    @Optional()
    @InjectModel(OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL)
    private readonly registrations?: Model<TransferredMediaRegistration>,
  ) {}
  readCopyGate(raw: ItemCaptureInput) {
    return this.transaction(itemCaptureInput(raw), { copy: { mode: 'READ' } });
  }
  assessSourceReadWindow(raw: ItemSourceWindowAssessmentInput) {
    const input = sourceWindowAssessmentInput(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'ASSESS_SOURCE_WINDOW', input },
    });
  }
  openCopyGate(raw: ItemCaptureInput) {
    return this.transaction(itemCaptureInput(raw), { copy: { mode: 'OPEN' } });
  }
  revokeCopyGate(raw: ItemCopyRevocationInput) {
    const input = copyRevocationInput(raw);
    return this.transaction(input.selector, {
      copy: { mode: 'REVOKE', input },
    });
  }
  declareCopyAttempt(raw: ItemCopyDeclarationInput) {
    const input = copyDeclarationInput(raw);
    return this.transaction(input.preparation.selector, {
      copy: { mode: 'DECLARE', input },
    });
  }
  declareHistoricalPutAttempt(raw: ItemHistoricalPutDeclarationInput) {
    const input = historicalPutDeclarationInput(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'DECLARE_PUT', input },
    });
  }
  declareHistoricalPutAttemptV2(raw: ItemHistoricalPutDeclarationV2Input) {
    const input = historicalPutDeclarationV2Input(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'DECLARE_PUT', input },
    });
  }
  readHistoricalPutAttemptV2(raw: ItemHistoricalPutReadInput) {
    const input = historicalPutReadInput(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'READ_PUT_V2', input },
    });
  }
  readHistoricalPutDestinationProtection(
    raw: ItemHistoricalPutDestinationProtectionInput,
  ) {
    const input = historicalPutDestinationProtectionInput(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'DESTINATION_PROTECTION', input },
    });
  }
  async recordHistoricalPutDestinationProtection(
    raw: ItemHistoricalPutDestinationProtectionInput,
    protection: ItemHistoricalPutDestinationProtection,
  ): Promise<ItemHistoricalPutDestinationProtectionReceipt> {
    const input = historicalPutDestinationProtectionInput(raw);
    const receipt = await this.transaction(input.anchor.preparation.selector, {
      copy: {
        mode: 'DESTINATION_PROTECTION',
        input,
        protection: Object.freeze({ ...protection }),
      },
    });
    if (!receipt) throw this.unavailable();
    return receipt;
  }
  async recordInitialHistoricalPutPermission(
    raw: ItemHistoricalPutPermissionRecordInput,
  ) {
    const input = historicalPutPermissionRecordInput(raw);
    const receipt = await this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'RECORD_PUT_PERMISSION', input },
    });
    if (!receipt) throw this.unavailable();
    return Object.freeze({ ...receipt, recorded: true as const });
  }
  readInitialHistoricalPutPermission(
    raw: ItemHistoricalPutPermissionReadInput,
  ) {
    const input = historicalPutPermissionReadInput(raw);
    return this.transaction(input.selector, {
      copy: { mode: 'READ_PUT_PERMISSION', input },
    });
  }
  readHistoricalPutReconciliationContext(
    raw: ItemHistoricalPutPermissionReadInput,
  ) {
    const input = historicalPutPermissionReadInput(raw);
    return this.transaction(input.selector, {
      copy: { mode: 'READ_PUT_RECONCILIATION', input },
    });
  }
  async recordHistoricalPutVersion(
    raw: ItemHistoricalPutPermissionReadInput,
    report: ItemHistoricalPutVersionRecord,
  ) {
    const input = historicalPutPermissionReadInput(raw);
    const version = this.capturePutVersionRecord(report);
    const receipt = await this.transaction(input.selector, {
      copy: { mode: 'RECORD_PUT_VERSION', input, version },
    });
    if (!receipt?.versionRecord) throw this.unavailable();
    return receipt.versionRecord;
  }

  private capturePutVersionRecord<
    Version extends
      | ItemHistoricalPutVersionRecord
      | ItemStagingPutVersionRecord
      | ItemRecipientFinalPutVersionRecord,
  >(report: Version): Version {
    if (
      !report?.observation?.scope?.target ||
      !report.evidence?.revision ||
      !report.observation.revision
    )
      throw new ConflictError(
        'The historical PUT version observation is required',
      );
    const { observation, evidence } = report;
    return {
      ...report,
      observation: {
        ...observation,
        revision: { ...observation.revision },
        scope: {
          ...observation.scope,
          target: { ...observation.scope.target },
        },
      },
      evidence: { ...evidence, revision: { ...evidence.revision } },
    };
  }
  prepareStagingFromHistoricalPut(raw: ItemHistoricalPutStagingInput) {
    const input = putVersionPreparationInput(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'PREPARE_PUT_STAGING', input },
    });
  }
  prepareFinalFromStagingPut(raw: ItemPutVersionPreparationInput) {
    const input = putVersionPreparationInput(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'PREPARE_PUT_FINAL', input },
    });
  }
  declareStagingPutAttempt(
    raw: ItemStagingPutDeclarationInput,
    report: ItemStagingPutDestinationAccreditation,
  ) {
    const input = stagingPutDeclarationInput(raw);
    const accreditation = this.capturePutDestinationAccreditation(report);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'DECLARE_STAGING_PUT', input, accreditation },
    });
  }
  declareRecipientFinalPutAttempt(
    raw: ItemRecipientFinalPutDeclarationInput,
    report: ItemRecipientFinalPutDestinationAccreditation,
  ) {
    const input = recipientFinalPutDeclarationInput(raw);
    const accreditation = this.capturePutDestinationAccreditation(report);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'DECLARE_FINAL_PUT', input, accreditation },
    });
  }
  readRecipientFinalPutAttempt(raw: ItemRecipientFinalPutReadInput) {
    const input = recipientFinalPutReadInput(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'READ_FINAL_PUT', input },
    });
  }
  async recordInitialRecipientFinalPutPermission(
    raw: ItemRecipientFinalPutPermissionRecordInput,
  ) {
    const input = recipientFinalPutPermissionRecordInput(raw);
    const receipt = await this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'RECORD_FINAL_PUT_PERMISSION', input },
    });
    if (!receipt) throw this.unavailable();
    return Object.freeze({ ...receipt, recorded: true as const });
  }
  readInitialRecipientFinalPutPermission(
    raw: ItemHistoricalPutPermissionReadInput,
  ) {
    const input = historicalPutPermissionReadInput(raw);
    return this.transaction(input.selector, {
      copy: { mode: 'READ_FINAL_PUT_PERMISSION', input },
    });
  }
  async recordRecipientFinalPutTransportObservation(
    raw: ItemPutTransportObservationInput,
  ) {
    const input = putTransportObservationInput(raw);
    const receipt = await this.transaction(input.selector, {
      copy: { mode: 'RECORD_FINAL_PUT_TRANSPORT_OBSERVATION', input },
    });
    if (!receipt?.transportObservation) throw this.unavailable();
    return receipt.transportObservation;
  }
  readRecipientFinalPutReconciliationContext(
    raw: ItemHistoricalPutPermissionReadInput,
  ) {
    const input = historicalPutPermissionReadInput(raw);
    return this.transaction(input.selector, {
      copy: { mode: 'READ_FINAL_PUT_RECONCILIATION', input },
    });
  }
  async recordRecipientFinalPutVersion(
    raw: ItemHistoricalPutPermissionReadInput,
    report: ItemRecipientFinalPutVersionRecord,
  ) {
    const input = historicalPutPermissionReadInput(raw);
    const version = this.capturePutVersionRecord(report);
    const receipt = await this.transaction(input.selector, {
      copy: { mode: 'RECORD_FINAL_PUT_VERSION', input, version },
    });
    if (!receipt?.versionRecord) throw this.unavailable();
    return receipt.versionRecord;
  }
  private capturePutDestinationAccreditation<
    Report extends
      | ItemStagingPutDestinationAccreditation
      | ItemRecipientFinalPutDestinationAccreditation,
  >(report: Report): Report {
    if (
      !report?.scope ||
      !report.deletion ||
      !report.writers ||
      !report.continuity
    )
      throw new ConflictError('The PUT destination accreditation is required');
    return {
      ...report,
      scope: { ...report.scope },
      deletion: { ...report.deletion },
      writers: {
        ...report.writers,
        applicationDeployments: { ...report.writers.applicationDeployments },
        externalSystems: { ...report.writers.externalSystems },
        priorCapabilities: { ...report.writers.priorCapabilities },
        multipartUploads: { ...report.writers.multipartUploads },
        replication: { ...report.writers.replication },
        administrative: { ...report.writers.administrative },
      },
      continuity: { ...report.continuity },
    };
  }
  readStagingPutAttempt(raw: ItemStagingPutReadInput) {
    const input = stagingPutReadInput(raw);
    return this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'READ_STAGING_PUT', input },
    });
  }
  async recordInitialStagingPutPermission(
    raw: ItemStagingPutPermissionRecordInput,
  ) {
    const input = stagingPutPermissionRecordInput(raw);
    const receipt = await this.transaction(input.anchor.preparation.selector, {
      copy: { mode: 'RECORD_STAGING_PUT_PERMISSION', input },
    });
    if (!receipt) throw this.unavailable();
    return Object.freeze({ ...receipt, recorded: true as const });
  }
  readInitialStagingPutPermission(raw: ItemHistoricalPutPermissionReadInput) {
    const input = historicalPutPermissionReadInput(raw);
    return this.transaction(input.selector, {
      copy: { mode: 'READ_STAGING_PUT_PERMISSION', input },
    });
  }
  readStagingPutReconciliationContext(
    raw: ItemHistoricalPutPermissionReadInput,
  ) {
    const input = historicalPutPermissionReadInput(raw);
    return this.transaction(input.selector, {
      copy: { mode: 'READ_STAGING_PUT_RECONCILIATION', input },
    });
  }
  async recordStagingPutVersion(
    raw: ItemHistoricalPutPermissionReadInput,
    report: ItemStagingPutVersionRecord,
  ) {
    const input = historicalPutPermissionReadInput(raw);
    const version = this.capturePutVersionRecord(report);
    const receipt = await this.transaction(input.selector, {
      copy: { mode: 'RECORD_STAGING_PUT_VERSION', input, version },
    });
    if (!receipt?.versionRecord) throw this.unavailable();
    return receipt.versionRecord;
  }
  async recordHistoricalPutTransportObservation(
    raw: ItemHistoricalPutTransportObservationInput,
  ) {
    const input = putTransportObservationInput(raw);
    const receipt = await this.transaction(input.selector, {
      copy: { mode: 'RECORD_PUT_TRANSPORT_OBSERVATION', input },
    });
    if (!receipt?.transportObservation) throw this.unavailable();
    return receipt.transportObservation;
  }
  async recordStagingPutTransportObservation(
    raw: ItemPutTransportObservationInput,
  ) {
    const input = putTransportObservationInput(raw);
    const receipt = await this.transaction(input.selector, {
      copy: { mode: 'RECORD_STAGING_PUT_TRANSPORT_OBSERVATION', input },
    });
    if (!receipt?.transportObservation) throw this.unavailable();
    return receipt.transportObservation;
  }
  readSourceDelegationBound(raw: ItemSourceDelegationBoundInput) {
    const input = sourceDelegationBoundInput(raw);
    return this.transaction(input.preparation.selector, {
      copy: { mode: 'SOURCE_BOUND', input },
    });
  }
  async recordSourceDelegationBound(
    raw: ItemSourceDelegationBoundInput,
    bound: ItemSourceDelegationBound,
  ): Promise<ItemSourceDelegationBoundReceipt> {
    const input = sourceDelegationBoundInput(raw);
    const result = await this.transaction(input.preparation.selector, {
      copy: { mode: 'SOURCE_BOUND', input, bound: Object.freeze({ ...bound }) },
    });
    if (!result) throw this.unavailable();
    return result;
  }
  readManifestPage(raw: ItemManifestReadInput) {
    const input = itemManifestReadInput(raw);
    return this.transaction(input.selector, { manifest: input });
  }
  readRecipientFinalCoveragePage(raw: ItemRecipientFinalCoveragePageInput) {
    const coverage = recipientFinalCoveragePageInput(raw);
    return this.transaction(coverage.selector, { coverage });
  }
  readRecipientPreparedCoveragePage(raw: ItemRecipientFinalCoveragePageInput) {
    const coverage = recipientFinalCoveragePageInput(raw);
    return this.transaction(coverage.selector, {
      coverage,
      recipientRegistry: 'PREPARED',
    });
  }
  readRecipientProjectionMediaPage(raw: ItemRecipientFinalCoveragePageInput) {
    const coverage = recipientFinalCoveragePageInput(raw);
    return this.transaction(coverage.selector, {
      coverage,
      recipientRegistry: 'PROJECTION',
    });
  }
  /** Rebuilds the selected candidate on the caller's snapshot without consuming evidence. */
  readRecipientProjectionWithinTransaction(
    raw: ItemRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    return this.withItemProjectionSession(session, () =>
      this.readSelectedRecipientProjection(raw, session, urls),
    );
  }

  readItemStableCutScopeWithinTransaction(
    raw: ItemRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    return this.withItemProjectionSession(session, async () => {
      const { selection, projection, scope } =
        await this.readSelectedItemStableCut(raw, session, urls);
      return Object.freeze({ selection, projection, scope });
    });
  }

  registerItemStableCutAccreditationWithinTransaction(
    raw: ItemStableCutAccreditationSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    return this.withItemProjectionSession(session, () =>
      this.itemStableCutAccreditationInSnapshot(raw, session, urls, 'REGISTER'),
    );
  }

  readItemStableCutAccreditationWithinTransaction(
    raw: ItemStableCutAccreditationSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    return this.withItemProjectionSession(session, () =>
      this.itemStableCutAccreditationInSnapshot(raw, session, urls, 'READ'),
    );
  }

  /** The caller owns commit acknowledgement. A retry first checks the durable result. */
  /** Composes the joint cut with retained references and current resource writes. */
  async consumeLaterPeriodStableCutWithinTransaction<
    Result extends Readonly<{
      commitHash: string;
      activePeriodId: string;
      effectiveAt: string;
    }>,
  >(
    raw: LaterPeriodAccreditationSelection &
      Readonly<{ expectedRetainedAccreditationHash: string }>,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    source: Pick<
      MongoOwnershipArchiveSource,
      | 'visitLiveOwnershipResources'
      | 'readItemOwnershipResourceChanges'
      | 'applyItemOwnershipResourceChanges'
    >,
    history: Pick<
      MongoOwnershipArchiveHistory,
      | 'fencePublishedStableCutScopeWithinTransaction'
      | 'writePublishedRetainedReferencesWithOwnershipWithinTransaction'
    >,
    writeOwnership: (
      input: Readonly<{
        archive: Readonly<ArchiveDefinition>;
        consumption: LaterPeriodStableCutConsumption;
        retainedReferencesReceipt: PublishedHistoryRetainedReferencesReceipt;
      }>,
      session: ClientSession,
    ) => Promise<Result>,
  ) {
    assertArchiveCallerTransaction(session, this.requests, [this.archives]);
    const transaction = session.transaction;
    try {
      const config = this.sourceProfileConfirmation;
      if (
        !config ||
        !sourceHashValid(raw?.expectedRetainedAccreditationHash) ||
        typeof writeOwnership !== 'function'
      )
        throw new ConflictError(
          'The later-period close requires a retained accreditation and ownership writer',
        );
      const retainedSelection = publishedHistoryRecipientProjectionSelection(
        raw.retainedSelection,
      );
      const expectedRetainedAccreditationHash =
        raw.expectedRetainedAccreditationHash;
      const { record, projection, observation } =
        await this.laterPeriodStableCutAccreditationWithinTransaction(
          'READ',
          { ...raw, retainedSelection },
          session,
          urls,
          source,
          history,
        );
      const result =
        await history.writePublishedRetainedReferencesWithOwnershipWithinTransaction(
          {
            selection: retainedSelection,
            expectedScopeHash: record.scope.retainedScopeHash,
            expectedAccreditationHash: expectedRetainedAccreditationHash,
          },
          session,
          urls,
          async ({ archive, retainedReferencesReceipt }, active) => {
            if (
              active !== session ||
              active.transaction !== transaction ||
              retainedReferencesReceipt.recordedAt < observation.checkedAt ||
              archive.id !== record.scope.archiveId ||
              archiveHash(archive) !==
                retainedSelection.expectedArchiveDefinitionHash ||
              archiveHash(projection) !== record.scope.liveProjectionHash
            )
              throw new ConflictError(
                'The retained receipt and live dossier changed before ownership writes',
              );
            const consumption = buildLaterPeriodStableCutConsumption(
              record,
              retainedReferencesReceipt,
            );
            const guard = {
              id: consumption.archiveId,
              definitionHash: retainedSelection.expectedArchiveDefinitionHash,
              'evidenceConsumption.definitionHash':
                consumption.retainedConsumptionHash,
              'retainedReferencesReceipt.definitionHash':
                consumption.retainedReceiptHash,
            };
            this.changed(
              await this.archives
                .updateOne(
                  {
                    ...guard,
                    laterPeriodStableCutConsumption: { $exists: false },
                    ownershipCommitHash: { $exists: false },
                  },
                  { $set: { laterPeriodStableCutConsumption: consumption } },
                  { session: active },
                )
                .exec(),
            );
            const changes = await source.readItemOwnershipResourceChanges(
              { definition: archive, ...projection },
              urls,
              active,
              this.requests.db,
            );
            await source.applyItemOwnershipResourceChanges(
              archive,
              changes,
              active,
            );
            const outcome = await writeOwnership(
              Object.freeze({
                archive,
                consumption,
                retainedReferencesReceipt,
              }),
              active,
            );
            if (active.transaction !== transaction)
              throw new ConflictError(
                'The later-period ownership transaction changed',
              );
            assertArchiveCallerTransaction(active, this.requests, [
              this.archives,
            ]);
            const saved = await this.archives
              .findOne(guard)
              .select({ laterPeriodStableCutConsumption: 1 })
              .session(active)
              .lean()
              .exec();
            const after = matchLaterPeriodStableCutAccreditation(
              record.scope,
              record.accreditation,
              record.accreditationHash,
              config.now().getTime(),
            );
            if (
              archiveHash(saved?.laterPeriodStableCutConsumption) !==
                archiveHash(consumption) ||
              outcome?.effectiveAt !== consumption.consumedAt ||
              after.checkedAt < consumption.consumedAt ||
              archiveHash(projection) !== record.scope.liveProjectionHash
            )
              throw new ConflictError(
                'The joint evidence changed during ownership writes',
              );
            return outcome;
          },
        );
      if (session.transaction !== transaction)
        throw new ConflictError(
          'The later-period ownership transaction changed',
        );
      assertArchiveCallerTransaction(session, this.requests, [this.archives]);
      const after = matchLaterPeriodStableCutAccreditation(
        record.scope,
        record.accreditation,
        record.accreditationHash,
        config.now().getTime(),
      );
      if (after.checkedAt < result.consumption.consumedAt)
        throw new ConflictError(
          'The later-period stable-cut clock moved before consumption',
        );
      return result;
    } catch (error) {
      if (session.transaction === transaction && session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
  }

  /** Registers an independent report, or reconstructs its exact stored record. */
  async laterPeriodStableCutAccreditationWithinTransaction(
    mode: 'REGISTER' | 'READ',
    raw: LaterPeriodAccreditationSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    history: Pick<
      MongoOwnershipArchiveHistory,
      'fencePublishedStableCutScopeWithinTransaction'
    >,
  ) {
    const records = this.copyRecords;
    const config = this.sourceProfileConfirmation;
    const fence = config?.profiles.fenceActiveSharedControls;
    if (!records || !config || !fence)
      throw new ConflictError(
        'Later-period stable-cut accreditation is unavailable',
      );
    assertArchiveCallerTransaction(session, this.requests, [records]);
    const transaction = session.transaction;
    try {
      const { expectedScopeHash, expectedAccreditationHash } = raw;
      if (
        !['REGISTER', 'READ'].includes(mode) ||
        ![expectedScopeHash, expectedAccreditationHash].every(sourceHashValid)
      )
        throw new ConflictError(
          'Invalid later-period stable-cut accreditation selection',
        );
      const selected =
        await this.readLaterPeriodStableCutScopeWithinTransaction(
          raw.selector,
          raw.retainedSelection,
          session,
          urls,
          source,
          history,
        );
      const { scope } = selected;
      if (scope.scopeHash !== expectedScopeHash)
        throw new ConflictError('The later-period stable-cut scope changed');
      const id = laterPeriodStableCutAccreditationRecordId(
        expectedScopeHash,
        expectedAccreditationHash,
      );
      const stored = await records
        .findOne({ id })
        .select({ _id: 0 })
        .session(session)
        .lean()
        .exec();
      if (stored && stored.row !== 'LATER_PERIOD_STABLE_CUT_ACCREDITATION')
        throw new ConflictError(
          'The later-period accreditation identity is already in use',
        );
      if (!stored && mode === 'READ')
        throw new ConflictError(
          'The selected later-period accreditation is absent',
        );
      const report = structuredClone(
        stored
          ? stored.accreditation
          : config.laterPeriodStableCutAccreditationFor?.(
              structuredClone(scope),
              expectedAccreditationHash,
            ),
      );
      if (!report)
        throw new ConflictError(
          'The independent later-period stable-cut accreditation is absent',
        );
      const observed = matchLaterPeriodStableCutAccreditation(
        scope,
        report,
        expectedAccreditationHash,
        config.now().getTime(),
      );
      if (!scope.conservationControlsHashes.includes(observed.controlsHash))
        await fence.call(config.profiles, observed.controlsHash, session);
      const observation = matchLaterPeriodStableCutAccreditation(
        scope,
        report,
        expectedAccreditationHash,
        config.now().getTime(),
      );
      if (
        observation.checkedAt < observed.checkedAt ||
        (stored && observation.checkedAt < stored.recordedAt) ||
        session.transaction !== transaction
      )
        throw new ConflictError(
          'The later-period accreditation clock or transaction changed',
        );
      assertArchiveCallerTransaction(session, this.requests, [records]);
      const record = buildLaterPeriodStableCutAccreditationRecord(
        scope,
        report,
        expectedAccreditationHash,
        stored ? stored.recordedAt : observation.checkedAt,
      );
      if (stored && archiveHash(stored) !== archiveHash(record))
        throw new ConflictError(
          'The stored later-period accreditation changed',
        );
      if (!stored) await records.create([record], { session });
      return Object.freeze({ ...selected, record, observation });
    } catch (error) {
      if (session.transaction === transaction && session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
  }

  /** Reconstructs the joint scope from the same dossier snapshot and reservation. */
  async readLaterPeriodStableCutScopeWithinTransaction(
    raw: ItemCaptureInput,
    rawSelection: PublishedHistoryRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    history: Pick<
      MongoOwnershipArchiveHistory,
      'fencePublishedStableCutScopeWithinTransaction'
    >,
  ) {
    const { admission, archive, live, retainedScope, publishedPredecessor } =
      await this.readLaterPeriodDossierInTransaction(
        raw,
        rawSelection,
        session,
        urls,
        source,
        history,
      );
    const transaction = session.transaction;
    try {
      const config = this.sourceProfileConfirmation;
      const fence = config?.profiles.fenceActiveSharedControls;
      const readEvidence = config?.laterPeriodLiveMediaFor;
      if (
        !config ||
        (live.files.length &&
          (!fence || (!publishedPredecessor && !readEvidence)))
      )
        throw new ConflictError(
          'Later-period live media evidence is unavailable',
        );
      const horizon = retainedScope.binding.requiredThrough;
      const startedAt = config.now().getTime();
      const checked: Array<{
        scope: LaterPeriodLiveMediaScope;
        evidence: LaterPeriodLiveMediaEvidence;
      }> = [];
      for (const file of live.files) {
        const scope = laterPeriodLiveMediaScope(archive, file);
        const stored = publishedPredecessor
          ? await this.readLaterPeriodLiveMediaRecord(scope, session)
          : null;
        if (stored && startedAt < historicalPutEvidenceTime(stored.recordedAt))
          throw new ConflictError(
            'The live media evidence was recorded after this check',
          );
        const evidence = matchLaterPeriodLiveMediaEvidence(
          scope,
          publishedPredecessor
            ? stored?.liveMediaEvidence
            : structuredClone(readEvidence?.(scope)),
          horizon,
          startedAt,
        );
        if (publishedPredecessor)
          await this.assertLaterPeriodLiveMediaPermissions(
            scope,
            evidence,
            startedAt,
            session,
          );
        checked.push({ scope, evidence });
      }
      const controls = new Set(
        checked.flatMap(({ evidence }) => [
          evidence.historical.conservationControlsHash,
          evidence.final.conservationControlsHash,
        ]),
      );
      for (const hash of [...controls].sort()) {
        if (!retainedScope.retained.conservationControlsHashes.includes(hash))
          await fence!.call(config.profiles, hash, session);
      }
      const checkedAt = config.now().getTime();
      if (
        !Number.isSafeInteger(startedAt) ||
        !Number.isSafeInteger(checkedAt) ||
        checkedAt < startedAt ||
        checkedAt > historicalPutEvidenceTime(horizon) ||
        session.transaction !== transaction
      )
        throw new ConflictError(
          'The later-period stable-cut window or transaction changed',
        );
      assertArchiveCallerTransaction(session, this.requests, []);
      const media = checked.map(({ scope, evidence }) => {
        matchLaterPeriodLiveMediaEvidence(scope, evidence, horizon, checkedAt);
        const evidenceHash = archiveHash(evidence);
        return Object.freeze({
          id: archiveHash([
            'LATER_PERIOD_LIVE_MEDIA_REFERENCE_V1',
            scope.fileId,
            evidenceHash,
          ]),
          fileId: scope.fileId,
          key: evidence.final.target.key,
          evidenceHash,
          historical: evidence.historical,
          final: evidence.final,
        });
      });
      const entries = Object.freeze(
        projectItemRecipientEntries(archive, live.entries, media, urls),
      );
      const projection = Object.freeze({
        entries,
        media: Object.freeze(media),
      });
      const facts = {
        protocol: LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
        archiveId: archive.id,
        admissionHash: admission.admissionHash,
        retainedScopeHash: retainedScope.scopeHash,
        retainedProjectionHash: admission.retainedProjectionHash,
        retainedFileCount: retainedScope.retained.fileCount,
        liveManifest: admission.live,
        liveProjectionHash: archiveHash(projection),
        liveMediaDigest: archiveHash(media),
        conservationControlsHashes: Object.freeze(
          [
            ...new Set([
              ...controls,
              ...retainedScope.retained.conservationControlsHashes,
            ]),
          ].sort(),
        ),
        requiredThrough: horizon,
        stableCut: 'NOT_ASSESSED' as const,
        businessCommit: 'NOT_AUTHORIZED' as const,
      };
      return Object.freeze({
        admission,
        projection,
        scope: Object.freeze({ ...facts, scopeHash: archiveHash(facts) }),
      });
    } catch (error) {
      if (session.transaction === transaction && session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
  }

  /** Internal precondition for a later-period close from an already recorded decision. */
  async admitLaterPeriodDossierWithinTransaction(
    raw: ItemCaptureInput,
    rawSelection: PublishedHistoryRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    history: Pick<
      MongoOwnershipArchiveHistory,
      'fencePublishedStableCutScopeWithinTransaction'
    >,
  ) {
    const { admission } = await this.readLaterPeriodDossierInTransaction(
      raw,
      rawSelection,
      session,
      urls,
      source,
      history,
    );
    return admission;
  }

  private async readLaterPeriodDossierInTransaction(
    raw: ItemCaptureInput,
    rawSelection: PublishedHistoryRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    history: Pick<
      MongoOwnershipArchiveHistory,
      'fencePublishedStableCutScopeWithinTransaction'
    >,
  ) {
    assertArchiveCallerTransaction(session, this.requests, [
      this.items,
      this.claims,
      this.archives,
      this.entries,
      this.files,
      this.periods,
      this.controls,
    ]);
    const transaction = session.transaction;
    try {
      const input = itemCaptureInput(raw);
      const selection =
        publishedHistoryRecipientProjectionSelection(rawSelection);
      const { snapshot, selected } = await this.readItemDecisionSnapshot(
        input,
        session,
        false,
        true,
      );
      const { archive } = assessLaterPeriodItemDossier(input, snapshot);
      if (
        selection.archiveId !== archive.id ||
        selection.expectedArchiveDefinitionHash !== archive.definitionHash ||
        selection.expectedReservationEpoch !== selected.reservationEpoch ||
        selection.expectedPublicationHash !==
          archive.history?.sourcePublicationHash
      )
        throw new ConflictError(
          'The retained projection belongs to a different decision dossier',
        );
      await this.fenceItemCapture(input, snapshot, selected, session);
      const { projection, scope } =
        await history.fencePublishedStableCutScopeWithinTransaction(
          selection,
          session,
          urls,
        );
      const live = await this.readLaterPeriodLiveDossier(
        archive,
        source,
        urls,
        session,
      );
      if (
        live.manifest.entryCount + projection.entries.length !==
          archive.expectedEntryCount ||
        live.manifest.fileCount + projection.media.length !==
          archive.expectedFileCount ||
        session.transaction !== transaction
      )
        throw new ConflictError(
          'The current and retained records do not cover the sealed dossier',
        );
      assertArchiveCallerTransaction(session, this.requests, []);
      const binding = {
        protocol: 'LATER_PERIOD_ITEM_DOSSIER_ADMISSION_V1' as const,
        selector: input,
        archiveDefinitionHash: archive.definitionHash,
        acceptanceBindingHash: (
          snapshot.request!.acceptanceStart as AcceptanceStartBinding
        ).bindingHash,
        reservationEpoch: selected.reservationEpoch,
        reservationBindingHash: archive.reservation!.bindingHash,
        retainedScopeHash: scope.scopeHash,
        retainedProjectionHash: projection.projectionHash,
        live: live.manifest,
        businessCommit: 'NOT_AUTHORIZED' as const,
      };
      const admission = Object.freeze({
        ...binding,
        admissionHash: archiveHash(binding),
      });
      return {
        admission,
        archive,
        live,
        retainedScope: scope,
        publishedPredecessor: selected.predecessor !== undefined,
      };
    } catch (error) {
      if (session.transaction === transaction && session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
  }

  /** Import one page from the predecessor already fixed by the original decision. */
  async importLaterPeriodHistoryPage(
    raw: ItemCaptureInput,
    expectedHistoryRevision: number,
    requiredThrough: string,
    importer: Pick<OwnershipArchiveHistoryImporter, 'importBatchFromPublished'>,
  ) {
    const input = itemCaptureInput(raw);
    historicalPutEvidenceTime(requiredThrough);
    if (
      !Number.isSafeInteger(expectedHistoryRevision) ||
      expectedHistoryRevision < 0
    )
      throw new ConflictError('The expected history revision is invalid');
    const archive = await this.withPublishedHistorySnapshot(async (session) => {
      const { archive, history } = await this.readLaterPreparation(
        input,
        session,
      );
      if (history.revision !== expectedHistoryRevision)
        throw new ConflictError('The expected history page changed');
      return archive;
    });
    await importer.importBatchFromPublished(
      archive.id,
      requiredThrough,
      archive,
    );
    return this.observeLaterPeriodPreparation(input);
  }

  /** Read persisted progress after an acknowledged or uncertain page. */
  observeLaterPeriodPreparation(raw: ItemCaptureInput) {
    const input = itemCaptureInput(raw);
    return this.withPublishedHistorySnapshot(async (session) => {
      const { archive, history } = await this.readLaterPreparation(
        input,
        session,
      );
      return {
        state: archive.state,
        historyRevision: history.revision,
        historyPhase: history.phase,
        historyEntryCount: history.entryCount,
      };
    });
  }

  /** Stage one bounded page of live records; pages can be replayed under the same reservation. */
  async prepareLaterPeriodLivePage(
    raw: ItemCaptureInput,
    page: Readonly<{
      kind: 'ANIMAL' | 'DIARY_ENTRY' | 'MEDICAL_DOCUMENT';
      afterId?: string;
    }>,
    source: Pick<
      OwnershipArchiveSource,
      | 'findAnimal'
      | 'listDiary'
      | 'listAcceptedDocuments'
      | 'hasPendingMedicalWork'
    >,
    preparer: Pick<OwnershipArchivePreparer, 'append'>,
    history: Pick<
      MongoOwnershipArchiveHistory,
      | 'readPinnedPublishedPredecessorWithinTransaction'
      | 'assertPublishedLiveMediaWithinTransaction'
    >,
    storage: Pick<OwnershipArchiveStorage, 'assertTransferSafe' | 'inspect'>,
  ) {
    const input = itemCaptureInput(raw);
    const { kind, afterId } = page;
    if (
      !['ANIMAL', 'DIARY_ENTRY', 'MEDICAL_DOCUMENT'].includes(kind) ||
      (afterId !== undefined &&
        (kind === 'ANIMAL' || typeof afterId !== 'string' || !afterId))
    )
      throw new ConflictError('The live dossier page is invalid');
    const archive = await this.withPublishedHistorySnapshot(async (session) => {
      const { archive } = await this.readLaterPreparation(input, session);
      if (archive.state !== 'COLLECTING')
        throw new ConflictError('The later-period dossier is already sealed');
      return archive;
    });
    const animal = await source.findAnimal(archive.animalId);
    if (
      animal?.id !== archive.animalId ||
      animal.ownerId !== archive.ownerId ||
      animal.isActive === false ||
      (await source.hasPendingMedicalWork(archive.animalId))
    )
      throw new ConflictError(
        'The live dossier is unavailable for later-period preparation',
      );

    const records =
      kind === 'ANIMAL'
        ? [{ kind, data: animal } as const]
        : kind === 'DIARY_ENTRY'
          ? (
              await source.listDiary(
                archive.animalId,
                afterId,
                ITEM_MANIFEST_PAGE_SIZE,
              )
            ).map((data) => ({ kind, data }))
          : (
              await source.listAcceptedDocuments(
                archive.animalId,
                afterId,
                ITEM_MANIFEST_PAGE_SIZE,
              )
            ).map((data) => ({ kind, data }));
    if (records.length > ITEM_MANIFEST_PAGE_SIZE)
      throw new ConflictError('The live dossier exceeded its page limit');
    let last = afterId ?? '';
    for (const { data } of records) {
      if (typeof data.id !== 'string' || data.id <= last)
        throw new ConflictError(
          'The live dossier page did not advance in order',
        );
      last = data.id;
    }
    const sourceRevision = async (key: string) => {
      if (isReservedArchiveGenerationKey(key))
        return this.withPublishedHistorySnapshot(async (session) => {
          const { archive: admitted } = await this.readLaterPreparation(
            input,
            session,
          );
          const predecessor =
            await history.readPinnedPublishedPredecessorWithinTransaction(
              admitted,
              session,
              this.requests.db,
            );
          return history.assertPublishedLiveMediaWithinTransaction(
            predecessor,
            key,
            session,
          );
        });
      await storage.assertTransferSafe(key);
      return storage.inspect(key);
    };
    for (const record of records) {
      await preparer.append(archive.id, record, { archive, sourceRevision });
    }
    return {
      prepared: records.length,
      ...(kind !== 'ANIMAL' && records.length ? { afterId: last } : {}),
    };
  }

  /** Recheck the live dossier and seal both sets in the same reservation transaction. */
  sealLaterPeriodDossier(
    raw: ItemCaptureInput,
    urls: Pick<ArchiveProjectionUrls, 'keyFromUrl'>,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    predecessor: Pick<
      MongoOwnershipArchiveHistory,
      | 'readPinnedPublishedPredecessorWithinTransaction'
      | 'assertPublishedLiveMediaWithinTransaction'
    >,
    repository: Pick<
      MongoOwnershipArchiveRepository,
      'sealLaterPeriodWithinTransaction'
    >,
  ) {
    const input = itemCaptureInput(raw);
    return this.withPublishedHistorySnapshot(async (session) => {
      const { archive, history, selected, snapshot } =
        await this.readLaterPreparation(input, session);
      if (
        history.phase !== 'COMPLETE' ||
        history.entryCount !== history.expectedEntryCount
      )
        throw new ConflictError('Complete the retained dossier before sealing');
      await this.fenceItemCapture(input, snapshot, selected, session);
      const published =
        await predecessor.readPinnedPublishedPredecessorWithinTransaction(
          archive,
          session,
          this.requests.db,
        );
      if (
        history.sourceEntriesDigest !== published.manifestDigest?.entriesDigest
      )
        throw new ConflictError(
          'The retained dossier differs from its published predecessor',
        );
      const { manifest, files } = await this.readLaterPeriodLiveDossier(
        archive,
        source,
        urls,
        session,
      );
      for (const file of files) {
        if (!isPinnedItemSourceVersion(file.source.versionId))
          throw new ConflictError('The live dossier contains an unpinned file');
        if (isReservedArchiveGenerationKey(file.sourceKey)) {
          const revision =
            await predecessor.assertPublishedLiveMediaWithinTransaction(
              published,
              file.sourceKey,
              session,
            );
          if (archiveHash(revision) !== archiveHash(file.source))
            throw new ConflictError(
              'The inherited live file differs from its published version',
            );
        }
      }
      const entryCount = manifest.entryCount + history.expectedEntryCount;
      const fileCount = manifest.fileCount + history.expectedFileCount;
      if (!Number.isSafeInteger(entryCount) || !Number.isSafeInteger(fileCount))
        throw new ConflictError('The sealed dossier counts are invalid');
      await repository.sealLaterPeriodWithinTransaction(
        archive,
        entryCount,
        fileCount,
        session,
      );
      return {
        archiveId: archive.id,
        entryCount,
        fileCount,
        stableCut: 'NOT_ASSESSED' as const,
        businessCommit: 'NOT_AUTHORIZED' as const,
      };
    });
  }

  private async readLaterPreparation(
    input: ItemCaptureInput,
    session: ClientSession,
  ) {
    assertArchiveCallerTransaction(session, this.requests, [
      this.claims,
      this.controls,
    ]);
    if (
      this.claims.db !== this.requests.db ||
      this.controls.db !== this.requests.db
    )
      throw this.unavailable();
    const { snapshot } = await this.readItemDecisionSnapshot(
      input,
      session,
      false,
      true,
    );
    const preparation = assessLaterPeriodItemPreparation(input, snapshot);
    const { history } = preparation;
    if (
      !preparation.selected.predecessor ||
      !Number.isSafeInteger(history.revision) ||
      history.revision < 0 ||
      !Number.isSafeInteger(history.entryCount) ||
      history.entryCount < 0 ||
      history.entryCount > history.expectedEntryCount ||
      !sourceHashValid(history.sourceEntriesDigest)
    )
      throw new ConflictError(
        'The original decision did not bind a published predecessor',
      );
    return { ...preparation, snapshot };
  }

  /** Explicit copy operations bound to the reader for the current expediente. */
  laterPeriodLivePutStore(
    urls: Pick<ArchiveProjectionUrls, 'keyFromUrl'>,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
  ) {
    return {
      declare: (
        raw: ItemCaptureInput,
        rawDeclaration: LaterPeriodLivePutDeclarationInput,
      ) => {
        const input = itemCaptureInput(raw);
        const selection = laterPeriodLivePutKey(rawDeclaration);
        const {
          expectedAttemptHash,
          dispatcherInstanceId,
          source: sourceReport,
          destination,
        } = structuredClone(rawDeclaration);
        return this.withPublishedHistorySnapshot(async (session) => {
          const { scope, snapshot, selected } =
            await this.readLaterPeriodLivePutSelection(
              input,
              selection,
              urls,
              source,
              session,
            );
          const attempt = buildLaterPeriodLivePutAttempt(
            scope,
            selection,
            dispatcherInstanceId,
            sourceReport,
          );
          if (attempt.definitionHash !== expectedAttemptHash)
            throw new ConflictError('The selected live PUT attempt changed');
          const declaration = buildLaterPeriodLivePutDeclaration(
            attempt,
            sourceReport,
            destination,
          );
          const stored = await this.readLaterPeriodLivePutRecord(
            scope,
            selection,
            session,
          );
          if (
            stored &&
            archiveHash(stored.livePut.declaration) !== archiveHash(declaration)
          )
            throw new ConflictError('The declared live PUT cannot be replaced');
          if (stored) return stored;
          await this.fenceItemCapture(input, snapshot, selected, session);
          await this.fenceLaterPeriodLivePutControls(declaration, session);
          const record = buildLaterPeriodLivePutRecord(declaration);
          await this.copyRecords!.create([record], { session });
          return record;
        });
      },
      observe: (raw: ItemCaptureInput, rawSelection: LaterPeriodLivePutKey) => {
        const input = itemCaptureInput(raw);
        const selection = laterPeriodLivePutKey(rawSelection);
        return this.withPublishedHistorySnapshot(async (session) => {
          const { scope } = await this.readLaterPeriodLivePutSelection(
            input,
            selection,
            urls,
            source,
            session,
          );
          return this.readLaterPeriodLivePutRecord(scope, selection, session);
        });
      },
      permit: (
        raw: ItemCaptureInput,
        rawPins: LaterPeriodLivePutPermissionSelection,
        heldEvidence: () => LaterPeriodLivePutHeldEvidence | null,
      ) => {
        const input = itemCaptureInput(raw);
        const pins = laterPeriodLivePutPermissionSelection(rawPins);
        return this.withPublishedHistorySnapshot(async (session) => {
          const { scope, snapshot, selected } =
            await this.readLaterPeriodLivePutSelection(
              input,
              pins,
              urls,
              source,
              session,
            );
          const stored = await this.readLaterPeriodLivePutRecord(
            scope,
            pins,
            session,
          );
          if (
            !stored ||
            stored.definitionHash !== pins.expectedAttemptHash ||
            stored.livePut.declaration.protection.protectionHash !==
              pins.expectedProtectionHash
          )
            throw new ConflictError(
              'The selected live PUT declaration is absent or changed',
            );
          const { declaration, permission } = stored.livePut;
          if (permission) {
            if (archiveHash(permission.selection) !== archiveHash(pins))
              throw new ConflictError(
                'The live PUT already has a different permission',
              );
            return { recorded: false as const, permission };
          }
          await this.fenceItemCapture(input, snapshot, selected, session);
          const admittedAt = await this.fenceLaterPeriodLivePutControls(
            declaration,
            session,
          );
          const held = structuredClone(heldEvidence());
          if (!held)
            throw new ConflictError(
              'The live PUT requires its opened artifact and prepared transport',
            );
          const next = buildLaterPeriodLivePutPermission(
            pins,
            declaration,
            held,
            admittedAt,
          );
          this.changed(
            await this.copyRecords!.updateOne(
              {
                id: stored.id,
                row: stored.row,
                definitionHash: stored.definitionHash,
                'livePut.permission': { $exists: false },
              },
              {
                $set: {
                  'livePut.permission': next,
                  identityIds: [stored.id, next.authorizationId],
                },
              },
              { session },
            ).exec(),
          );
          return { recorded: true as const, permission: next };
        });
      },
    };
  }

  private async readLaterPeriodLivePutSelection(
    input: ItemCaptureInput,
    selection: LaterPeriodLivePutKey,
    urls: Pick<ArchiveProjectionUrls, 'keyFromUrl'>,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    session: ClientSession,
  ) {
    const result = await this.readLaterPeriodLiveMediaSelection(
      input,
      selection.fileId,
      urls,
      source,
      session,
    );
    if (archiveHash(result.scope) !== selection.expectedScopeHash)
      throw new ConflictError('The sealed live PUT scope changed');
    return result;
  }

  private async readLaterPeriodLivePutRecord(
    scope: LaterPeriodLiveMediaScope,
    raw: LaterPeriodLivePutKey,
    session: ClientSession,
  ) {
    if (!this.copyRecords || this.copyRecords.db !== this.requests.db)
      throw this.unavailable();
    assertArchiveCallerTransaction(session, this.requests, [this.copyRecords]);
    const selection = laterPeriodLivePutKey(raw);
    const stored = await this.copyRecords
      .findOne({ id: laterPeriodLivePutId(scope, selection.leg) })
      .select({ _id: 0 })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (!stored) return null;
    if (stored.row !== 'LATER_PERIOD_LIVE_PUT')
      throw new ConflictError(
        'The live PUT attempt identity is already in use',
      );
    return matchLaterPeriodLivePutRecord(scope, selection, stored);
  }

  private async fenceLaterPeriodLivePutControls(
    declaration: ReturnType<typeof buildLaterPeriodLivePutDeclaration>,
    session: ClientSession,
  ) {
    const config = this.sourceProfileConfirmation;
    const fence = config?.profiles.fenceActiveSharedControls;
    if (!config || !fence) throw this.unavailable();
    const transaction = session.transaction;
    const startedAt = config.now().getTime();
    assertLaterPeriodLivePutWindow(declaration, startedAt);
    const controls = new Set([
      declaration.source.controlsHash,
      declaration.protection.controlsHash,
    ]);
    for (const hash of [...controls].sort())
      await fence.call(config.profiles, hash, session);
    const checkedAt = config.now().getTime();
    if (checkedAt < startedAt || session.transaction !== transaction)
      throw new ConflictError('The live PUT clock or transaction changed');
    assertArchiveCallerTransaction(session, this.requests, [this.copyRecords!]);
    assertLaterPeriodLivePutWindow(declaration, checkedAt);
    return new Date(checkedAt).toISOString();
  }

  /** Exact sealed source and destinations for the independent producer. */
  laterPeriodLiveMediaStore(
    urls: Pick<ArchiveProjectionUrls, 'keyFromUrl'>,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
  ): LaterPeriodLiveMediaStore {
    return {
      observe: (item, fileId) =>
        this.observeLaterPeriodLiveMedia(item, fileId, urls, source),
      readCopyEffects: (raw, fileId, expectedScopeHash) => {
        const input = itemCaptureInput(raw);
        const key = laterPeriodLivePutKey({
          fileId,
          expectedScopeHash,
          leg: 'HISTORICAL',
        });
        return this.withPublishedHistorySnapshot(async (session) => {
          const { scope } = await this.readLaterPeriodLivePutSelection(
            input,
            key,
            urls,
            source,
            session,
          );
          const finalKey = laterPeriodLivePutKey({ ...key, leg: 'FINAL' });
          const historical = await this.readLaterPeriodLivePutRecord(
            scope,
            key,
            session,
          );
          const final = await this.readLaterPeriodLivePutRecord(
            scope,
            finalKey,
            session,
          );
          if (!historical?.livePut.permission || !final?.livePut.permission)
            throw new ConflictError(
              'Both live PUT effects need their original permissions',
            );
          return Object.freeze({
            historical: laterPeriodLivePutEffect(scope, key, historical),
            final: laterPeriodLivePutEffect(scope, finalKey, final),
          });
        });
      },
      register: (item, pins, evidence) =>
        this.registerLaterPeriodLiveMedia(item, pins, urls, source, evidence),
    };
  }

  private observeLaterPeriodLiveMedia(
    raw: ItemCaptureInput,
    fileId: string,
    urls: Pick<ArchiveProjectionUrls, 'keyFromUrl'>,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
  ) {
    const input = itemCaptureInput(raw);
    return this.withPublishedHistorySnapshot(async (session) => {
      const { scope } = await this.readLaterPeriodLiveMediaSelection(
        input,
        fileId,
        urls,
        source,
        session,
      );
      const stored = await this.readLaterPeriodLiveMediaRecord(scope, session);
      return Object.freeze({
        scope,
        scopeHash: archiveHash(scope),
        currentEvidenceHash: stored?.accreditationHash ?? null,
      });
    });
  }

  private registerLaterPeriodLiveMedia(
    raw: ItemCaptureInput,
    rawPins: LaterPeriodLiveMediaSelection,
    urls: Pick<ArchiveProjectionUrls, 'keyFromUrl'>,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    verifiedEvidence?: LaterPeriodLiveMediaEvidence,
  ) {
    const input = itemCaptureInput(raw);
    const {
      fileId,
      expectedScopeHash,
      expectedEvidenceHash,
      expectedPreviousEvidenceHash,
      requiredThrough,
    } = laterPeriodLiveMediaSelection(rawPins);
    // Only the internal reconciler supplies this report, after checking exact version bytes.
    const observed = structuredClone(verifiedEvidence);
    return this.withPublishedHistorySnapshot(async (session) => {
      const records = this.copyRecords!;
      const config = this.sourceProfileConfirmation;
      const fence = config?.profiles.fenceActiveSharedControls;
      if (!config || !fence) throw this.unavailable();
      const { scope, snapshot, selected } =
        await this.readLaterPeriodLiveMediaSelection(
          input,
          fileId,
          urls,
          source,
          session,
        );
      if (archiveHash(scope) !== expectedScopeHash)
        throw new ConflictError('The sealed live media scope changed');
      const stored = await this.readLaterPeriodLiveMediaRecord(scope, session);
      const previousHash = stored?.accreditationHash ?? null;
      const replayed = previousHash === expectedEvidenceHash;
      if (!replayed && previousHash !== expectedPreviousEvidenceHash)
        throw new ConflictError('The recorded live media evidence changed');
      const startedAt = config.now().getTime();
      const transaction = session.transaction;
      const evidence = matchLaterPeriodLiveMediaEvidence(
        scope,
        replayed ? stored?.liveMediaEvidence : observed,
        requiredThrough,
        startedAt,
      );
      await this.assertLaterPeriodLiveMediaPermissions(
        scope,
        evidence,
        startedAt,
        session,
      );
      if (archiveHash(evidence) !== expectedEvidenceHash)
        throw new ConflictError(
          'The independent live media report differs from the selected hash',
        );
      if (stored && !replayed) {
        assertSameLaterPeriodLiveCopies(stored.liveMediaEvidence, evidence);
        if (
          historicalPutEvidenceTime(evidence.validUntil) <=
          historicalPutEvidenceTime(stored.liveMediaEvidence.validUntil)
        )
          throw new ConflictError(
            'Live media renewal must extend the conservation window',
          );
      }
      await this.fenceItemCapture(input, snapshot, selected, session);
      const controls = new Set([
        evidence.historical.conservationControlsHash,
        evidence.final.conservationControlsHash,
      ]);
      for (const hash of [...controls].sort())
        await fence.call(config.profiles, hash, session);
      const checkedAt = config.now().getTime();
      if (
        checkedAt < startedAt ||
        session.transaction !== transaction ||
        (stored && startedAt < historicalPutEvidenceTime(stored.recordedAt))
      )
        throw new ConflictError(
          'The live media evidence clock or transaction changed',
        );
      matchLaterPeriodLiveMediaEvidence(
        scope,
        evidence,
        requiredThrough,
        checkedAt,
      );
      assertArchiveCallerTransaction(session, this.requests, [records]);
      const next =
        replayed && stored
          ? stored
          : buildLaterPeriodLiveMediaRecord(
              scope,
              evidence,
              new Date(checkedAt).toISOString(),
            );
      if (!replayed) {
        if (stored) {
          this.changed(
            await records
              .updateOne(
                {
                  id: stored.id,
                  row: stored.row,
                  definitionHash: stored.definitionHash,
                },
                {
                  $set: {
                    liveMediaEvidence: next.liveMediaEvidence,
                    accreditationHash: next.accreditationHash,
                    definitionHash: next.definitionHash,
                    recordedAt: next.recordedAt,
                  },
                },
                { session },
              )
              .exec(),
          );
        } else await records.create([next], { session });
      }
      return Object.freeze({
        evidenceHash: next.accreditationHash,
        recordedAt: next.recordedAt,
        replayed,
        businessCommit: 'NOT_AUTHORIZED' as const,
      });
    });
  }

  private async assertLaterPeriodLiveMediaPermissions(
    scope: LaterPeriodLiveMediaScope,
    evidence: LaterPeriodLiveMediaEvidence,
    checkedAt: number,
    session: ClientSession,
  ) {
    const expectedScopeHash = archiveHash(scope);
    for (const { leg, version, expectedPermission } of [
      {
        leg: 'HISTORICAL',
        version: evidence.historical,
        expectedPermission: evidence.copyPermissionHashes?.historical,
      },
      {
        leg: 'FINAL',
        version: evidence.final,
        expectedPermission: evidence.copyPermissionHashes?.final,
      },
    ] as const) {
      const put = await this.readLaterPeriodLivePutRecord(
        scope,
        {
          leg,
          fileId: scope.fileId,
          expectedScopeHash,
        },
        session,
      );
      const permission = put?.livePut.permission;
      const attempt = put?.livePut.declaration.attempt;
      if (
        !permission ||
        !attempt ||
        permission.permissionHash !== expectedPermission ||
        attempt.request.bucket !== version.target.bucket ||
        attempt.request.expectedBucketOwner !==
          version.target.expectedBucketOwner ||
        attempt.request.key !== version.target.key ||
        attempt.read.sha256 !== version.sha256 ||
        checkedAt < historicalPutEvidenceTime(permission.admittedAt)
      )
        throw new ConflictError(
          'The live media report requires both original PUT permissions',
        );
    }
  }

  private async readLaterPeriodLiveMediaSelection(
    input: ItemCaptureInput,
    fileId: string,
    urls: Pick<ArchiveProjectionUrls, 'keyFromUrl'>,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    session: ClientSession,
  ) {
    if (!sourceHashValid(fileId))
      throw new ConflictError('Invalid live media file identity');
    const { snapshot } = await this.readLaterPreparation(input, session);
    const { archive, selected, history } = assessLaterPeriodItemDossier(
      input,
      snapshot,
    );
    const { manifest, files } = await this.readLaterPeriodLiveDossier(
      archive,
      source,
      urls,
      session,
    );
    const file = files.find((candidate) => candidate.id === fileId);
    if (
      !file ||
      !isPinnedItemSourceVersion(file.source.versionId) ||
      manifest.entryCount + history.expectedEntryCount !==
        archive.expectedEntryCount ||
      manifest.fileCount + history.expectedFileCount !==
        archive.expectedFileCount
    )
      throw new ConflictError(
        'The file does not belong to the sealed live dossier',
      );
    return {
      scope: laterPeriodLiveMediaScope(archive, file),
      snapshot,
      selected,
    };
  }

  private async readLaterPeriodLiveMediaRecord(
    scope: LaterPeriodLiveMediaScope,
    session: ClientSession,
  ) {
    if (!this.copyRecords || this.copyRecords.db !== this.requests.db)
      throw this.unavailable();
    assertArchiveCallerTransaction(session, this.requests, [this.copyRecords]);
    const stored = await this.copyRecords
      .findOne({ id: laterPeriodLiveMediaRecordId(scope) })
      .select({ _id: 0 })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (!stored) return null;
    if (
      stored.row !== 'LATER_PERIOD_LIVE_MEDIA_EVIDENCE' ||
      archiveHash(
        buildLaterPeriodLiveMediaRecord(
          scope,
          stored.liveMediaEvidence,
          stored.recordedAt,
        ),
      ) !== archiveHash(stored)
    )
      throw new ConflictError(
        'The recorded live media evidence is inconsistent',
      );
    return stored;
  }

  private async readLaterPeriodLiveDossier(
    archive: OwnershipArchive,
    source: Pick<MongoOwnershipArchiveSource, 'visitLiveOwnershipResources'>,
    urls: Pick<ArchiveProjectionUrls, 'keyFromUrl'>,
    session: ClientSession,
  ) {
    const entries = new Map<string, ArchiveEntry>();
    const files = new Map<string, ArchiveFile>();
    await source.visitLiveOwnershipResources(
      archiveDefinitionOnly(archive),
      session,
      this.requests.db,
      async (record) => {
        const expected = buildArchiveEntry(archive, record, (url) =>
          urls.keyFromUrl(url),
        ).entry;
        const entry = await this.entries
          .findOne({ archiveId: archive.id, id: expected.id })
          .session(session)
          .lean()
          .exec();
        if (
          !entry ||
          entries.has(expected.id) ||
          rebuildItemManifestEntry(archive, entry, (url) =>
            urls.keyFromUrl(url),
          ).entry.contentHash !== expected.contentHash
        )
          throw new ConflictError(
            'A current resource differs from the sealed dossier',
          );
        entries.set(entry.id, entry);
        for (const { fileId } of entry.fileBindings) {
          if (files.has(fileId)) continue;
          const file = await this.files
            .findOne({ archiveId: archive.id, id: fileId })
            .session(session)
            .lean()
            .exec();
          if (!file)
            throw new ConflictError(
              'A current resource file is missing from the sealed dossier',
            );
          captureItemArchiveFileDefinition(archive, file);
          files.set(fileId, file);
        }
      },
    );
    const entryIds = [...entries.keys()].sort();
    const fileIds = [...files.keys()].sort();
    const entriesDigest = entryIds.reduce(
      (digest, id) => appendItemManifestEntryDigest(digest, entries.get(id)!),
      ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
    );
    const filesDigest = fileIds.reduce(
      (digest, id) =>
        appendItemManifestFileDigest(digest, id, files.get(id)!.definitionHash),
      ITEM_MANIFEST_FILES_DIGEST_SEED,
    );
    const manifest = Object.freeze({
      entryCount: entries.size,
      fileCount: files.size,
      entriesDigest,
      filesDigest,
    });
    return {
      manifest,
      entries: entryIds.map((id) => entries.get(id)!),
      files: fileIds.map((id) => files.get(id)!),
    };
  }

  commitItemOwnershipWithinTransaction(
    raw: ItemStableCutAccreditationSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    source: MongoOwnershipArchiveSource,
    models: OwnershipCommitModels,
  ): Promise<ItemOwnershipCommit> {
    return this.withItemProjectionSession(session, async () => {
      const pins = itemStableCutAccreditationSelection(raw);
      const { request, selected, receipt } = await this.readOwnershipCommit(
        pins,
        session,
      );
      if (receipt) return receipt;
      this.assertOwnershipCommitModels(models);
      const { result } = await this.consumeItemStableCutWithinTransaction(
        pins,
        session,
        urls,
        source,
        async ({ projection, consumption, resourceChanges }, active) => {
          return this.writeItemOwnershipOutcome(
            request,
            selected,
            models,
            active,
            (version) =>
              buildItemOwnershipCommit(
                projection.definition,
                pins,
                consumption,
                version,
              ),
            (outcome) => ({
              'evidenceConsumption.definitionHash': outcome.consumptionHash,
            }),
            () =>
              source.applyItemOwnershipResourceChanges(
                projection.definition,
                resourceChanges,
                active,
              ),
          );
        },
      );
      return result;
    });
  }

  /** Internal close of an already recorded later-period decision. */
  commitLaterPeriodItemOwnershipWithinTransaction(
    raw: LaterPeriodOwnershipSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    source: MongoOwnershipArchiveSource,
    history: Pick<
      MongoOwnershipArchiveHistory,
      | 'fencePublishedStableCutScopeWithinTransaction'
      | 'writePublishedRetainedReferencesWithOwnershipWithinTransaction'
    >,
    models: OwnershipCommitModels,
  ): Promise<LaterPeriodItemOwnershipCommit> {
    return this.withItemProjectionSession(session, async () => {
      const pins = this.laterPeriodOwnershipSelection(raw);
      const { request, selected, receipt } =
        await this.readLaterPeriodOwnershipCommit(pins, session);
      if (receipt) return receipt;
      this.assertOwnershipCommitModels(models);
      const { result } =
        await this.consumeLaterPeriodStableCutWithinTransaction(
          pins,
          session,
          urls,
          source,
          history,
          ({ archive, consumption, retainedReferencesReceipt }, active) =>
            this.writeItemOwnershipOutcome(
              request,
              selected,
              models,
              active,
              (version) =>
                buildLaterPeriodItemOwnershipCommit(
                  archive,
                  pins,
                  consumption,
                  selected.reservationEpoch,
                  version,
                ),
              (outcome) => ({
                'laterPeriodStableCutConsumption.definitionHash':
                  outcome.consumptionHash,
                'evidenceConsumption.definitionHash':
                  consumption.retainedConsumptionHash,
                'retainedReferencesReceipt.definitionHash':
                  retainedReferencesReceipt.definitionHash,
              }),
              () => undefined,
            ),
        );
      return result.result;
    });
  }

  readLaterPeriodItemOwnershipCommitWithinTransaction(
    raw: LaterPeriodOwnershipSelection,
    session: ClientSession,
  ): Promise<LaterPeriodItemOwnershipCommit | null> {
    return this.withItemProjectionSession(
      session,
      async () =>
        (
          await this.readLaterPeriodOwnershipCommit(
            this.laterPeriodOwnershipSelection(raw),
            session,
          )
        ).receipt,
    );
  }

  private laterPeriodOwnershipSelection(
    raw: LaterPeriodOwnershipSelection,
  ): LaterPeriodOwnershipSelection {
    if (
      ![
        raw?.expectedScopeHash,
        raw?.expectedAccreditationHash,
        raw?.expectedRetainedAccreditationHash,
      ].every(sourceHashValid)
    )
      throw new ConflictError('Invalid later-period ownership selection');
    return Object.freeze({
      selector: itemCaptureInput(raw.selector),
      retainedSelection: publishedHistoryRecipientProjectionSelection(
        raw.retainedSelection,
      ),
      expectedScopeHash: raw.expectedScopeHash,
      expectedAccreditationHash: raw.expectedAccreditationHash,
      expectedRetainedAccreditationHash: raw.expectedRetainedAccreditationHash,
    });
  }

  private async writeItemOwnershipOutcome<
    Outcome extends TransferItemOwnershipCommit,
  >(
    request: NonNullable<ItemCaptureSnapshot['request']>,
    selected: ReturnType<typeof selectItemCapture>['selected'],
    models: OwnershipCommitModels,
    active: ClientSession,
    buildOutcome: (requestVersion: number) => Outcome,
    consumptionFilter: (outcome: Outcome) => Record<string, string>,
    applyResources: () => void | Promise<void>,
  ): Promise<Outcome> {
    const binding = request.acceptanceStart as AcceptanceStartBinding;
    const acceptedItemCount = (request.acceptedItemCount ?? 0) + 1;
    const version = request.version + 1;
    if (
      !Number.isSafeInteger(version) ||
      acceptedItemCount > binding.selected.length
    )
      throw new ConflictError('Transfer acceptance progress is exhausted');
    const alreadyAccepted = await this.items
      .countDocuments({
        transferId: request._id,
        _id: { $in: binding.selected.map(({ itemId }) => itemId) },
        status: 'ACCEPTED',
        'ownershipCommit.protocol': {
          $in: [
            'TRANSFER_ITEM_OWNERSHIP_COMMIT_V1',
            'TRANSFER_LATER_PERIOD_ITEM_OWNERSHIP_COMMIT_V1',
          ],
        },
      })
      .session(active)
      .exec();
    if (alreadyAccepted !== acceptedItemCount - 1)
      throw new ConflictError('Transfer acceptance progress is inconsistent');
    const outcome = buildOutcome(version);
    const recipient = await models.users
      .findOneAndUpdate(
        { id: outcome.ownerId },
        { $inc: { transferRequestRevision: 1 } },
        { session: active, new: true },
      )
      .select({ transferRequestRevision: 1 })
      .lean()
      .exec();
    if (
      !Number.isSafeInteger(recipient?.transferRequestRevision) ||
      recipient!.transferRequestRevision! < 1
    )
      throw new ConflictError(
        'The transfer recipient is unavailable or inconsistent',
      );
    await applyResources();
    await writeOwnershipPeriodsAndControl(
      this.periods,
      this.controls,
      outcome,
      selected.reservationEpoch,
      active,
    );
    this.changed(
      await this.archives
        .updateOne(
          {
            id: outcome.archiveId,
            ...consumptionFilter(outcome),
            ownershipCommitHash: { $exists: false },
          },
          { $set: { ownershipCommitHash: outcome.commitHash } },
          { session: active },
        )
        .exec(),
    );
    this.changed(
      await this.items
        .updateOne(
          {
            _id: outcome.itemId,
            transferId: outcome.transferId,
            animalId: outcome.animalId,
            status: 'PROCESSING',
            captureArchiveId: outcome.archiveId,
            captureReservationEpoch: selected.reservationEpoch,
            ownershipCommit: { $exists: false },
          },
          { $set: { status: 'ACCEPTED', ownershipCommit: outcome } },
          { session: active },
        )
        .exec(),
    );
    this.changed(
      await this.requests
        .updateOne(
          {
            _id: outcome.transferId,
            status: 'PROCESSING',
            version: request.version,
            'acceptanceStart.bindingHash': binding.bindingHash,
            acceptedItemCount: request.acceptedItemCount ?? {
              $exists: false,
            },
          },
          {
            $set: {
              status: acceptedRequestStatus(binding, acceptedItemCount),
              acceptedItemCount,
              version,
            },
          },
          { session: active },
        )
        .exec(),
    );
    const released = await this.claims
      .deleteOne(
        {
          _id: outcome.animalId,
          transferId: outcome.transferId,
          acceptanceOperationId: outcome.decisionOperationId,
        },
        { session: active },
      )
      .exec();
    if (released.deletedCount !== 1)
      throw new ConflictError('The transfer claim changed');
    await this.writeOwnershipNotices(outcome, models, active);
    return outcome;
  }

  private assertOwnershipCommitModels(models: OwnershipCommitModels) {
    const participants = [
      models.users,
      models.events,
      models.notices,
      models.outbox,
    ];
    if (participants.some((model) => model.db !== this.requests.db))
      throw this.unavailable();
  }

  readItemOwnershipCommitWithinTransaction(
    raw: ItemStableCutAccreditationSelection,
    session: ClientSession,
  ): Promise<ItemOwnershipCommit | null> {
    return this.withItemProjectionSession(
      session,
      async () =>
        (
          await this.readOwnershipCommit(
            itemStableCutAccreditationSelection(raw),
            session,
          )
        ).receipt,
    );
  }

  /** Internal read by closed period, independent of the current owner's live dossier. */
  readPublishedOwnershipHistory(
    raw: PublishedHistoryPageInput,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
  ) {
    const input = publishedHistoryPageInput(raw);
    return this.withPublishedHistorySnapshot(async (session) => {
      const closed = await this.readHistoryClosedArchive(input, session);
      if (closed.archive.ownershipVersion > 1) {
        const later = await this.readPublishedLaterPeriodHistory(
          closed,
          session,
        );
        const { period, archive, receipt } = later;
        const publicationHash = receipt.commitHash;
        if (input.after && input.after.publicationHash !== publicationHash)
          throw new ConflictError(
            'The published ownership history cursor changed',
          );
        const dossier = await this.readPublishedLaterPeriodEntries(
          later,
          keyFromUrl,
          session,
          { after: input.after?.afterEntryId, limit: input.limit },
        );
        const page = dossier.entries.slice(0, input.limit);
        return Object.freeze({
          periodId: period.id,
          animalId: archive.animalId,
          ownershipVersion: archive.ownershipVersion,
          startedAt: period.startedAtKnown ? period.startedAt : undefined,
          endedAt: receipt.effectiveAt,
          publicationHash,
          mode: 'HISTORICAL_READ_ONLY' as const,
          entries: Object.freeze(page),
          nextCursor:
            dossier.entries.length > input.limit
              ? Object.freeze({
                  publicationHash,
                  afterEntryId: page.at(-1)!.entryId,
                })
              : undefined,
        });
      }
      const { archive, period, receipt } = await this.readPublishedHistory(
        input,
        session,
        closed,
      );
      const publicationHash = receipt.commitHash;
      if (input.after && input.after.publicationHash !== publicationHash)
        throw new ConflictError(
          'The published ownership history cursor changed',
        );
      const rows = await this.entries
        .find({
          archiveId: archive.id,
          ...(input.after ? { id: { $gt: input.after.afterEntryId } } : {}),
        })
        .sort({ id: 1 })
        .collation({ locale: 'simple' })
        .limit(input.limit + 1)
        .maxTimeMS(5000)
        .session(session)
        .lean()
        .exec();
      const page = rows
        .slice(0, input.limit)
        .map((row) =>
          projectPublishedHistoryEntry(
            rebuildItemManifestEntry(archive, row, keyFromUrl).entry,
          ),
        );
      return Object.freeze({
        periodId: period.id,
        animalId: period.animalId,
        ownershipVersion: period.ownershipVersion,
        startedAt: period.startedAtKnown ? period.startedAt : undefined,
        endedAt: receipt.effectiveAt,
        publicationHash,
        mode: 'HISTORICAL_READ_ONLY' as const,
        entries: Object.freeze(page),
        nextCursor:
          rows.length > input.limit
            ? Object.freeze({
                publicationHash,
                afterEntryId: page.at(-1)!.entryId,
              })
            : undefined,
      });
    });
  }

  /** Explicit composition for the downloader of both published period formats. */
  publishedHistoryVersionSource(
    retainedReader: Pick<
      MongoOwnershipArchiveHistory,
      'readPublishedRetainedCopyFacts'
    >,
  ) {
    return {
      readPublishedHistoryFileVersion: (
        raw: PublishedHistoryVersionInput,
        keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
      ) =>
        this.readPublishedHistoryFileVersion(raw, keyFromUrl, retainedReader),
    };
  }

  /** Private storage selector for the versioned download. */
  readPublishedHistoryFileVersion(
    raw: PublishedHistoryVersionInput,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
    retainedReader?: Pick<
      MongoOwnershipArchiveHistory,
      'readPublishedRetainedCopyFacts'
    >,
  ): Promise<PublishedHistoryFileVersion> {
    const input = publishedHistoryVersionInput(raw);
    return this.withPublishedHistorySnapshot((session) =>
      this.checkedPublishedHistoryVersion(
        input,
        keyFromUrl,
        session,
        'READ',
        retainedReader,
      ),
    );
  }

  async fencePublishedHistoryFileVersionWithinTransaction(
    raw: PublishedHistoryVersionInput,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
    session: ClientSession,
    connection: Connection,
  ): Promise<
    PublishedHistoryFileVersion & {
      representation: PublishedHistoryCopyRepresentation;
      versionObservationHash: string;
      conservationControlsHash: string;
      conservationCheckedAt: number;
    }
  > {
    this.assertPublishedHistoryTransaction(session, connection, [
      this.entries,
      this.files,
    ]);
    return this.checkedPublishedHistoryVersion(
      publishedHistoryVersionInput(raw),
      keyFromUrl,
      session,
      'FENCE',
    );
  }

  private async checkedPublishedHistoryVersion(
    input: PublishedHistoryVersionInput,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
    session: ClientSession,
    mode: 'READ' | 'FENCE',
    retainedReader?: Pick<
      MongoOwnershipArchiveHistory,
      'readPublishedRetainedCopyFacts'
    >,
  ): Promise<
    PublishedHistoryFileVersion & {
      representation: PublishedHistoryCopyRepresentation;
      versionObservationHash: string;
      conservationControlsHash: string;
      conservationCheckedAt: number;
    }
  > {
    const closed = await this.readHistoryClosedArchive(input, session);
    if (closed.archive.ownershipVersion > 1) {
      if (mode === 'FENCE')
        throw new ConflictError(
          'Importing a later-period publication is not supported',
        );
      return this.readPublishedLaterPeriodFileVersion(
        input,
        closed,
        keyFromUrl,
        session,
        retainedReader,
      );
    }
    const { scope, gateId, record, representation } =
      await this.readPublishedHistoryVersionFacts(
        input,
        keyFromUrl,
        session,
        closed,
      );
    const renewal = await this.readPublishedHistoryConservation(
      scope,
      gateId,
      session,
    );
    const config = this.sourceProfileConfirmation;
    const guard =
      mode === 'READ'
        ? config?.profiles.assertActiveSharedControls
        : config?.profiles.fenceActiveSharedControls;
    if (!config || !guard) throw this.unavailable();
    const renewedEvidence = renewal?.historyConservation.evidence;
    const conservationControlsHash =
      renewedEvidence?.controlsHash ?? record.evidence.conservationControlsHash;
    await guard.call(config.profiles, conservationControlsHash, session);
    const now = config.now().getTime();
    if (renewedEvidence) {
      if (now < historicalPutEvidenceTime(renewal.recordedAt))
        throw new ConflictError(
          'The renewed historical conservation was recorded after the current check',
        );
      assertPublishedHistoryConservationWindow(
        renewedEvidence,
        input.requiredThrough,
        now,
      );
    } else {
      assertHistoricalPutVersionUsable(record, input.requiredThrough, now);
    }
    return Object.freeze({
      target: scope.target,
      revision: scope.revision,
      fileDefinitionHash: scope.fileDefinitionHash,
      representation,
      versionObservationHash: record.observation.observationHash,
      conservationControlsHash,
      conservationCheckedAt: now,
      sha256: scope.sha256,
      requiredThrough: input.requiredThrough,
    });
  }

  /** Allows an internal producer to request evidence even after the initial window has ended. */
  observePublishedHistoryConservation(
    raw: PublishedHistoryFileInput,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
  ) {
    const input = publishedHistoryFileInput(raw);
    return this.withPublishedHistorySnapshot(async (session) => {
      const { scope, gateId } = await this.readPublishedHistoryVersionFacts(
        input,
        keyFromUrl,
        session,
      );
      const current = await this.readPublishedHistoryConservation(
        scope,
        gateId,
        session,
      );
      return Object.freeze({
        scope,
        currentEvidenceHash: current?.historyConservation.evidenceHash ?? null,
      });
    });
  }

  registerPublishedHistoryConservation(
    raw: PublishedHistoryFileInput,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
    expectedEvidenceHash: string,
    expectedPreviousEvidenceHash: string | null,
  ) {
    const input = publishedHistoryFileInput(raw);
    if (
      !sourceHashValid(expectedEvidenceHash) ||
      (expectedPreviousEvidenceHash !== null &&
        !sourceHashValid(expectedPreviousEvidenceHash))
    )
      throw new ConflictError(
        'The expected history conservation hashes are invalid',
      );
    return this.withPublishedHistorySnapshot(async (session) => {
      const { scope, gateId } = await this.readPublishedHistoryVersionFacts(
        input,
        keyFromUrl,
        session,
      );
      const current = await this.readPublishedHistoryConservation(
        scope,
        gateId,
        session,
      );
      const config = this.sourceProfileConfirmation;
      if (!config?.profiles.fenceActiveSharedControls) throw this.unavailable();
      const previousHash = current?.historyConservation.evidenceHash ?? null;
      const replay = current && previousHash === expectedEvidenceHash;
      if (!replay && previousHash !== expectedPreviousEvidenceHash)
        throw new ConflictError('The published history conservation changed');
      const evidence = replay
        ? current.historyConservation.evidence
        : structuredClone(
            config.publishedHistoryConservationFor?.(
              scope,
              expectedEvidenceHash,
            ),
          );
      if (!evidence)
        throw new ConflictError(
          'The independent history conservation evidence is absent',
        );
      const next = replay
        ? current
        : buildPublishedHistoryConservation(
            scope,
            gateId,
            evidence,
            expectedEvidenceHash,
            config.now().toISOString(),
          );
      if (
        !replay &&
        current &&
        (historicalPutEvidenceTime(evidence.validUntil) <=
          historicalPutEvidenceTime(
            current.historyConservation.evidence.validUntil,
          ) ||
          historicalPutEvidenceTime(next.recordedAt) <
            historicalPutEvidenceTime(current.recordedAt))
      )
        throw new ConflictError(
          'The renewed history conservation must extend the current window',
        );
      await config.profiles.fenceActiveSharedControls(
        evidence.controlsHash,
        session,
      );
      const now = config.now().getTime();
      if (now < historicalPutEvidenceTime(next.recordedAt))
        throw new ConflictError(
          'The historical conservation clock moved before recording',
        );
      assertPublishedHistoryConservationWindow(
        evidence,
        new Date(now).toISOString(),
        now,
      );
      if (!replay) {
        if (current) {
          this.changed(
            await this.copyRecords!.updateOne(
              {
                id: next.id,
                row: next.row,
                definitionHash: current.definitionHash,
              },
              {
                $set: {
                  definitionHash: next.definitionHash,
                  historyConservation: next.historyConservation,
                  recordedAt: next.recordedAt,
                },
              },
              { session },
            ).exec(),
          );
        } else {
          await this.copyRecords!.create([next], { session });
        }
      }
      return Object.freeze({
        evidenceHash: next.historyConservation.evidenceHash,
        recordedAt: next.recordedAt,
        replayed: Boolean(replay),
      });
    });
  }

  private async readPublishedHistoryConservation(
    scope: PublishedHistoryConservationScope,
    gateId: string,
    session: ClientSession,
  ) {
    const id = publishedHistoryConservationId(scope);
    const stored = await this.copyRecords!.findOne({ id })
      .select({ _id: 0 })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (!stored) return null;
    const mismatch = () =>
      new ConflictError('The recorded history conservation is inconsistent');
    if (
      stored.row !== 'PUBLISHED_HISTORY_CONSERVATION' ||
      !stored.historyConservation
    )
      throw mismatch();
    const { evidence, evidenceHash } = stored.historyConservation;
    const rebuilt = buildPublishedHistoryConservation(
      scope,
      gateId,
      evidence,
      evidenceHash,
      stored.recordedAt,
    );
    if (archiveHash(rebuilt) !== archiveHash(stored)) throw mismatch();
    return rebuilt;
  }

  private async readPublishedHistoryVersionFacts(
    input: PublishedHistoryFileInput,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
    session: ClientSession,
    closed?: Awaited<
      ReturnType<MongoTransferItemCapture['readHistoryClosedArchive']>
    >,
  ) {
    const { archive, receipt, accreditation, marker } =
      await this.readPublishedHistory(input, session, closed);
    if (receipt.commitHash !== input.publicationHash)
      throw new ConflictError('The selected history publication changed');
    const missing = () =>
      new ResourceNotFoundError('Historical file not found');
    const row = await this.entries
      .findOne({ id: input.entryId, archiveId: archive.id })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (!row) throw missing();
    const { files } = rebuildItemManifestEntry(archive, row, keyFromUrl);
    const binding = files.find((file) => file.id === input.fileId);
    if (!binding) throw missing();
    const file = await this.files
      .findOne({ id: binding.id, archiveId: archive.id })
      .select(finalVersionFileProjection)
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    const mismatch = () =>
      new ConflictError(
        'The published historical file evidence is inconsistent',
      );
    if (!file) throw mismatch();
    const definition = captureItemArchiveFileDefinition(archive, file);
    const expectedBinding = {
      ...marker.binding,
      fileId: file.id,
      fileDefinitionHash: file.definitionHash,
    };
    const staging = file.stagingCopyIntent;
    const historical = file.historicalCopyIntent;
    if (
      archiveHash(definition) !==
        archiveHash({ ...binding, source: definition.source }) ||
      historical?.protocol !== ITEM_ARCHIVE_COPY_INTENT_PROTOCOL ||
      historical.kind !== 'HISTORICAL' ||
      staging?.protocol !== ITEM_ARCHIVE_COPY_INTENT_PROTOCOL ||
      staging.kind !== 'RECIPIENT_STAGING' ||
      archiveHash(historical.binding) !== archiveHash(expectedBinding) ||
      archiveHash(staging.binding) !== archiveHash(expectedBinding) ||
      historical.destination.key !== binding.historicalKey ||
      staging.source.key !== binding.historicalKey ||
      staging.predecessor?.intentId !== historical.id ||
      staging.predecessor.intentDefinitionHash !== historical.definitionHash ||
      !staging.predecessor.historicalPutVersion
    )
      throw mismatch();
    const { definitionHash: historicalHash, ...historicalFacts } = historical;
    const { definitionHash: stagingHash, ...stagingFacts } = staging;
    if (
      archiveHash(historicalFacts) !== historicalHash ||
      archiveHash(stagingFacts) !== stagingHash
    )
      throw mismatch();
    const source = captureItemPutVersionSource(
      staging.predecessor.historicalPutVersion,
    );
    const expectedGate = buildItemCopyGateDefinition(marker.binding);
    const gateRow = await this.copyRecords!.findOne({ id: expectedGate.id })
      .select({ _id: 0 })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (gateRow?.row !== 'GATE') throw mismatch();
    const gate = captureItemCopyGate(gateRow, expectedGate);
    const { scope } = accreditation;
    if (
      scope.copyInventory.gate?.id !== gate.id ||
      scope.copyInventory.gate.recordHash !== archiveHash(gate) ||
      scope.retained.fileCount !== archive.expectedFileCount ||
      !scope.retained.conservationControlsHashes.includes(
        source.conservationControlsHash,
      )
    )
      throw mismatch();
    const original = await this.readStagingHistoricalPut(
      source,
      scope.selection.selector,
      gate,
      session,
    );
    const record = original.versionRecord;
    if (
      !record ||
      original.definition.manifestHash !== marker.manifestHash ||
      archiveHash(original.definition.binding) !==
        archiveHash(expectedBinding) ||
      original.definition.copyIntentId !== historical.id ||
      original.definition.copyIntentDefinitionHash !==
        historical.definitionHash ||
      original.permission.permissionHash !== source.permissionHash ||
      record.observation.observationHash !== source.versionObservationHash ||
      record.evidence.conservationControlsHash !==
        source.conservationControlsHash ||
      record.observation.scope.target.key !== binding.historicalKey ||
      record.observation.scope.target.bucket !== historical.bucket ||
      archiveHash(record.observation.revision) !==
        archiveHash(staging.source.revision) ||
      record.observation.scope.sha256 !== staging.source.sha256
    )
      throw mismatch();
    const conservationScope = publishedHistoryConservationScope(
      input,
      archive.id,
      file.definitionHash,
      record,
    );
    const {
      contentType,
      contentEncoding,
      contentLanguage,
      contentDisposition,
    } = original.definition.request;
    return {
      scope: conservationScope,
      gateId: gate.id,
      record,
      representation: Object.freeze({
        contentType,
        contentEncoding,
        contentLanguage,
        contentDisposition,
      }),
    };
  }

  private async withPublishedHistorySnapshot<Result>(
    read: (session: ClientSession) => Promise<Result>,
  ): Promise<Result> {
    const connection = this.requests.db;
    if (
      connection.readyState !== STATES.connected ||
      !this.copyRecords ||
      [
        this.items,
        this.archives,
        this.entries,
        this.files,
        this.periods,
        this.copyRecords,
      ].some((model) => model.db !== connection)
    )
      throw this.unavailable();
    const session = await connection.startSession();
    try {
      return await session.withTransaction(() => read(session), {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
        timeoutMS: 15000,
        maxCommitTimeMS: 5000,
      });
    } finally {
      await session.endSession();
    }
  }

  /** Reuses the destination import transaction without adopting its reservation. */
  async readPublishedHistoryPredecessorWithinTransaction(
    input: Readonly<{ actorId: string; periodId: string }>,
    session: ClientSession,
    connection: Connection,
  ) {
    this.assertPublishedHistoryTransaction(session, connection, []);
    const { archive, receipt } = await this.readPublishedHistory(
      input,
      session,
    );
    return Object.freeze({
      receipt,
      definitionHash: archive.definitionHash,
      entryCount: archive.expectedEntryCount!,
      fileCount: archive.expectedFileCount!,
    });
  }

  private assertPublishedHistoryTransaction(
    session: ClientSession,
    connection: Connection,
    additional: readonly Pick<Model<unknown>, 'db'>[],
  ) {
    if (!this.copyRecords) throw this.unavailable();
    const models = [
      this.items,
      this.periods,
      this.archives,
      this.copyRecords,
      ...additional,
    ];
    if (
      this.requests.db !== connection ||
      models.some((model) => model.db !== connection)
    )
      throw this.unavailable();
    assertArchiveCallerTransaction(session, this.requests, models);
  }

  private publishedHistoryMissing() {
    return new ResourceNotFoundError('Published ownership history not found');
  }

  private async readHistoryClosedArchive(
    input: Readonly<{ actorId: string; periodId: string }>,
    session: ClientSession,
  ) {
    const period = await this.periods
      .findOne({
        id: input.periodId,
        ownerId: input.actorId,
        status: AnimalOwnershipPeriodStatus.Closed,
      })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (!period?.archiveId || !period.endedAt)
      throw this.publishedHistoryMissing();
    const archive = await this.archives
      .findOne({
        id: period.archiveId,
        periodId: period.id,
        animalId: period.animalId,
        ownerId: input.actorId,
        ownershipVersion: period.ownershipVersion,
      })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (
      !archive?.ownershipCommitHash ||
      !['COPYING', 'READY'].includes(archive.state)
    )
      throw this.publishedHistoryMissing();
    return { period, archive };
  }

  private async readPublishedHistory(
    input: Readonly<{ actorId: string; periodId: string }>,
    session: ClientSession,
    closed?: Awaited<
      ReturnType<MongoTransferItemCapture['readHistoryClosedArchive']>
    >,
  ) {
    const { period, archive } =
      closed ?? (await this.readHistoryClosedArchive(input, session));
    const missing = () => this.publishedHistoryMissing();
    const marker = archive.evidenceConsumption;
    if (
      marker?.protocol !== 'ITEM_STABLE_CUT_CONSUMPTION_V1' ||
      !archive.manifestDigest
    )
      throw missing();
    const manifest = captureItemManifestDigest(archive.manifestDigest);
    if (
      manifest.manifestHash !== marker.manifestHash ||
      archiveHash(manifest.binding) !== archiveHash(marker.binding) ||
      archive.expectedEntryCount !== manifest.entryCount ||
      archive.expectedFileCount !== manifest.fileCount
    )
      throw missing();
    const stored = await this.copyRecords!.findOne({
      id: marker.accreditationId,
      row: 'STABLE_CUT_ACCREDITATION',
    })
      .select({ _id: 0 })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (stored?.row !== 'STABLE_CUT_ACCREDITATION') throw missing();
    const pins = itemStableCutAccreditationSelection({
      selection: stored.scope.selection,
      expectedScopeHash: marker.scopeHash,
      expectedAccreditationHash: marker.accreditationHash,
    });
    const gate = buildItemCopyGateDefinition(manifest.binding);
    const accreditation = buildItemStableCutAccreditationRecord(
      stored.scope,
      stored.accreditation,
      gate.id,
      marker.accreditationHash,
      stored.recordedAt,
    );
    if (
      accreditation.scope.scopeHash !== marker.scopeHash ||
      accreditation.id !== marker.accreditationId ||
      accreditation.definitionHash !== marker.accreditationDefinitionHash ||
      archiveHash(accreditation) !== archiveHash(stored) ||
      accreditation.scope.retained.fileCount !== manifest.fileCount
    )
      throw missing();
    const { receipt } = await this.readOwnershipCommit(pins, session, archive);
    if (
      !receipt ||
      receipt.closedPeriodId !== period.id ||
      receipt.previousOwnerId !== input.actorId ||
      receipt.effectiveAt !== period.endedAt ||
      receipt.ownershipVersion !== period.ownershipVersion + 1
    )
      throw missing();
    // Historical metadata remains readable after the original cut window ends.
    // Check the accreditation at the actual effective date, not the current clock.
    matchItemStableCutAccreditation(
      accreditation.scope,
      accreditation.accreditation,
      marker.accreditationHash,
      historicalPutEvidenceTime(receipt.effectiveAt),
    );
    return { period, archive, receipt, marker, accreditation };
  }

  private async readPublishedLaterPeriodHistory(
    {
      period,
      archive,
    }: Awaited<
      ReturnType<MongoTransferItemCapture['readHistoryClosedArchive']>
    >,
    session: ClientSession,
  ) {
    const retained = archive.evidenceConsumption;
    const joint = archive.laterPeriodStableCutConsumption;
    const links = archive.retainedReferencesReceipt;
    const history = archive.history;
    const missing = () => this.publishedHistoryMissing();
    if (
      archive.ownershipVersion !== 2 ||
      archive.capture !== undefined ||
      retained?.protocol !== 'PUBLISHED_HISTORY_STABLE_CUT_CONSUMPTION_V1' ||
      !joint ||
      !links ||
      history?.phase !== 'COMPLETE' ||
      retained.binding.sourceArchiveId !== history.sourceArchiveId ||
      retained.binding.publicationHash !== history.sourcePublicationHash ||
      history.entryCount !== history.expectedEntryCount ||
      links.entryCount !== history.expectedEntryCount ||
      links.fileCount !== history.expectedFileCount ||
      archiveHash(archive.reservation) !==
        archiveHash(
          buildArchiveReservation(archive, retained.binding.reservationEpoch),
        )
    )
      throw missing();
    const retainedRow = await this.copyRecords!.findOne({
      id: retained.accreditationId,
    })
      .select({ _id: 0 })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    const jointRow = await this.copyRecords!.findOne({
      id: joint.accreditationId,
    })
      .select({ _id: 0 })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (
      retainedRow?.row !== 'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION' ||
      jointRow?.row !== 'LATER_PERIOD_STABLE_CUT_ACCREDITATION'
    )
      throw missing();
    const retainedRecord = buildPublishedHistoryStableCutAccreditationRecord(
      retainedRow.scope,
      retainedRow.accreditation,
      retainedRow.accreditationHash,
      retainedRow.recordedAt,
    );
    const jointRecord = buildLaterPeriodStableCutAccreditationRecord(
      jointRow.scope,
      jointRow.accreditation,
      jointRow.accreditationHash,
      jointRow.recordedAt,
    );
    const scope = jointRecord.scope;
    if (
      archiveHash(retainedRecord) !== archiveHash(retainedRow) ||
      archiveHash(jointRecord) !== archiveHash(jointRow) ||
      archiveHash(
        buildPublishedHistoryStableCutConsumption(
          retainedRecord,
          joint.consumedAt,
        ),
      ) !== archiveHash(retained) ||
      archiveHash(buildLaterPeriodStableCutConsumption(jointRecord, links)) !==
        archiveHash(joint) ||
      archive.expectedEntryCount !==
        scope.liveManifest.entryCount + links.entryCount ||
      archive.expectedFileCount !==
        scope.liveManifest.fileCount + links.fileCount ||
      !Number.isSafeInteger(archive.expectedEntryCount) ||
      !Number.isSafeInteger(archive.expectedFileCount)
    )
      throw missing();
    const request = await this.requests
      .findById(archive.transferId)
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    const binding = request?.acceptanceStart;
    if (!request || !binding) throw missing();
    const nextPeriod = await this.periods
      .findOne({
        id: transferRecordId(
          'ownership-period',
          archive.transferId,
          transferRecordId('item', archive.transferId, archive.animalId),
        ),
      })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    const selector = itemCaptureInput({
      actorId: archive.recipientId,
      transferId: archive.transferId,
      itemId: transferRecordId('item', archive.transferId, archive.animalId),
      decisionOperationId: binding.operationId,
      expectedRequestVersion: binding.expectedVersion + 1,
      expectedCaptureRevision: 0,
    });
    const pins = this.laterPeriodOwnershipSelection({
      selector,
      retainedSelection: {
        archiveId: archive.id,
        expectedArchiveDefinitionHash: retained.binding.archiveDefinitionHash,
        expectedReservationEpoch: retained.binding.reservationEpoch,
        expectedPublicationHash: retained.binding.publicationHash,
        expectedSourceManifestHash: retained.binding.sourceManifestHash,
        expectedPreparedCoverageHash: retained.binding.preparedCoverageHash,
        expectedProjectionHash: retained.binding.projectionHash,
        requiredThrough: retained.binding.requiredThrough,
      },
      expectedScopeHash: scope.scopeHash,
      expectedAccreditationHash: jointRecord.accreditationHash,
      expectedRetainedAccreditationHash: retainedRecord.accreditationHash,
    });
    const { receipt, selected } = await this.readLaterPeriodOwnershipCommit(
      pins,
      session,
      archive,
    );
    if (
      !receipt ||
      receipt.closedPeriodId !== period.id ||
      receipt.previousOwnerId !== period.ownerId ||
      receipt.effectiveAt !== period.endedAt ||
      receipt.ownershipVersion !== period.ownershipVersion + 1 ||
      nextPeriod?.animalId !== archive.animalId ||
      nextPeriod.ownerId !== receipt.ownerId ||
      nextPeriod.ownershipVersion !== receipt.ownershipVersion ||
      nextPeriod.sourceTransferId !== archive.transferId ||
      nextPeriod.startedAtKnown !== true ||
      nextPeriod.startedAt !== receipt.effectiveAt ||
      scope.admissionHash !==
        archiveHash({
          protocol: 'LATER_PERIOD_ITEM_DOSSIER_ADMISSION_V1',
          selector,
          archiveDefinitionHash: archive.definitionHash,
          acceptanceBindingHash: binding.bindingHash,
          reservationEpoch: selected.reservationEpoch,
          reservationBindingHash: retained.binding.reservationBindingHash,
          retainedScopeHash: retained.scopeHash,
          retainedProjectionHash: retained.binding.projectionHash,
          live: scope.liveManifest,
          businessCommit: 'NOT_AUTHORIZED',
        })
    )
      throw missing();
    return {
      period,
      archive,
      receipt,
      scope,
      retained,
      links,
      history,
      retainedScope: retainedRecord.scope,
    };
  }

  private async readPublishedLaterPeriodEntries(
    dossier: Awaited<
      ReturnType<MongoTransferItemCapture['readPublishedLaterPeriodHistory']>
    >,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
    session: ClientSession,
    page: Readonly<{ after?: string; limit?: number; entryId?: string }>,
  ) {
    const { archive, retained, links, scope, history } = dossier;
    const missing = () => this.publishedHistoryMissing();
    const predecessor = await this.archives
      .findOne({
        id: history.sourceArchiveId,
        animalId: archive.animalId,
        recipientId: archive.ownerId,
        ownershipVersion: 1,
      })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (
      !predecessor ||
      predecessor.ownershipCommitHash !== history.sourcePublicationHash ||
      predecessor.definitionHash !== history.sourceDefinitionHash ||
      archiveHash(archiveDefinitionOnly(predecessor)) !==
        predecessor.definitionHash ||
      predecessor.manifestDigest?.manifestHash !==
        retained.binding.sourceManifestHash
    )
      throw missing();
    const rows: ArchiveEntry[] = [];
    const references: Array<{
      sourceEntryId: string;
      link: NonNullable<ArchiveEntry['retainedReferences']>;
    }> = [];
    const retainedFiles = new Set<string>();
    let after = '';
    let liveCount = 0;
    let liveDigest = ITEM_MANIFEST_ENTRIES_DIGEST_SEED;
    let cursorFound = page.after === undefined;
    while (true) {
      const batch = await this.entries
        .find({
          archiveId: archive.id,
          ...(after ? { id: { $gt: after } } : {}),
        })
        .sort({ id: 1 })
        .collation({ locale: 'simple' })
        .limit(ITEM_MANIFEST_PAGE_SIZE)
        .setOptions({ singleBatch: true })
        .maxTimeMS(5000)
        .session(session)
        .lean()
        .exec();
      if (!batch.length) break;
      for (const row of batch) {
        if (!sourceHashValid(row.id) || row.id <= after) throw missing();
        after = row.id;
        if (row.kind === 'RETAINED_RECORD') {
          if (
            !row.retained ||
            !row.retainedReferences ||
            references.length >= links.entryCount ||
            !Array.isArray(row.fileBindings)
          )
            throw missing();
          references.push({
            sourceEntryId: row.retained.sourceEntryId,
            link: row.retainedReferences,
          });
          for (const { fileId } of row.fileBindings) retainedFiles.add(fileId);
        } else {
          if (++liveCount > scope.liveManifest.entryCount) throw missing();
          liveDigest = appendItemManifestEntryDigest(liveDigest, row);
        }
        if (
          page.entryId
            ? row.id === page.entryId
            : cursorFound && rows.length <= page.limit!
        )
          rows.push(row);
        if (row.id === page.after) cursorFound = true;
      }
    }
    references.sort((a, b) => (a.sourceEntryId < b.sourceEntryId ? -1 : 1));
    if (
      !cursorFound ||
      liveCount !== scope.liveManifest.entryCount ||
      liveDigest !== scope.liveManifest.entriesDigest ||
      references.length !== links.entryCount ||
      new Set(references.map(({ sourceEntryId }) => sourceEntryId)).size !==
        references.length ||
      retainedFiles.size !== links.fileCount ||
      archiveHash(
        buildPublishedHistoryRetainedReferencesReceipt(
          retained,
          references.map(({ link }) => link),
          links.fileCount,
        ),
      ) !== archiveHash(links)
    )
      throw missing();
    const entries = rows.map((row) =>
      row.kind === 'RETAINED_RECORD'
        ? projectPublishedRetainedEntry(
            archive,
            predecessor,
            row,
            retained.binding.publicationHash,
            retained.definitionHash,
            keyFromUrl,
          )
        : projectPublishedHistoryEntry(
            rebuildItemManifestEntry(archive, row, keyFromUrl).entry,
          ),
    );
    return { entries, rows, predecessor };
  }

  private async readPublishedLaterPeriodFileVersion(
    input: PublishedHistoryVersionInput,
    closed: Awaited<
      ReturnType<MongoTransferItemCapture['readHistoryClosedArchive']>
    >,
    keyFromUrl: ArchiveProjectionUrls['keyFromUrl'],
    session: ClientSession,
    retainedReader?: Pick<
      MongoOwnershipArchiveHistory,
      'readPublishedRetainedCopyFacts'
    >,
  ) {
    const dossier = await this.readPublishedLaterPeriodHistory(closed, session);
    const { archive, receipt, scope, retained, retainedScope } = dossier;
    if (receipt.commitHash !== input.publicationHash)
      throw new ConflictError('The selected history publication changed');
    const { rows, predecessor } = await this.readPublishedLaterPeriodEntries(
      dossier,
      keyFromUrl,
      session,
      { entryId: input.entryId },
    );
    const row = rows.find((entry) => entry.id === input.entryId);
    if (!row?.fileBindings.some(({ fileId }) => fileId === input.fileId))
      throw new ResourceNotFoundError('Historical file not found');

    const invalid = () =>
      new ConflictError(
        'The historical version does not match the published dossier',
      );
    const config = this.sourceProfileConfirmation;
    const guard = config?.profiles.assertActiveSharedControls;
    if (!config || !guard) throw this.unavailable();
    const file = await this.files
      .findOne({ id: input.fileId, archiveId: archive.id })
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (!file) throw invalid();
    const requiredThrough = input.requiredThrough;
    const finish = async (
      version: Omit<PublishedHistoryFileVersion, 'requiredThrough'>,
      representation: PublishedHistoryCopyRepresentation,
      observationHash: string,
      controls: string,
      verify: (checkedAt: number) => void,
    ) => {
      await guard.call(config.profiles, controls, session);
      const checkedAt = config.now().getTime();
      if (checkedAt < historicalPutEvidenceTime(receipt.effectiveAt))
        throw invalid();
      verify(checkedAt);
      return Object.freeze({
        ...version,
        requiredThrough,
        representation,
        versionObservationHash: observationHash,
        conservationControlsHash: controls,
        conservationCheckedAt: checkedAt,
      });
    };

    if (row.kind === 'RETAINED_RECORD') {
      if (!retainedReader) throw this.unavailable();
      const coverage = {
        archiveId: archive.id,
        expectedArchiveDefinitionHash: archive.definitionHash,
        expectedReservationEpoch: retained.binding.reservationEpoch,
        expectedPublicationHash: retained.binding.publicationHash,
        expectedSourceManifestHash: retained.binding.sourceManifestHash,
        requiredThrough: retained.binding.requiredThrough,
      };
      const { record, representation } =
        await this.readPublishedLaterRetainedVersions(
          retainedScope,
          archive,
          predecessor,
          coverage,
          file.id,
          retainedReader,
          session,
        );
      assertHistoricalPutVersionUsable(
        record,
        scope.requiredThrough,
        historicalPutEvidenceTime(receipt.effectiveAt),
      );
      const { observation, evidence } = record;
      if (
        !retainedScope.retained.conservationControlsHashes.includes(
          evidence.conservationControlsHash,
        )
      )
        throw invalid();
      return finish(
        {
          target: observation.scope.target,
          revision: observation.revision,
          fileDefinitionHash: file.definitionHash,
          sha256: observation.scope.sha256,
        },
        representation,
        observation.observationHash,
        evidence.conservationControlsHash,
        (at) => assertHistoricalPutVersionUsable(record, requiredThrough, at),
      );
    }

    const files = await this.files
      .find({ archiveId: archive.id, retained: { $exists: false } })
      .select(manifestFileProjection)
      .sort({ id: 1 })
      .collation({ locale: 'simple' })
      .limit(scope.liveManifest.fileCount + 1)
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (
      files.length !== scope.liveManifest.fileCount ||
      files.reduce(
        (digest, item) =>
          appendItemManifestFileDigest(digest, item.id, item.definitionHash),
        ITEM_MANIFEST_FILES_DIGEST_SEED,
      ) !== scope.liveManifest.filesDigest
    )
      throw invalid();
    let selected: Awaited<
      ReturnType<MongoTransferItemCapture['readLaterPeriodLiveMediaRecord']>
    > = null;
    const media = [];
    for (const current of files) {
      captureItemArchiveFileDefinition(archive, current);
      const mediaScope = laterPeriodLiveMediaScope(archive, current);
      const record = await this.readLaterPeriodLiveMediaRecord(
        mediaScope,
        session,
      );
      if (!record) throw invalid();
      if (
        historicalPutEvidenceTime(record.recordedAt) >
        historicalPutEvidenceTime(receipt.effectiveAt)
      )
        throw invalid();
      const evidence = matchLaterPeriodLiveMediaEvidence(
        mediaScope,
        record.liveMediaEvidence,
        scope.requiredThrough,
        historicalPutEvidenceTime(receipt.effectiveAt),
      );
      if (current.id === file.id) selected = record;
      media.push({
        id: archiveHash([
          'LATER_PERIOD_LIVE_MEDIA_REFERENCE_V1',
          current.id,
          record.accreditationHash,
        ]),
        fileId: current.id,
        key: evidence.final.target.key,
        evidenceHash: record.accreditationHash,
        historical: evidence.historical,
        final: evidence.final,
      });
    }
    if (!selected || archiveHash(media) !== scope.liveMediaDigest)
      throw invalid();
    const mediaScope = laterPeriodLiveMediaScope(archive, file);
    await this.assertLaterPeriodLiveMediaPermissions(
      mediaScope,
      selected.liveMediaEvidence,
      historicalPutEvidenceTime(receipt.effectiveAt),
      session,
    );
    const put = await this.readLaterPeriodLivePutRecord(
      mediaScope,
      {
        fileId: file.id,
        expectedScopeHash: archiveHash(mediaScope),
        leg: 'HISTORICAL',
      },
      session,
    );
    if (!put) throw invalid();
    const { historical } = selected.liveMediaEvidence;
    return finish(
      {
        target: historical.target,
        revision: historical.revision,
        sha256: historical.sha256,
        fileDefinitionHash: file.definitionHash,
      },
      this.historyRepresentation(put.livePut.declaration.attempt.request),
      selected.accreditationHash,
      historical.conservationControlsHash,
      (at) => {
        matchLaterPeriodLiveMediaEvidence(
          mediaScope,
          selected.liveMediaEvidence,
          requiredThrough,
          at,
        );
      },
    );
  }

  private async readPublishedLaterRetainedVersions(
    scope: ReturnType<typeof buildPublishedHistoryStableCutScope>,
    archive: OwnershipArchive,
    predecessor: OwnershipArchive,
    coverage: PublishedHistoryFinalCoverageInput,
    selectedId: string,
    reader: Pick<
      MongoOwnershipArchiveHistory,
      'readPublishedRetainedCopyFacts'
    >,
    session: ClientSession,
  ) {
    const invalid = () =>
      new ConflictError('The retained versions differ from the published cut');
    const files = await this.files
      .find({
        archiveId: archive.id,
        'retained.sourceArchiveId': predecessor.id,
      })
      .sort({ 'retained.sourceFileId': 1 })
      .collation({ locale: 'simple' })
      .limit(scope.retained.fileCount + 1)
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (files.length !== scope.retained.fileCount) throw invalid();
    const versions: PublishedHistoryStableCutFile[] = [];
    let selected:
      | {
          record: ReturnType<
            typeof reader.readPublishedRetainedCopyFacts
          >['historical'];
          representation: PublishedHistoryCopyRepresentation;
        }
      | undefined;
    let previous = '';
    for (const file of files) {
      const sourceFileId = file.retained?.sourceFileId;
      if (!sourceHashValid(sourceFileId) || sourceFileId <= previous)
        throw invalid();
      previous = sourceFileId;
      const original = await this.files
        .findOne({ id: sourceFileId, archiveId: predecessor.id })
        .select({ id: 1, definitionHash: 1, historicalKey: 1, relativeKey: 1 })
        .maxTimeMS(5000)
        .session(session)
        .lean()
        .exec();
      const { historical, final, attempts } =
        reader.readPublishedRetainedCopyFacts(
          coverage,
          archive,
          predecessor,
          file,
          original ?? undefined,
        );
      const pin = ({
        observation,
        evidence,
      }: typeof historical | typeof final) => ({
        observationHash: observation.observationHash,
        target: observation.scope.target,
        revision: observation.revision,
        sha256: observation.scope.sha256,
        conservationControlsHash: evidence.conservationControlsHash,
      });
      const attempt = ({
        attemptDefinitionHash,
        protectionHash,
        authorizationId,
        permissionHash,
      }: (typeof attempts)[number]) => ({
        attemptDefinitionHash,
        protectionHash,
        authorizationId,
        permissionHash,
      });
      versions.push({
        fileId: file.id,
        fileDefinitionHash: file.definitionHash,
        sourceFileId,
        attempts: [
          attempt(attempts[0]),
          attempt(attempts[1]),
          attempt(attempts[2]),
        ],
        historical: pin(historical),
        final: pin(final),
      });
      if (file.id === selectedId) {
        const declaration = file.publishedHistoryPutDeclaration;
        if (!declaration) throw invalid();
        selected = {
          record: historical,
          representation: this.historyRepresentation(
            declaration.attempt.request,
          ),
        };
      }
    }
    if (
      !selected ||
      archiveHash(
        buildPublishedHistoryStableCutScope(scope.binding, versions),
      ) !== archiveHash(scope)
    )
      throw invalid();
    return selected;
  }

  private historyRepresentation({
    contentType,
    contentEncoding,
    contentLanguage,
    contentDisposition,
  }: PublishedHistoryCopyRepresentation) {
    return Object.freeze({
      contentType,
      contentEncoding,
      contentLanguage,
      contentDisposition,
    });
  }

  private async readLaterPeriodOwnershipCommit(
    pins: LaterPeriodOwnershipSelection,
    session: ClientSession,
    publishedArchive?: OwnershipArchive,
  ) {
    const input = pins.selector;
    const requestRow = await this.requests
      .findById(input.transferId)
      .session(session)
      .lean()
      .exec();
    const { request, selected } = selectItemCapture(input, requestRow);
    const item = await this.items
      .findById(input.itemId)
      .session(session)
      .lean()
      .exec();
    const mismatch = () =>
      new ConflictError(
        'The later-period ownership receipt differs from the selected decision',
      );
    const selection = pins.retainedSelection;
    if (
      !item ||
      input.expectedCaptureRevision !== 0 ||
      item.transferId !== input.transferId ||
      item.animalId !== selected.animalId ||
      item.captureArchiveId !== selected.archiveId ||
      item.captureReservationEpoch !== selected.reservationEpoch ||
      item.expectedOwnerId !== request.senderId ||
      !Number.isSafeInteger(item.expectedOwnershipVersion) ||
      item.expectedOwnershipVersion < 2 ||
      selection.archiveId !== selected.archiveId ||
      (selected.predecessor !== undefined &&
        selection.expectedPublicationHash !==
          selected.predecessor.publicationHash) ||
      selection.expectedReservationEpoch !== selected.reservationEpoch
    )
      throw mismatch();
    if (
      request.status === 'PROCESSING' &&
      item.status === 'PROCESSING' &&
      item.ownershipCommit === undefined
    )
      return { request, selected, receipt: null };
    const receipt = item.ownershipCommit;
    if (
      item.status !== 'ACCEPTED' ||
      receipt?.protocol !== 'TRANSFER_LATER_PERIOD_ITEM_OWNERSHIP_COMMIT_V1' ||
      !Number.isSafeInteger(receipt.requestVersion) ||
      receipt.requestVersion <= input.expectedRequestVersion ||
      receipt.requestVersion > request.version
    )
      throw mismatch();
    const archive =
      publishedArchive ??
      (await this.archives
        .findOne({ id: selected.archiveId })
        .session(session)
        .lean()
        .exec());
    const joint = archive?.laterPeriodStableCutConsumption;
    const retained = archive?.evidenceConsumption;
    const links = archive?.retainedReferencesReceipt;
    const publication = archive?.retainedReferencesPublication;
    if (
      !archive ||
      !joint ||
      !links ||
      !publication ||
      archive.id !== selected.archiveId ||
      retained?.protocol !== 'PUBLISHED_HISTORY_STABLE_CUT_CONSUMPTION_V1' ||
      joint.protocol !== 'LATER_PERIOD_STABLE_CUT_CONSUMPTION_V1' ||
      archive.ownershipCommitHash !== receipt.commitHash ||
      archive.animalId !== selected.animalId ||
      archive.transferId !== input.transferId ||
      archive.ownerId !== request.senderId ||
      archive.recipientId !== input.actorId ||
      archive.ownershipVersion !== item.expectedOwnershipVersion ||
      archive.definitionHash !== selection.expectedArchiveDefinitionHash ||
      archiveHash(archiveDefinitionOnly(archive)) !== archive.definitionHash ||
      archive.reservation?.epoch !== selected.reservationEpoch ||
      archive.reservation.bindingHash !==
        retained.binding.reservationBindingHash ||
      retained.binding.archiveId !== archive.id ||
      retained.binding.archiveDefinitionHash !== archive.definitionHash ||
      retained.binding.reservationEpoch !== selected.reservationEpoch ||
      retained.binding.publicationHash !== selection.expectedPublicationHash ||
      (selected.predecessor !== undefined &&
        retained.binding.sourceArchiveId !== selected.predecessor.archiveId) ||
      retained.binding.sourceManifestHash !==
        selection.expectedSourceManifestHash ||
      retained.binding.preparedCoverageHash !==
        selection.expectedPreparedCoverageHash ||
      retained.binding.projectionHash !== selection.expectedProjectionHash ||
      retained.binding.requiredThrough !== selection.requiredThrough ||
      retained.accreditationHash !== pins.expectedRetainedAccreditationHash ||
      joint.archiveId !== archive.id ||
      joint.scopeHash !== pins.expectedScopeHash ||
      joint.accreditationHash !== pins.expectedAccreditationHash ||
      joint.retainedConsumptionHash !== retained.definitionHash ||
      joint.retainedReceiptHash !== links.definitionHash ||
      joint.consumedAt !== retained.consumedAt ||
      links.archiveId !== archive.id ||
      links.consumptionHash !== retained.definitionHash ||
      links.scopeHash !== retained.scopeHash ||
      links.accreditationHash !== retained.accreditationHash ||
      links.recordedAt !== retained.consumedAt ||
      archiveHash(links.binding) !== archiveHash(retained.binding)
    )
      throw mismatch();
    for (const { definitionHash, ...facts } of [joint, retained, links])
      if (archiveHash(facts) !== definitionHash) throw mismatch();
    const rebuilt = buildLaterPeriodItemOwnershipCommit(
      archiveDefinitionOnly(archive),
      pins,
      joint,
      selected.reservationEpoch,
      receipt.requestVersion,
    );
    if (
      archiveHash(receipt) !== archiveHash(rebuilt) ||
      archiveHash(publication) !==
        archiveHash(
          buildPublishedHistoryRetainedReferencesPublication(links, rebuilt),
        )
    )
      throw mismatch();
    return { request, selected, receipt: rebuilt };
  }

  private async readOwnershipCommit(
    pins: ItemStableCutAccreditationSelection,
    session: ClientSession,
    publishedArchive?: OwnershipArchive,
  ) {
    const input = pins.selection.selector;
    const requestRow = await this.requests
      .findById(input.transferId)
      .session(session)
      .lean()
      .exec();
    const { request, selected } = selectItemCapture(input, requestRow);
    const item = await this.items
      .findById(input.itemId)
      .session(session)
      .lean()
      .exec();
    const mismatch = () =>
      new ConflictError(
        'The item ownership commit is inconsistent with the selected decision',
      );
    if (
      !item ||
      item.transferId !== input.transferId ||
      item.animalId !== selected.animalId ||
      item.captureArchiveId !== selected.archiveId ||
      item.captureReservationEpoch !== selected.reservationEpoch ||
      item.expectedOwnerId !== request.senderId ||
      item.expectedOwnershipVersion !== 1
    )
      throw mismatch();
    const receipt = item.ownershipCommit;
    if (
      request.status === 'PROCESSING' &&
      item.status === 'PROCESSING' &&
      receipt === undefined
    )
      return { request, selected, receipt: null };
    if (
      item.status !== 'ACCEPTED' ||
      receipt?.protocol !== 'TRANSFER_ITEM_OWNERSHIP_COMMIT_V1'
    )
      throw mismatch();
    const archive =
      publishedArchive ??
      (await this.archives
        .findOne({ id: selected.archiveId })
        .session(session)
        .lean()
        .exec());
    const marker = archive?.evidenceConsumption;
    if (
      !archive ||
      archive.id !== selected.archiveId ||
      marker?.protocol !== 'ITEM_STABLE_CUT_CONSUMPTION_V1' ||
      archive.ownershipCommitHash !== receipt.commitHash ||
      archive.animalId !== selected.animalId ||
      archive.transferId !== input.transferId ||
      archive.ownerId !== request.senderId ||
      archive.recipientId !== input.actorId ||
      archive.ownershipVersion !== 1 ||
      receipt.requestVersion <= input.expectedRequestVersion ||
      !Number.isSafeInteger(receipt.requestVersion) ||
      receipt.requestVersion > request.version
    )
      throw mismatch();
    const definition = archiveDefinitionOnly(archive);
    const { definitionHash, ...consumed } = marker;
    const seal = marker.binding?.observedSeal;
    if (
      !seal ||
      archiveHash(consumed) !== definitionHash ||
      marker.archiveId !== archive.id ||
      marker.binding.transferId !== input.transferId ||
      marker.binding.itemId !== input.itemId ||
      marker.binding.requestVersion !== input.expectedRequestVersion ||
      marker.decisionOperationId !== input.decisionOperationId ||
      seal.archiveId !== archive.id ||
      seal.acceptanceBindingHash !==
        (request.acceptanceStart as AcceptanceStartBinding).bindingHash ||
      seal.definitionHash !== archiveHash(definition) ||
      archive.definitionHash !== seal.definitionHash ||
      archive.reservation?.bindingHash !== seal.reservationBindingHash ||
      archive.reservation.epoch !== selected.reservationEpoch ||
      archive.capture?.phase !== 'COMPLETE' ||
      archive.capture.revision !== seal.captureRevision ||
      seal.reservationEpoch !== selected.reservationEpoch ||
      seal.captureRevision !== input.expectedCaptureRevision ||
      marker.binding.observedSealHash !== pins.selection.expectedSealHash ||
      marker.manifestHash !== pins.selection.expectedManifestHash ||
      marker.preparedCoverageHash !==
        pins.selection.expectedPreparedCoverageHash ||
      marker.projectionHash !== pins.selection.expectedProjectionHash ||
      marker.scopeHash !== pins.expectedScopeHash ||
      marker.accreditationHash !== pins.expectedAccreditationHash
    )
      throw mismatch();
    const rebuilt = buildItemOwnershipCommit(
      definition,
      pins,
      marker,
      receipt.requestVersion,
    );
    if (archiveHash(receipt) !== archiveHash(rebuilt)) throw mismatch();
    return { request, selected, receipt: rebuilt };
  }

  private async writeOwnershipNotices(
    result: TransferItemOwnershipCommit,
    models: OwnershipCommitModels,
    session: ClientSession,
  ): Promise<void> {
    const { transferId, itemId, ownerId, previousOwnerId, effectiveAt } =
      result;
    await models.events.create(
      [
        {
          _id: result.id,
          type: 'ITEM_ACCEPTED',
          transferId,
          itemId,
          actorId: ownerId,
          operationId: result.decisionOperationId,
          version: result.requestVersion,
          ownershipCommitId: result.id,
          createdAt: effectiveAt,
        },
      ],
      { session },
    );
    const notices: TransferNotice[] = [previousOwnerId, ownerId].map(
      (userId) => ({
        _id: transferRecordId(
          'item-accepted-notice',
          transferId,
          `${itemId}/${userId}`,
        ),
        userId,
        transferId,
        type: 'TRANSFER_ITEM_ACCEPTED',
        itemIds: [itemId],
        title: 'Transferencia completada',
        text: 'Se completó la transferencia de un animal de la solicitud.',
        createdAt: effectiveAt,
      }),
    );
    await models.notices.insertMany(notices, { session, ordered: true });
    await models.outbox.insertMany(
      notices.map((notice) => ({
        _id: transferRecordId(
          'item-accepted-outbox',
          transferId,
          `${itemId}/${notice.userId}`,
        ),
        notificationId: notice._id,
        userId: notice.userId,
        transferId,
        status: 'PENDING',
        attempts: 0,
        pushProtocol: 'DEVICE_REVISION_V1',
        revision: 0,
        createdAt: effectiveAt,
      })),
      { session, ordered: true },
    );
  }

  /** Stages the single consumption and its caller's business writes in the same transaction. */
  private consumeItemStableCutWithinTransaction<Result>(
    raw: ItemStableCutAccreditationSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    source: Pick<
      MongoOwnershipArchiveSource,
      'readItemOwnershipResourceChanges'
    >,
    writeBusiness: (
      input: Readonly<{
        projection: SelectedRecipientProjection['projection'];
        consumption: ItemStableCutConsumption;
        resourceChanges: readonly ItemOwnershipResourceChange[];
      }>,
      session: ClientSession,
    ) => Promise<Result>,
  ) {
    return this.withItemProjectionSession(session, async () => {
      if (
        typeof source?.readItemOwnershipResourceChanges !== 'function' ||
        typeof writeBusiness !== 'function'
      )
        throw new ConflictError(
          'Item stable-cut consumption requires live resource revalidation and transactional business writes',
        );
      const transaction = session.transaction;
      const { projection, consumption, record } =
        await this.itemStableCutAccreditationInSnapshot(
          raw,
          session,
          urls,
          'CONSUME',
        );
      const resourceChanges = await source.readItemOwnershipResourceChanges(
        projection,
        urls,
        session,
        this.requests.db,
      );
      const result = await writeBusiness(
        Object.freeze({ projection, consumption, resourceChanges }),
        session,
      );
      if (!session.inTransaction() || session.transaction !== transaction)
        throw new ConflictError(
          'The caller transaction ended during item stable-cut consumption',
        );
      const { projectionHash, ...candidate } = projection;
      if (archiveHash(candidate) !== projectionHash)
        throw new ConflictError(
          'The consumed recipient projection changed during business writes',
        );
      const after = matchItemStableCutAccreditation(
        record.scope,
        record.accreditation,
        record.accreditationHash,
        this.sourceProfileConfirmation!.now().getTime(),
      );
      if (Date.parse(after.checkedAt) < Date.parse(consumption.consumedAt))
        throw new ConflictError(
          'The item stable-cut clock moved before consumption',
        );
      return Object.freeze({ consumption, result });
    });
  }

  private readSelectedItemStableCut(
    raw: ItemRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ) {
    const retained: ItemStableCutRetainedVersions = {
      fileCount: 0,
      versionsDigest: archiveHash([
        ITEM_STABLE_CUT_SCOPE_PROTOCOL,
        'RETAINED_VERSIONS',
      ]),
      controls: new Set<string>(),
    };
    return this.readSelectedRecipientProjection(raw, session, urls, retained);
  }

  private readSelectedRecipientProjection(
    raw: ItemRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
  ): Promise<SelectedRecipientProjection>;
  private readSelectedRecipientProjection(
    raw: ItemRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    retained: ItemStableCutRetainedVersions,
  ): Promise<SelectedItemStableCut>;
  private async readSelectedRecipientProjection(
    raw: ItemRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    retained?: ItemStableCutRetainedVersions,
  ) {
    const selection = itemRecipientProjectionSelection(raw);
    const { expectedPreparedCoverageHash, expectedProjectionHash, ...input } =
      selection;
    const { snapshot, selected } = await this.readCaptureSnapshot(
      input.selector,
      session,
      true,
    );
    const stored = snapshot.archive!.manifestDigest;
    if (
      !stored ||
      matchItemManifestDigest(input, snapshot, stored).manifestHash !==
        input.expectedManifestHash
    )
      throw new ConflictError('The selected item projection manifest changed');

    const finalCoverage = new ItemRecipientFinalCoverageObserver({
      readRecipientProjectionMediaPage: (page) =>
        this.readRecipientProjectionMediaPageInSnapshot(
          page,
          snapshot,
          session,
          retained,
        ),
    });
    const reader = new ItemRecipientProjectionReader(
      {
        readManifestPage: (page) =>
          this.readManifestPageInSnapshot(
            itemManifestReadInput(page),
            snapshot,
            false,
            session,
          ),
      },
      finalCoverage,
      urls,
    );
    const projection = await reader.read(input);
    if (
      projection.preparedCoverageHash !== expectedPreparedCoverageHash ||
      projection.projectionHash !== expectedProjectionHash
    )
      throw new ConflictError(
        'The selected recipient projection evidence changed',
      );
    if (retained) {
      if (retained.fileCount !== projection.media.length)
        throw new ConflictError(
          'The retained versions do not cover the selected projection',
        );
      const inventory = await this.readStableCutCopyInventory(
        selection,
        snapshot,
        session,
      );
      return Object.freeze({
        selection,
        projection,
        snapshot,
        selected,
        scope: buildItemStableCutScope(selection, inventory, {
          fileCount: retained.fileCount,
          versionsDigest: retained.versionsDigest,
          conservationControlsHashes: [...retained.controls].sort(),
        }),
      });
    }
    return Object.freeze({ selection, projection });
  }

  private async withItemProjectionSession<Result>(
    session: ClientSession,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (!this.copyRecords || !this.registrations) throw this.unavailable();
    const models = [
      this.items,
      this.claims,
      this.archives,
      this.controls,
      this.periods,
      this.entries,
      this.files,
      this.copyRecords,
      this.registrations,
    ];
    if (models.some((model) => model.db !== this.requests.db))
      throw this.unavailable();
    assertArchiveCallerTransaction(session, this.requests, models);
    try {
      return await operation();
    } catch (error) {
      if (session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
  }

  private itemStableCutAccreditationInSnapshot(
    raw: ItemStableCutAccreditationSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    mode: 'REGISTER' | 'READ',
  ): Promise<CheckedItemStableCutAccreditation>;
  private itemStableCutAccreditationInSnapshot(
    raw: ItemStableCutAccreditationSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    mode: 'CONSUME',
  ): Promise<
    CheckedItemStableCutAccreditation &
      Readonly<{ consumption: ItemStableCutConsumption }>
  >;
  private async itemStableCutAccreditationInSnapshot(
    raw: ItemStableCutAccreditationSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    mode: 'REGISTER' | 'READ' | 'CONSUME',
  ) {
    const pins = itemStableCutAccreditationSelection(raw);
    const { expectedScopeHash, expectedAccreditationHash } = pins;
    const { selection, projection, scope, snapshot, selected } =
      await this.readSelectedItemStableCut(pins.selection, session, urls);
    if (scope.scopeHash !== expectedScopeHash)
      throw new ConflictError('The selected item stable-cut scope changed');

    const id = itemStableCutAccreditationRecordId(
      expectedScopeHash,
      expectedAccreditationHash,
    );
    const stored = await this.copyRecords!.findOne({ id })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    if (stored && stored.row !== 'STABLE_CUT_ACCREDITATION')
      throw new ConflictError(
        'The stable-cut accreditation identity is already in use',
      );
    if (!stored && mode !== 'REGISTER')
      throw new ConflictError(
        'The selected item stable-cut accreditation is absent',
      );

    const config = this.sourceProfileConfirmation;
    if (!config) throw this.unavailable();
    const guard =
      mode === 'READ'
        ? config.profiles.assertActiveSharedControls
        : config.profiles.fenceActiveSharedControls;
    if (!guard) throw this.unavailable();
    const report = structuredClone(
      stored
        ? stored.accreditation
        : config.stableCutAccreditationFor?.(scope, expectedAccreditationHash),
    );
    if (!report)
      throw new ConflictError(
        'The independent item stable-cut accreditation is absent',
      );
    matchItemStableCutAccreditation(
      scope,
      report,
      expectedAccreditationHash,
      config.now().getTime(),
    );
    const gateId = buildItemCopyGate(selection.selector, snapshot).id;
    const previous =
      stored &&
      buildItemStableCutAccreditationRecord(
        scope,
        report,
        gateId,
        expectedAccreditationHash,
        stored.recordedAt,
      );
    if (stored && archiveHash(stored) !== archiveHash(previous))
      throw new ConflictError(
        'The stored item stable-cut accreditation changed',
      );

    if (mode !== 'READ')
      await this.fenceItemCapture(
        selection.selector,
        snapshot,
        selected,
        session,
      );
    const generations = new Set([
      ...scope.retained.conservationControlsHashes,
      report.controlsHash,
    ]);
    for (const generation of [...generations].sort())
      await guard.call(config.profiles, generation, session);
    const observation = matchItemStableCutAccreditation(
      scope,
      report,
      expectedAccreditationHash,
      config.now().getTime(),
    );
    if (
      previous &&
      Date.parse(observation.checkedAt) < Date.parse(previous.recordedAt)
    )
      throw new ConflictError(
        'The item stable-cut accreditation was recorded after the current check',
      );
    const record =
      previous ??
      buildItemStableCutAccreditationRecord(
        scope,
        report,
        gateId,
        expectedAccreditationHash,
        observation.checkedAt,
      );
    if (mode === 'REGISTER' && !stored)
      await this.copyRecords!.create([record], { session });
    if (mode === 'CONSUME') {
      const consumption = buildItemStableCutConsumption(
        record,
        projection,
        observation.checkedAt,
      );
      await this.recordItemStableCutConsumption(
        snapshot.archive!,
        consumption,
        session,
      );
      return Object.freeze({
        selection,
        projection,
        record,
        observation,
        consumption,
      });
    }
    return Object.freeze({ selection, projection, record, observation });
  }

  private async recordItemStableCutConsumption(
    archive: OwnershipArchive,
    consumption: ItemStableCutConsumption,
    session: ClientSession,
  ): Promise<void> {
    const { observedSeal } = consumption.binding;
    this.changed(
      await this.archives
        .updateOne(
          {
            id: consumption.archiveId,
            definitionHash: observedSeal.definitionHash,
            state: archive.state,
            'capture.phase': 'COMPLETE',
            'capture.revision': observedSeal.captureRevision,
            'reservation.bindingHash': observedSeal.reservationBindingHash,
            'reservation.epoch': observedSeal.reservationEpoch,
            expectedEntryCount: observedSeal.expectedEntryCount,
            expectedFileCount: observedSeal.expectedFileCount,
            'manifestDigest.manifestHash': consumption.manifestHash,
            evidenceConsumption: { $exists: false },
          },
          { $set: { evidenceConsumption: consumption } },
          { session },
        )
        .exec(),
    );
  }
  registerRecipientFinalMedia(raw: ItemRecipientFinalMediaRegistrationInput) {
    const registration = recipientFinalMediaRegistrationInput(raw);
    return this.transaction(registration.selector, { registration });
  }
  resumeManifestDigest(raw: ItemManifestDigestInput) {
    const input = itemManifestDigestInput(raw);
    return this.transaction(input.selector, { digest: input });
  }
  confirmManifestDigest(
    raw: ItemManifestDigestInput,
    result: ItemManifestDigestResult,
  ) {
    const input = itemManifestDigestInput(raw),
      observed = captureItemManifestDigest(result);
    return this.transaction(input.selector, { digest: input, observed });
  }
  admit(raw: ItemCaptureInput): Promise<ItemCaptureAdmission> {
    return this.transaction(itemCaptureInput(raw), true);
  }
  async observe(raw: ItemCaptureInput): Promise<ItemCaptureProgress> {
    const result = await this.transaction(itemCaptureInput(raw), false);
    if (!('progress' in result)) throw this.unavailable();
    return result.progress;
  }
  inspectCopyPreparation(
    raw: ItemCaptureInput,
  ): Promise<ItemCopyPreparationInspection> {
    return this.transaction(itemCaptureInput(raw), 'inspect');
  }
  prepareHistoricalCopy(raw: ItemHistoricalCopyPreparationInput) {
    const input = historicalCopyPreparationInput(raw);
    return this.transaction(input.selector, { historical: input });
  }
  readHistoricalCopy(raw: ItemHistoricalCopyPreparationInput) {
    const input = historicalCopyPreparationInput(raw);
    return this.transaction(input.selector, {
      historical: input,
      readOnly: true,
    });
  }
  readHistoricalSourceForAnchor(raw: ItemHistoricalSourceAnchorInput) {
    const { preparation, expectedManifestHash } =
      historicalSourceAnchorInput(raw);
    return this.transaction(preparation.selector, {
      historical: preparation,
      expectedManifestHash,
    });
  }
  resumeSourceRetention(raw: ItemSourceRetentionPreparationInput) {
    const { anchor, expectedBucketOwner } =
      sourceRetentionPreparationInput(raw);
    return this.transaction(anchor.preparation.selector, {
      historical: anchor.preparation,
      expectedManifestHash: anchor.expectedManifestHash,
      sourceRetention: { expectedBucketOwner },
    });
  }
  confirmSourceRetention(
    raw: ItemSourceRetentionPreparationInput,
    observed: ItemSourceRetentionObservation,
  ) {
    const { anchor, expectedBucketOwner } =
      sourceRetentionPreparationInput(raw);
    const observation = captureItemSourceRetentionObservation(observed);
    return this.transaction(anchor.preparation.selector, {
      historical: anchor.preparation,
      expectedManifestHash: anchor.expectedManifestHash,
      sourceRetention: { expectedBucketOwner, observation },
    });
  }
  resumeSourceProfileObservation(raw: ItemSourceProfilePreparationInput) {
    return this.sourceProfileTransaction(sourceProfilePreparationInput(raw));
  }
  async confirmSourceProfileObservation(
    raw: ItemSourceProfilePreparationInput,
    observed: ItemSourceProfileObservationSet,
  ): Promise<ItemSourceProfileObservationReceipt> {
    const result = await this.sourceProfileTransaction(
      sourceProfilePreparationInput(raw),
      captureItemSourceProfileObservationSet(observed),
    );
    if (!result) throw this.unavailable();
    return result;
  }
  private sourceProfileTransaction(
    { anchor, ...pins }: ItemSourceProfilePreparationInput,
    observation?: ItemSourceProfileObservationSet,
  ) {
    return this.transaction(anchor.preparation.selector, {
      historical: anchor.preparation,
      expectedManifestHash: anchor.expectedManifestHash,
      sourceProfile: { ...pins, observation },
    });
  }
  resumeStagingCopy(raw: ItemHistoricalCopyPreparationInput) {
    const input = historicalCopyPreparationInput(raw);
    return this.transaction(input.selector, { historical: input, staging: {} });
  }
  readStagingCopy(raw: ItemHistoricalCopyPreparationInput) {
    const input = historicalCopyPreparationInput(raw);
    return this.transaction(input.selector, {
      historical: input,
      readOnly: 'STAGING',
    });
  }
  resumeStagingObservation(raw: ItemHistoricalCopyPreparationInput) {
    const input = historicalCopyPreparationInput(raw);
    return this.transaction(input.selector, {
      historical: input,
      stagingBytes: {},
    });
  }
  confirmStagingObservation(
    raw: ItemHistoricalCopyPreparationInput,
    observed: ItemStagingByteObservation,
  ) {
    const input = historicalCopyPreparationInput(raw);
    const observation = captureStagingByteObservation(observed);
    return this.transaction(input.selector, {
      historical: input,
      stagingBytes: { observation },
    });
  }
  resumeSourceObservation(raw: ItemHistoricalCopyPreparationInput) {
    const input = historicalCopyPreparationInput(raw);
    return this.transaction(input.selector, { historical: input, source: {} });
  }
  confirmSourceObservation(
    raw: ItemHistoricalCopyPreparationInput,
    observed: ItemSourceByteObservation,
  ) {
    const input = historicalCopyPreparationInput(raw);
    const observation = captureSourceByteObservation(observed);
    return this.transaction(input.selector, {
      historical: input,
      source: { observation },
    });
  }
  confirmHistoricalObservation(
    raw: ItemHistoricalCopyPreparationInput,
    observed: ItemHistoricalByteObservation,
  ) {
    const input = historicalCopyPreparationInput(raw);
    const observation = captureHistoricalByteObservation(observed);
    return this.transaction(input.selector, {
      historical: input,
      staging: { observation },
    });
  }
  private unavailable() {
    return new ServiceUnavailableException(
      'Item capture admission or progress could not be acknowledged; retain the original reservation and reobserve the same revision',
    );
  }
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: { mode: 'READ' } },
  ): Promise<ItemCopyGateRecord | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      copy: Extract<
        CopyRecordAction,
        {
          mode:
            | 'OPEN'
            | 'REVOKE'
            | 'DECLARE'
            | 'DECLARE_PUT'
            | 'DECLARE_STAGING_PUT'
            | 'DECLARE_FINAL_PUT';
        }
      >;
    },
  ): Promise<ItemCopyRecordReceipt>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      digest: ItemManifestDigestInput;
      observed: ItemManifestDigestResult;
    },
  ): Promise<ItemManifestPreparationReceipt>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      digest: ItemManifestDigestInput;
      observed?: ItemManifestDigestResult;
    },
  ): Promise<ItemManifestPreparationReceipt | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: { manifest: ItemManifestReadInput },
  ): Promise<ItemManifestPage>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      coverage: ItemRecipientFinalCoveragePageInput;
      recipientRegistry: 'PROJECTION';
    },
  ): Promise<ItemRecipientProjectionMediaPage>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      coverage: ItemRecipientFinalCoveragePageInput;
      recipientRegistry: 'PREPARED';
    },
  ): Promise<ItemRecipientPreparedCoveragePage>;
  private transaction(
    input: ItemCaptureInput,
    admit: { coverage: ItemRecipientFinalCoveragePageInput },
  ): Promise<ItemRecipientFinalCoveragePage>;
  private transaction(
    input: ItemCaptureInput,
    admit: { registration: ItemRecipientFinalMediaRegistrationInput },
  ): Promise<ItemRecipientFinalMediaRegistration>;
  private transaction(
    input: ItemCaptureInput,
    admit: boolean,
  ): Promise<ItemCaptureAdmission>;
  private transaction(
    input: ItemCaptureInput,
    admit: 'inspect',
  ): Promise<ItemCopyPreparationInspection>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      readOnly: true | 'STAGING';
    },
  ): Promise<ItemCopyIntentContext>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      expectedManifestHash: string;
      sourceProfile: SourceProfilePreparation;
    },
  ): Promise<ItemSourceProfileObservationReceipt | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      expectedManifestHash: string;
      sourceRetention: {
        expectedBucketOwner: string;
        observation: ItemSourceRetentionObservation;
      };
    },
  ): Promise<ItemSourceRetentionReceipt>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      expectedManifestHash: string;
      sourceRetention: {
        expectedBucketOwner: string;
        observation?: ItemSourceRetentionObservation;
      };
    },
  ): Promise<ItemSourceRetentionReceipt | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      expectedManifestHash: string;
    },
  ): Promise<ItemHistoricalSourceAnchorMaterial>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      stagingBytes: { observation: ItemStagingByteObservation };
    },
  ): Promise<ItemStagingObservationReceipt>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      stagingBytes: { observation?: ItemStagingByteObservation };
    },
  ): Promise<ItemStagingObservationReceipt | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      source: { observation: ItemSourceByteObservation };
    },
  ): Promise<ItemSourceObservationReceipt>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      source: { observation?: ItemSourceByteObservation };
    },
  ): Promise<ItemSourceObservationReceipt | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      staging: { observation: ItemHistoricalByteObservation };
    },
  ): Promise<ItemStagingCopyPreparationReceipt>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      historical: ItemHistoricalCopyPreparationInput;
      staging: { observation?: ItemHistoricalByteObservation };
    },
  ): Promise<ItemStagingCopyPreparationReceipt | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: { historical: ItemHistoricalCopyPreparationInput },
  ): Promise<ItemHistoricalCopyPreparationReceipt>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      copy: {
        mode: 'ASSESS_SOURCE_WINDOW';
        input: ItemSourceWindowAssessmentInput;
      };
    },
  ): Promise<SourceWindowAssessment>;
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: SourceBoundAction },
  ): Promise<ItemSourceDelegationBoundReceipt | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: { mode: 'READ_PUT_V2'; input: ItemHistoricalPutReadInput } },
  ): Promise<ItemHistoricalPutAttemptV2Record>;
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: DestinationProtectionAction },
  ): Promise<ItemHistoricalPutDestinationProtectionReceipt | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: HistoricalPutPermissionAction },
  ): Promise<ItemHistoricalPutPermissionObservation | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: PutReconciliationAction },
  ): Promise<ItemHistoricalPutVersionContext | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: Extract<StagingPutAction, { mode: 'READ_STAGING_PUT' }> },
  ): Promise<ItemStagingPutAttemptRecord>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      copy: Extract<RecipientFinalPutAction, { mode: 'READ_FINAL_PUT' }>;
    },
  ): Promise<ItemRecipientFinalPutAttemptRecord>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      copy:
        | RecipientFinalPutPermissionHistoryAction
        | Extract<
            RecipientFinalPutAction,
            { mode: 'RECORD_FINAL_PUT_PERMISSION' }
          >;
    },
  ): Promise<ItemRecipientFinalPutPermissionObservation | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: RecipientFinalPutReconciliationAction },
  ): Promise<ItemRecipientFinalPutVersionContext | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      copy:
        | StagingPutPermissionHistoryAction
        | Extract<StagingPutAction, { mode: 'RECORD_STAGING_PUT_PERMISSION' }>;
    },
  ): Promise<ItemStagingPutPermissionObservation | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: { copy: StagingPutReconciliationAction },
  ): Promise<ItemStagingPutVersionContext | null>;
  private transaction(
    input: ItemCaptureInput,
    admit: {
      copy: {
        mode: 'PREPARE_PUT_STAGING' | 'PREPARE_PUT_FINAL';
        input: ItemPutVersionPreparationInput;
      };
    },
  ): Promise<ItemObservedCopyPreparationReceipt>;
  private async transaction(
    input: ItemCaptureInput,
    admit:
      | boolean
      | 'inspect'
      | { copy: CopyRecordAction }
      | { manifest: ItemManifestReadInput }
      | {
          coverage: ItemRecipientFinalCoveragePageInput;
          recipientRegistry?: RecipientRegistryRead;
        }
      | { registration: ItemRecipientFinalMediaRegistrationInput }
      | { digest: ItemManifestDigestInput; observed?: ItemManifestDigestResult }
      | {
          historical: ItemHistoricalCopyPreparationInput;
          readOnly?: true | 'STAGING';
          expectedManifestHash?: string;
          sourceProfile?: SourceProfilePreparation;
          sourceRetention?: {
            expectedBucketOwner: string;
            observation?: ItemSourceRetentionObservation;
          };
          stagingBytes?: { observation?: ItemStagingByteObservation };
          source?: { observation?: ItemSourceByteObservation };
          staging?: { observation?: ItemHistoricalByteObservation };
        },
  ): Promise<
    | ItemCaptureAdmission
    | ItemCopyPreparationInspection
    | ItemHistoricalCopyPreparationReceipt
    | ItemCopyIntentContext
    | ItemHistoricalSourceAnchorMaterial
    | ItemSourceRetentionReceipt
    | ItemSourceProfileObservationReceipt
    | ItemManifestPage
    | ItemRecipientFinalCoveragePage
    | ItemRecipientFinalMediaRegistration
    | ItemManifestPreparationReceipt
    | ItemStagingCopyPreparationReceipt
    | ItemCopyGateRecord
    | ItemCopyRecordReceipt
    | ItemHistoricalPutAttemptV2Record
    | ItemHistoricalPutDestinationProtectionReceipt
    | ItemHistoricalPutPermissionObservation
    | ItemHistoricalPutVersionContext
    | ItemStagingPutAttemptRecord
    | ItemRecipientFinalPutAttemptRecord
    | ItemRecipientFinalPutPermissionObservation
    | ItemRecipientFinalPutVersionContext
    | ItemStagingPutPermissionObservation
    | ItemStagingPutVersionContext
    | SourceWindowAssessment
    | ItemSourceDelegationBoundReceipt
    | null
  > {
    let session: ClientSession | undefined,
      failure: Error | undefined,
      result!:
        | ItemCaptureAdmission
        | ItemCopyPreparationInspection
        | ItemHistoricalCopyPreparationReceipt
        | ItemCopyIntentContext
        | ItemHistoricalSourceAnchorMaterial
        | ItemSourceRetentionReceipt
        | ItemSourceProfileObservationReceipt
        | ItemManifestPage
        | ItemRecipientFinalCoveragePage
        | ItemRecipientFinalMediaRegistration
        | ItemManifestPreparationReceipt
        | ItemStagingCopyPreparationReceipt
        | ItemCopyGateRecord
        | ItemCopyRecordReceipt
        | ItemHistoricalPutAttemptV2Record
        | ItemHistoricalPutDestinationProtectionReceipt
        | ItemHistoricalPutPermissionObservation
        | ItemHistoricalPutVersionContext
        | ItemStagingPutAttemptRecord
        | ItemRecipientFinalPutAttemptRecord
        | ItemRecipientFinalPutPermissionObservation
        | ItemRecipientFinalPutVersionContext
        | ItemStagingPutPermissionObservation
        | ItemStagingPutVersionContext
        | SourceWindowAssessment
        | ItemSourceDelegationBoundReceipt
        | null;
    const copy =
      typeof admit === 'object' && 'copy' in admit ? admit.copy : undefined;
    const sourceWindow =
      copy?.mode === 'ASSESS_SOURCE_WINDOW' ? copy.input : undefined;
    const put = copy?.mode === 'DECLARE_PUT' ? copy.input : undefined;
    const destination =
      copy?.mode === 'DESTINATION_PROTECTION' ? copy : undefined;
    const permissionPins =
      copy?.mode === 'RECORD_PUT_PERMISSION' ? copy.input : undefined;
    const readPut =
      copy?.mode === 'READ_PUT_V2'
        ? copy.input
        : (destination?.input ?? permissionPins);
    const putStaging =
      copy?.mode === 'PREPARE_PUT_STAGING' ? copy.input : undefined;
    const putFinal =
      copy?.mode === 'PREPARE_PUT_FINAL' ? copy.input : undefined;
    const finalPut =
      copy?.mode === 'DECLARE_FINAL_PUT' ||
      copy?.mode === 'READ_FINAL_PUT' ||
      copy?.mode === 'RECORD_FINAL_PUT_PERMISSION'
        ? copy
        : undefined;
    const stagingPut =
      copy?.mode === 'DECLARE_STAGING_PUT' ||
      copy?.mode === 'READ_STAGING_PUT' ||
      copy?.mode === 'RECORD_STAGING_PUT_PERMISSION'
        ? copy
        : undefined;
    const anchor = (
      sourceWindow ??
      put ??
      readPut ??
      putStaging ??
      putFinal ??
      finalPut?.input ??
      stagingPut?.input
    )?.anchor;
    const preparation =
      copy?.mode === 'DECLARE' || copy?.mode === 'SOURCE_BOUND'
        ? copy.input.preparation
        : (anchor?.preparation ??
          (typeof admit === 'object' && 'historical' in admit
            ? admit.historical
            : undefined));
    const coverage =
      typeof admit === 'object' && 'coverage' in admit
        ? admit.coverage
        : undefined;
    const recipientRegistry =
      typeof admit === 'object' && 'coverage' in admit
        ? admit.recipientRegistry
        : undefined;
    const registration =
      typeof admit === 'object' && 'registration' in admit
        ? admit.registration
        : undefined;
    const manifest: ItemManifestReadInput | undefined = coverage
      ? this.coverageManifestInput(coverage)
      : typeof admit === 'object' && 'manifest' in admit
        ? admit.manifest
        : undefined;
    const digestPreparation =
      typeof admit === 'object' && 'digest' in admit ? admit : undefined;
    const expectedManifestHash =
      registration?.expectedManifestHash ??
      coverage?.expectedManifestHash ??
      anchor?.expectedManifestHash ??
      (typeof admit === 'object' && 'historical' in admit
        ? admit.expectedManifestHash
        : undefined);
    const retentionPreparation =
      typeof admit === 'object' && 'historical' in admit
        ? admit.sourceRetention
        : undefined;
    const profilePreparation =
      typeof admit === 'object' && 'historical' in admit
        ? admit.sourceProfile
        : undefined;
    const entryModels =
      (!!manifest && !coverage) || !!digestPreparation || !!registration;
    const fileModels =
      !!preparation || !!manifest || !!digestPreparation || !!registration;
    const copyModels = !!copy || !!coverage || !!registration;
    const registrationModels = !!registration || !!recipientRegistry;
    const stagingBytes =
      typeof admit === 'object' && 'historical' in admit
        ? admit.stagingBytes
        : undefined;
    const readStaging =
      typeof admit === 'object' &&
      'historical' in admit &&
      admit.readOnly === 'STAGING';
    try {
      const connection = this.requests.db,
        db = connection.db;
      const models = [
        this.items,
        this.claims,
        this.archives,
        this.controls,
        this.periods,
        ...(fileModels ? [this.files] : []),
        ...(entryModels ? [this.entries] : []),
        ...(copyModels ? [this.copyRecords] : []),
        ...(registrationModels ? [this.registrations] : []),
      ];
      if (
        !db ||
        connection.readyState !== STATES.connected ||
        models.some((m) => !m || m.db !== connection)
      )
        throw this.unavailable();
      const hello = (await db
        .admin()
        .command(
          { hello: 1 },
          { readPreference: 'primary', timeoutMS: 5000 },
        )) as {
        setName?: unknown;
        isWritablePrimary?: unknown;
        logicalSessionTimeoutMinutes?: unknown;
        msg?: unknown;
      };
      if (
        typeof hello.setName !== 'string' ||
        !hello.setName ||
        hello.isWritablePrimary !== true ||
        hello.msg !== undefined ||
        typeof hello.logicalSessionTimeoutMinutes !== 'number' ||
        !Number.isFinite(hello.logicalSessionTimeoutMinutes) ||
        hello.logicalSessionTimeoutMinutes <= 0
      )
        throw this.unavailable();
      const names = [
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animal_ownership_archives',
        'animal_ownership_controls',
        'animal_ownership_periods',
        ...(fileModels ? ['animal_ownership_archive_files'] : []),
        ...(entryModels ? ['animal_ownership_archive_entries'] : []),
        ...(copyModels ? [ITEM_COPY_RECORD_COLLECTION] : []),
        ...(registrationModels
          ? [OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_COLLECTION]
          : []),
      ];
      const listed = await db
        .listCollections(
          { name: { $in: names } },
          { nameOnly: false, readPreference: 'primary', maxTimeMS: 5000 },
        )
        .toArray();
      if (
        names.some(
          (name) =>
            !listed.some(
              (c) =>
                c.name === name &&
                c.type === 'collection' &&
                c.options?.capped !== true &&
                !c.options?.timeseries,
            ),
        )
      )
        throw this.unavailable();
      const required: Array<{
        name: string;
        key: Record<string, number>;
        partial?: Record<string, string>;
        unique?: boolean;
      }> = [
        ...(registrationModels
          ? [
              {
                name: OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_COLLECTION,
                key: { id: 1 },
              },
              {
                name: OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_COLLECTION,
                key: { key: 1 },
              },
              {
                name: OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_COLLECTION,
                key: { archiveId: 1, fileId: 1 },
              },
            ]
          : []),
        ...(copyModels
          ? [
              { name: ITEM_COPY_RECORD_COLLECTION, key: { id: 1 } },
              { name: ITEM_COPY_RECORD_COLLECTION, key: { identityIds: 1 } },
              {
                name: ITEM_COPY_RECORD_COLLECTION,
                key: { copyIntentId: 1, ordinal: 1 },
                partial: { row: 'ATTEMPT' },
              },
              {
                name: ITEM_COPY_RECORD_COLLECTION,
                key: { gateId: 1, row: 1, id: 1 },
                unique: false,
              },
            ]
          : []),
        { name: 'animal_ownership_controls', key: { animalId: 1 } },
        { name: 'animal_ownership_periods', key: { id: 1 } },
        {
          name: 'animal_ownership_periods',
          key: { animalId: 1 },
          partial: { status: 'ACTIVE' },
        },
        { name: 'animal_ownership_archives', key: { id: 1 } },
        ...(fileModels
          ? [
              { name: 'animal_ownership_archive_files', key: { id: 1 } },
              {
                name: 'animal_ownership_archive_files',
                key: { archiveId: 1, sourceKey: 1 },
              },
            ]
          : []),
        ...(entryModels
          ? [
              { name: 'animal_ownership_archive_entries', key: { id: 1 } },
              {
                name: 'animal_ownership_archive_entries',
                key: { archiveId: 1, kind: 1, resourceId: 1 },
              },
              {
                name: 'animal_ownership_archive_entries',
                key: { archiveId: 1, id: 1 },
                unique: false,
              },
            ]
          : []),
      ];
      for (const name of names) {
        const indexes = (await db
          .collection(name)
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
                    (r.unique === false
                      ? i.unique !== true
                      : i.unique === true) &&
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
      session = await connection.startSession();
      const active = session;
      result = await active.withTransaction(
        async () => {
          const { selected, snapshot, assessment } =
            await this.readCaptureSnapshot(
              input,
              active,
              !!digestPreparation || expectedManifestHash !== undefined,
            );
          const { archive } = snapshot;
          if (admit === 'inspect')
            return inspectItemCopyPreparation(input, snapshot);
          let gate: ItemCopyGateRecord | undefined;
          let priorGate: ItemCopyGateRecord | undefined;
          let attempt:
            | ItemCopyAttemptRecord
            | ItemHistoricalPutAttemptRecord
            | ItemHistoricalPutAttemptV2Record
            | ItemStagingPutAttemptRecord
            | ItemRecipientFinalPutAttemptRecord
            | undefined;
          let stagingPutVersion: ItemHistoricalPutVersionRecord | undefined;
          let finalPutVersion: ItemStagingPutVersionRecord | undefined;
          let finalPermissionContext:
            | {
                attempt: ItemRecipientFinalPutAttemptRecord;
                original: ItemStagingPutVersionContext;
              }
            | undefined;
          let stagingPermissionContext:
            | {
                attempt: ItemStagingPutAttemptRecord;
                original: ItemHistoricalPutVersionContext;
              }
            | undefined;
          let putContext:
            | {
                context: ItemCopyIntentContext;
                material: ItemHistoricalSourceAnchorMaterial;
              }
            | undefined;
          let boundWrite:
            | {
                attempt: ItemCopyAttemptRecord;
                bound: ItemSourceDelegationBound;
              }
            | undefined;
          let copyReplayed = false;
          let permissionAttempt: ItemHistoricalPutAttemptV2Record | undefined;
          let protectionWrite:
            | {
                attempt: ItemHistoricalPutAttemptV2Record;
                protection: ItemHistoricalPutDestinationProtection;
                separateControlsHash?: string;
              }
            | undefined;
          if (copy) {
            const definition = buildItemCopyGate(input, snapshot);
            const rawGate = await this.copyRecords!.findOne({
              id: definition.id,
            })
              .select({ _id: 0 })
              .session(active)
              .lean()
              .exec();
            if (rawGate)
              priorGate = captureItemCopyGate(
                rawGate as ItemCopyGateRecord,
                definition,
              );
            if (copy.mode === 'READ') return priorGate ?? null;
            if (
              copy.mode === 'READ_FINAL_PUT_PERMISSION' ||
              copy.mode === 'RECORD_FINAL_PUT_TRANSPORT_OBSERVATION' ||
              copy.mode === 'READ_FINAL_PUT_RECONCILIATION' ||
              copy.mode === 'RECORD_FINAL_PUT_VERSION'
            ) {
              if (!priorGate)
                throw new ConflictError('The original copy gate is absent');
              return this.recipientFinalPutPermissionObservation(
                copy,
                priorGate,
                active,
              );
            }
            if (
              copy.mode === 'READ_STAGING_PUT_PERMISSION' ||
              copy.mode === 'RECORD_STAGING_PUT_TRANSPORT_OBSERVATION' ||
              copy.mode === 'READ_STAGING_PUT_RECONCILIATION' ||
              copy.mode === 'RECORD_STAGING_PUT_VERSION'
            ) {
              if (!priorGate)
                throw new ConflictError('The original copy gate is absent');
              return this.stagingPutPermissionObservation(
                copy,
                priorGate,
                active,
              );
            }
            if (
              copy.mode === 'READ_PUT_PERMISSION' ||
              copy.mode === 'READ_PUT_RECONCILIATION' ||
              copy.mode === 'RECORD_PUT_VERSION' ||
              copy.mode === 'RECORD_PUT_TRANSPORT_OBSERVATION'
            ) {
              if (!priorGate)
                throw new ConflictError('The original copy gate is absent');
              return this.historicalPutPermissionObservation(
                copy,
                priorGate,
                active,
              );
            }
            if (copy.mode !== 'REVOKE' && archive!.state !== 'COPYING')
              throw new ConflictError(
                'Copy declarations require the original copying archive',
              );
            if (copy.mode === 'OPEN') {
              if (priorGate?.state === 'REVOKED')
                throw new ConflictError('The item copy gate is revoked');
              gate = priorGate
                ? Object.freeze({
                    ...priorGate,
                    revision: nextCopyGateRevision(priorGate.revision),
                  })
                : newItemCopyGate(definition);
              copyReplayed = !!priorGate;
            } else if (copy.mode === 'REVOKE') {
              const expected = copy.input.expectedGateRevision;
              if (
                priorGate
                  ? expected !== priorGate.revision
                  : expected !== undefined
              )
                throw new ConflictError(
                  'The expected copy gate revision changed',
                );
              const revocation = {
                requestId: copy.input.requestId,
                evidenceRef: copy.input.evidenceRef,
              };
              if (priorGate?.state === 'REVOKED') {
                if (
                  archiveHash(priorGate.revocation) !== archiveHash(revocation)
                )
                  throw new ConflictError(
                    'The original copy gate revocation cannot be replaced',
                  );
                copyReplayed = true;
              } else if (
                await this.copyRecords!.exists({
                  identityIds: revocation.requestId,
                })
                  .session(active)
                  .exec()
              )
                throw new ConflictError(
                  'The copy record identity has already been used',
                );
              gate = Object.freeze({
                ...newItemCopyGate(definition, revocation),
                revision: priorGate
                  ? nextCopyGateRevision(priorGate.revision)
                  : 0,
              });
            } else if (
              copy.mode === 'PREPARE_PUT_STAGING' ||
              copy.mode === 'PREPARE_PUT_FINAL'
            ) {
              if (!priorGate)
                throw new ConflictError('The original copy gate is absent');
            } else {
              if (!priorGate || priorGate.state !== 'OPEN')
                throw new ConflictError(
                  'An original open copy gate is required',
                );
              if (priorGate.revision !== copy.input.expectedGateRevision)
                throw new ConflictError(
                  'The expected copy gate revision changed',
                );
              if (copy.mode === 'DECLARE' || copy.mode === 'DECLARE_PUT')
                gate = Object.freeze({
                  ...priorGate,
                  revision: nextCopyGateRevision(priorGate.revision),
                });
            }
          }
          let preparedManifest: ItemManifestDigestResult | undefined;
          let manifestReplayed = false;
          if (digestPreparation) {
            const inspection = inspectItemCopyPreparation(input, snapshot);
            if (
              inspection.observedSealHash !==
              digestPreparation.digest.expectedSealHash
            )
              throw new ConflictError(
                'The expected manifest capture seal changed',
              );
            if (archive!.manifestDigest !== undefined) {
              preparedManifest = matchItemManifestDigest(
                digestPreparation.digest,
                snapshot,
                archive!.manifestDigest,
              );
              manifestReplayed = true;
            }
            if (digestPreparation.observed !== undefined) {
              const observed = matchItemManifestDigest(
                digestPreparation.digest,
                snapshot,
                digestPreparation.observed,
              );
              if (
                preparedManifest &&
                archiveHash(preparedManifest) !== archiveHash(observed)
              )
                throw new ConflictError(
                  'The observed manifest digest cannot be replaced',
                );
              preparedManifest = observed;
            }
            if (!preparedManifest) return null; // Empty probe is read-only, without a fence.
          }
          if (manifest) {
            const page = await this.readManifestPageInSnapshot(
              manifest,
              snapshot,
              !!coverage,
              active,
            );
            if (coverage && page.phase === 'FILES')
              return this.observeRecipientFinalCoveragePage(
                coverage,
                snapshot,
                page.rows,
                recipientRegistry,
                active,
              );
            return page;
          }
          let prepared: ItemArchiveCopyIntent | undefined;
          const finalMedia = registration
            ? await this.prepareRecipientFinalMediaRegistration(
                registration,
                snapshot,
                active,
              )
            : undefined;
          let replayed = false;
          let staging:
            | ReturnType<typeof buildStagingCopyPreparation>
            | undefined;
          let stagingReplayed = false;
          let stagingVersion:
            | ReturnType<typeof buildStagingFromHistoricalPutVersion>
            | undefined;
          let finalVersion:
            | ReturnType<typeof buildFinalFromStagingPutVersion>
            | undefined;
          let finalReplayed = false;
          let sourceObservation: ItemSourceByteObservation | undefined;
          let sourceReplayed = false;
          let retentionObservation: ItemSourceRetentionObservation | undefined;
          let profileSet: ItemSourceProfileObservationSet | undefined;
          let stagingObservation: ItemStagingByteObservation | undefined;
          let stagingObservedIntent: ItemArchiveCopyIntent | undefined;
          let stagingObservationReplayed = false;
          if (preparation) {
            const file = await this.files
              .findOne({ id: preparation.fileId, archiveId: archive!.id })
              .select({
                _id: 0,
                id: 1,
                archiveId: 1,
                sourceKey: 1,
                relativeKey: 1,
                historicalKey: 1,
                recipientStagingKey: 1,
                recipientFinalKey: 1,
                source: 1,
                definitionHash: 1,
                state: 1,
                leaseToken: 1,
                leaseUntil: 1,
                verified: 1,
                materialization: 1,
                retained: 1,
                historicalCopyIntent: 1,
                sourceByteObservation: 1,
                ...(retentionPreparation
                  ? { sourceRetentionObservation: 1 }
                  : {}),
                ...(profilePreparation || sourceWindow
                  ? { sourceProfileObservationSet: 1 }
                  : {}),
                historicalByteObservation: 1,
                stagingCopyIntent: 1,
                stagingByteObservation: 1,
                ...(putFinal || finalPut
                  ? { recipientFinalCopyIntent: 1 }
                  : {}),
              })
              .session(active)
              .lean()
              .exec();
            if (
              !file ||
              archive!.state !== 'COPYING' ||
              file.state !== 'PENDING' ||
              file.leaseToken !== undefined ||
              file.leaseUntil !== undefined ||
              file.verified !== undefined ||
              file.materialization !== undefined ||
              file.definitionHash !== preparation.expectedFileDefinitionHash
            )
              throw new ConflictError(
                'Historical copy preparation requires a matching pending manifest file without a work lease or copy receipts',
              );
            const context: ItemCopyIntentContext = {
              selector: input,
              snapshot,
              file,
              bucket: preparation.bucket,
              sourceSha256: preparation.sourceSha256,
            };
            if (copy?.mode === 'DECLARE') {
              attempt = newItemCopyAttempt(context, copy.input, gate!.id);
              copyReplayed = await this.checkInitialCopyAttempt(
                attempt,
                active,
                priorGate!,
              );
            }
            prepared = buildItemHistoricalCopyIntent(context);
            if (
              prepared.binding.observedSealHash !== preparation.expectedSealHash
            )
              throw new ConflictError('The expected capture seal changed');
            if (file.historicalCopyIntent !== undefined) {
              if (
                archiveHash(file.historicalCopyIntent) !== archiveHash(prepared)
              )
                throw new ConflictError(
                  'The historical copy intent cannot be replaced',
                );
              replayed = true;
            }
            if (file.sourceByteObservation !== undefined) {
              sourceObservation = matchSourceByteObservation(
                context,
                file.sourceByteObservation,
              );
              sourceReplayed = true;
            }
            const hasObservation = file.historicalByteObservation !== undefined;
            const hasStaging = file.stagingCopyIntent !== undefined;
            const hasVersion =
              file.stagingCopyIntent?.predecessor?.historicalPutVersion !==
              undefined;
            if (
              (hasObservation && hasVersion) ||
              (hasObservation || hasVersion) !== hasStaging ||
              (hasStaging && !replayed)
            )
              throw new ConflictError(
                'The historical observation and staging intent must form one complete preparation',
              );
            if (
              file.stagingByteObservation !== undefined ||
              stagingBytes ||
              readStaging
            ) {
              stagingObservedIntent = persistedItemStagingIntent(context);
              if (file.stagingByteObservation !== undefined) {
                stagingObservation = matchStagingByteObservation(
                  context,
                  file.stagingByteObservation,
                );
                stagingObservationReplayed = true;
              }
              if (stagingBytes?.observation !== undefined) {
                const observed = matchStagingByteObservation(
                  context,
                  stagingBytes.observation,
                );
                if (
                  stagingObservation &&
                  archiveHash(stagingObservation) !== archiveHash(observed)
                )
                  throw new ConflictError(
                    'The staging byte observation cannot be replaced',
                  );
                stagingObservation = observed;
              }
            }
            if (
              typeof admit === 'object' &&
              'historical' in admit &&
              admit.readOnly
            ) {
              if (!replayed)
                throw new ConflictError(
                  'A persisted historical copy intent is required for observation',
                );
              return Object.freeze(context);
            }
            if (copy?.mode === 'SOURCE_BOUND') {
              const { input: pins, bound: proposed } = copy;
              const { attempt: original, bound: stored } =
                await this.readHistoricalAttempt(
                  pins,
                  context,
                  priorGate!.id,
                  active,
                );
              const match = (bound: ItemSourceDelegationBound) =>
                matchItemSourceDelegationBound(
                  bound,
                  original.definition,
                  pins.signerContextHash,
                  bound.boundHash,
                );
              const observed = proposed && match(proposed);
              if (stored) {
                const existing = match(stored);
                if (observed && observed.boundHash !== existing.boundHash)
                  throw new ConflictError(
                    'The original source delegation bound cannot be replaced',
                  );
                return this.sourceBoundReceipt(
                  existing,
                  priorGate!.revision,
                  true,
                );
              }
              if (!observed) return null;
              boundWrite = { attempt: original, bound: observed };
              gate = Object.freeze({
                ...priorGate!,
                revision: nextCopyGateRevision(priorGate!.revision),
              });
            }
            if (expectedManifestHash !== undefined) {
              if (!sourceObservation || archive!.manifestDigest === undefined)
                throw new ConflictError(
                  'The historical source anchor requires a persisted manifest and source byte observation',
                );
              const persisted = matchItemManifestDigest(
                {
                  selector: input,
                  expectedSealHash: preparation.expectedSealHash,
                },
                snapshot,
                archive!.manifestDigest,
              );
              if (persisted.manifestHash !== expectedManifestHash)
                throw new ConflictError(
                  'The persisted manifest hash changed before anchoring the source',
                );
              const material = Object.freeze({
                binding: prepared.binding,
                manifestHash: persisted.manifestHash,
                intentId: prepared.id,
                intentDefinitionHash: prepared.definitionHash,
                sourceObservationHash: sourceObservation.observationHash,
                source: Object.freeze({
                  bucket: prepared.bucket,
                  ...prepared.source,
                }),
              });
              if (stagingPut) {
                const original = await this.readStagingHistoricalPut(
                  stagingPut.input.source,
                  input,
                  priorGate!,
                  active,
                );
                const { record, replayed: exists } =
                  await this.loadStagingPutRecord(
                    stagingPut,
                    context,
                    material.manifestHash,
                    original,
                    priorGate!,
                    active,
                  );
                if (!original.versionRecord) throw this.unavailable();
                if (stagingPut.mode === 'RECORD_STAGING_PUT_PERMISSION') {
                  if (!exists || record.permission)
                    throw new ConflictError(
                      'The staging PUT requires an original attempt without a permission',
                    );
                  stagingPermissionContext = { attempt: record, original };
                } else if (exists) {
                  await this.checkVersionedPutControls(
                    stagingPut.input,
                    original.versionRecord,
                    active,
                    false,
                  );
                  return stagingPut.mode === 'READ_STAGING_PUT'
                    ? record
                    : this.copyRecordReceipt(priorGate!, true, record);
                }
                if (!exists) attempt = record;
                stagingPutVersion = original.versionRecord;
                gate = Object.freeze({
                  ...priorGate!,
                  revision: nextCopyGateRevision(priorGate!.revision),
                });
              }
              if (putStaging) {
                if (!replayed || hasObservation)
                  throw new ConflictError(
                    'Staging requires the original PUT V2 predecessor',
                  );
                const { source } = putStaging;
                const original = await this.readStagingHistoricalPut(
                  source,
                  input,
                  priorGate!,
                  active,
                );
                stagingVersion = buildStagingFromHistoricalPutVersion(
                  context,
                  prepared,
                  material.manifestHash,
                  original,
                  source,
                );
                if (hasStaging) {
                  const existing = persistedItemStagingIntent(context);
                  if (
                    archiveHash(existing) !== archiveHash(stagingVersion.intent)
                  )
                    throw new ConflictError(
                      'The original staging intent cannot be replaced',
                    );
                  stagingReplayed = true;
                }
              }
              if (finalPut) {
                const original = await this.readFinalStagingPut(
                  finalPut.input.source,
                  input,
                  priorGate!,
                  active,
                );
                const {
                  record,
                  replayed: exists,
                  versionRecord,
                } = await this.loadRecipientFinalPutRecord(
                  finalPut,
                  context,
                  material.manifestHash,
                  original,
                  priorGate!,
                  active,
                );
                if (finalPut.mode === 'RECORD_FINAL_PUT_PERMISSION') {
                  if (!exists || record.permission)
                    throw new ConflictError(
                      'The final PUT requires an original attempt without a permission',
                    );
                  finalPermissionContext = { attempt: record, original };
                } else if (exists) {
                  await this.checkVersionedPutControls(
                    finalPut.input,
                    versionRecord,
                    active,
                    false,
                  );
                  return finalPut.mode === 'READ_FINAL_PUT'
                    ? record
                    : this.copyRecordReceipt(priorGate!, true, record);
                }
                if (!exists) attempt = record;
                finalPutVersion = versionRecord;
                gate = Object.freeze({
                  ...priorGate!,
                  revision: nextCopyGateRevision(priorGate!.revision),
                });
              }
              if (putFinal) {
                const { source } = putFinal;
                const original = await this.readFinalStagingPut(
                  source,
                  input,
                  priorGate!,
                  active,
                );
                finalVersion = buildFinalFromStagingPutVersion(
                  context,
                  material.manifestHash,
                  original,
                  source,
                );
                if (file.recipientFinalCopyIntent !== undefined) {
                  if (
                    archiveHash(file.recipientFinalCopyIntent) !==
                    archiveHash(finalVersion.intent)
                  )
                    throw new ConflictError(
                      'The original recipient final copy intent cannot be replaced',
                    );
                  finalReplayed = true;
                }
              }
              if (sourceWindow)
                return this.evaluatePersistedSourceWindow(
                  sourceWindow,
                  context,
                  material,
                  priorGate!.id,
                  active,
                );
              if (readPut) {
                const { record, stored, sourceControlsHash } =
                  await this.readPersistedHistoricalPutV2(
                    readPut,
                    context,
                    material,
                    priorGate!,
                    active,
                  );
                const { destinationProtection } = stored;
                if (permissionPins) {
                  if (
                    stored.permission ||
                    destinationProtection?.protectionHash !==
                      permissionPins.expectedProtectionHash ||
                    destinationProtection.controlsHash !==
                      permissionPins.expectedControlsHash
                  )
                    throw new ConflictError(
                      'An unpermitted PUT V2 with the expected destination protection is required',
                    );
                  permissionAttempt = stored;
                  gate = Object.freeze({
                    ...priorGate!,
                    revision: nextCopyGateRevision(priorGate!.revision),
                  });
                } else if (destination) {
                  const { expectedControlsHash, expectedProtectionHash } =
                    destination.input;
                  const match = (
                    evidence: ItemHistoricalPutDestinationProtection,
                  ) => {
                    const protection =
                      matchItemHistoricalPutDestinationProtection(
                        record.definition,
                        evidence,
                        expectedProtectionHash,
                      );
                    if (protection.controlsHash !== expectedControlsHash)
                      throw new ConflictError(
                        'The expected destination controls changed',
                      );
                    return protection;
                  };
                  const proposed =
                    destination.protection && match(destination.protection);
                  const separateControlsHash =
                    sourceControlsHash === expectedControlsHash
                      ? undefined
                      : expectedControlsHash;
                  if (separateControlsHash) {
                    const profiles = this.sourceProfileConfirmation!.profiles;
                    if (!profiles.assertActiveSharedControls)
                      throw this.unavailable();
                    await profiles.assertActiveSharedControls(
                      separateControlsHash,
                      active,
                    );
                  }
                  if (destinationProtection)
                    return Object.freeze({
                      protection: match(destinationProtection),
                      gateRevision: priorGate!.revision,
                      replayed: true,
                    });
                  if (!proposed) return null;
                  protectionWrite = {
                    attempt: record,
                    protection: proposed,
                    separateControlsHash,
                  };
                  gate = Object.freeze({
                    ...priorGate!,
                    revision: nextCopyGateRevision(priorGate!.revision),
                  });
                } else return record;
              }
              if (profilePreparation) {
                const { expectedBucketOwner, expectedProfile, observation } =
                  profilePreparation;
                const match = (set: ItemSourceProfileObservationSet) =>
                  matchItemSourceProfileObservationSet(
                    set,
                    material,
                    expectedBucketOwner,
                    expectedProfile,
                  );
                profileSet = observation && match(observation);
                if (file.sourceProfileObservationSet !== undefined) {
                  const existing = match(file.sourceProfileObservationSet);
                  if (
                    profileSet &&
                    existing.profileObservation.observationHash !==
                      profileSet.profileObservation.observationHash
                  )
                    throw new ConflictError(
                      'The source profile observation set cannot be replaced',
                    );
                  return Object.freeze({
                    observation: existing,
                    replayed: true,
                  });
                }
                if (!profileSet) return null;
                if (!this.sourceProfileConfirmation) throw this.unavailable();
              } else if (retentionPreparation) {
                const { expectedBucketOwner, observation } =
                  retentionPreparation;
                const observed =
                  observation === undefined
                    ? undefined
                    : matchItemSourceRetentionObservation(
                        observation,
                        material,
                        expectedBucketOwner,
                      );
                if (file.sourceRetentionObservation !== undefined) {
                  const existing = matchItemSourceRetentionObservation(
                    file.sourceRetentionObservation,
                    material,
                    expectedBucketOwner,
                  );
                  if (
                    observed &&
                    existing.observationHash !== observed.observationHash
                  )
                    throw new ConflictError(
                      'The source retention observation cannot be replaced',
                    );
                  return Object.freeze({
                    observation: existing,
                    replayed: true,
                  });
                }
                if (!observed) return null;
                retentionObservation = observed;
              } else if (put) putContext = { context, material };
              else if (
                !protectionWrite &&
                !permissionAttempt &&
                !stagingVersion &&
                !stagingPutVersion
              )
                return material;
            }
            if (stagingBytes && !stagingObservation) return null;
            if (
              typeof admit === 'object' &&
              'historical' in admit &&
              admit.source
            ) {
              if (!replayed)
                throw new ConflictError(
                  'Source observation preparation requires the original persisted historical intent',
                );
              if (admit.source.observation !== undefined) {
                const observed = matchSourceByteObservation(
                  context,
                  admit.source.observation,
                );
                if (
                  sourceObservation &&
                  archiveHash(sourceObservation) !== archiveHash(observed)
                )
                  throw new ConflictError(
                    'The source observation cannot be replaced',
                  );
                sourceObservation = observed;
              }
              if (!sourceObservation) return null;
            }
            if (
              typeof admit === 'object' &&
              'historical' in admit &&
              admit.staging
            ) {
              if (!replayed)
                throw new ConflictError(
                  'Staging preparation requires the original persisted historical intent',
                );
              if (hasVersion)
                throw new ConflictError(
                  'The staging intent is linked to a historical PUT V2',
                );
              const observed =
                admit.staging.observation ?? file.historicalByteObservation;
              if (!hasObservation && observed === undefined) return null;
              staging = buildStagingCopyPreparation(context, observed!);
              if (hasObservation) {
                if (
                  archiveHash(file.historicalByteObservation) !==
                    archiveHash(staging.observation) ||
                  archiveHash(file.stagingCopyIntent) !==
                    archiveHash(staging.intent)
                )
                  throw new ConflictError(
                    'The historical observation or staging intent cannot be replaced',
                  );
                stagingReplayed = true;
              }
            }
          }
          if (
            !copy &&
            !preparation &&
            !preparedManifest &&
            !finalMedia &&
            (!admit || !assessment.needsWork)
          )
            return { progress: assessment.progress };
          await this.fenceItemCapture(input, snapshot, selected, active);
          if (finalMedia && registration) {
            const { record, version } = finalMedia;
            await this.fencePutVersionConservation(
              {
                conservationControlsHash:
                  version.evidence.conservationControlsHash,
                requiredThrough: registration.requiredThrough,
              },
              version,
              active,
            );
            await persistTransferredMediaRegistration(
              this.registrations!,
              record,
              active,
            );
            return record;
          }
          if (
            preparation &&
            prepared &&
            sourceObservation &&
            (retentionObservation || profileSet)
          ) {
            if (profileSet) {
              const { profiles, now } = this.sourceProfileConfirmation!;
              const { fixedSource, profileObservation } = profileSet;
              const observedAt = Date.parse(fixedSource.observedAt);
              await profiles.fenceActiveSourceProfile(
                profileObservation.profile,
                active,
                (profile) => {
                  const checkedAt = now().getTime();
                  if (
                    profile.selectorHash !== fixedSource.selectorHash ||
                    !(
                      checkedAt >= observedAt &&
                      checkedAt < Date.parse(fixedSource.fixedRetainUntil)
                    )
                  )
                    throw new ConflictError(
                      'The source profile selector or fixed retention date changed',
                    );
                  assertItemSourceProfileWindow(profile, observedAt);
                  assertItemSourceProfileWindow(profile, checkedAt);
                },
              );
            }
            const field = profileSet
              ? 'sourceProfileObservationSet'
              : 'sourceRetentionObservation';
            const observation = profileSet ?? retentionObservation!;
            this.changed(
              await this.files
                .updateOne(
                  {
                    id: preparation.fileId,
                    archiveId: archive!.id,
                    definitionHash: preparation.expectedFileDefinitionHash,
                    state: 'PENDING',
                    'historicalCopyIntent.definitionHash':
                      prepared.definitionHash,
                    'sourceByteObservation.observationHash':
                      sourceObservation.observationHash,
                    [field]: { $exists: false },
                    leaseToken: { $exists: false },
                    leaseUntil: { $exists: false },
                    verified: { $exists: false },
                    materialization: { $exists: false },
                  },
                  {
                    $set: { [field]: observation },
                  },
                  { session: active },
                )
                .exec(),
            );
            return profileSet
              ? Object.freeze({ observation: profileSet, replayed: false })
              : Object.freeze({
                  observation: retentionObservation!,
                  replayed: false,
                });
          }
          if (copy && gate) {
            if (stagingPutVersion && stagingPut)
              await this.checkVersionedPutControls(
                stagingPut.input,
                stagingPutVersion,
                active,
                true,
              );
            if (finalPutVersion && finalPut)
              await this.checkVersionedPutControls(
                finalPut.input,
                finalPutVersion,
                active,
                true,
              );
            if (destination && protectionWrite) {
              const profiles = this.sourceProfileConfirmation!.profiles;
              await profiles.fenceActiveSourceProfile(
                destination.input.expectedProfile,
                active,
              );
              if (protectionWrite.separateControlsHash) {
                if (!profiles.fenceActiveSharedControls)
                  throw this.unavailable();
                await profiles.fenceActiveSharedControls(
                  protectionWrite.separateControlsHash,
                  active,
                );
              }
            }
            if (put) {
              attempt = await this.prepareHistoricalPutRecord(
                put,
                putContext!,
                gate.id,
                active,
              );
              copyReplayed = await this.checkInitialCopyAttempt(
                attempt,
                active,
                priorGate!,
              );
            }
            const permission =
              permissionAttempt && permissionPins
                ? await this.prepareInitialHistoricalPutPermission(
                    permissionPins,
                    priorGate!,
                    permissionAttempt,
                    active,
                  )
                : undefined;
            const stagingPermission =
              stagingPut?.mode === 'RECORD_STAGING_PUT_PERMISSION' &&
              stagingPermissionContext
                ? await this.prepareInitialStagingPutPermission(
                    stagingPut.input,
                    priorGate!,
                    stagingPermissionContext.attempt,
                    stagingPermissionContext.original,
                    active,
                  )
                : undefined;
            const finalPermission =
              finalPut?.mode === 'RECORD_FINAL_PUT_PERMISSION' &&
              finalPermissionContext
                ? await this.prepareInitialRecipientFinalPutPermission(
                    finalPut.input,
                    priorGate!,
                    finalPermissionContext.attempt,
                    finalPermissionContext.original,
                    active,
                  )
                : undefined;
            if (priorGate)
              this.changed(
                await this.copyRecords!.updateOne(
                  {
                    id: priorGate.id,
                    protocol: priorGate.protocol,
                    row: 'GATE',
                    definitionHash: priorGate.definitionHash,
                    state: priorGate.state,
                    revision: priorGate.revision,
                  },
                  {
                    $set: {
                      revision: gate.revision,
                      state: gate.state,
                      identityIds: gate.identityIds,
                      ...(gate.revocation
                        ? { revocation: gate.revocation }
                        : {}),
                    },
                  },
                  { session: active },
                ).exec(),
              );
            else await this.copyRecords!.create([gate], { session: active });
            if (permission && permissionAttempt) {
              await this.persistInitialPutPermission(
                permissionAttempt,
                permission,
                active,
              );
              return observeInitialHistoricalPutPermission(
                gate,
                permissionAttempt,
                permission,
                permission.authorizationId,
              );
            }
            if (stagingPermission && stagingPermissionContext) {
              const { attempt: original, original: historical } =
                stagingPermissionContext;
              await this.persistInitialPutPermission(
                original,
                stagingPermission,
                active,
              );
              return observeInitialStagingPutPermission(
                gate,
                original,
                historical,
                stagingPermission,
                stagingPermission.authorizationId,
              );
            }
            if (finalPermission && finalPermissionContext) {
              const { attempt: declaration, original } = finalPermissionContext;
              await this.persistInitialPutPermission(
                declaration,
                finalPermission,
                active,
              );
              return observeInitialRecipientFinalPutPermission(
                gate,
                declaration,
                original,
                finalPermission,
                finalPermission.authorizationId,
              );
            }
            if (protectionWrite) {
              const { attempt: original, protection } = protectionWrite;
              this.changed(
                await this.copyRecords!.updateOne(
                  {
                    id: original.id,
                    protocol: original.protocol,
                    row: original.row,
                    gateId: original.gateId,
                    copyIntentId: original.copyIntentId,
                    ordinal: original.ordinal,
                    state: original.state,
                    'definition.protocol': original.definition.protocol,
                    'definition.definitionHash':
                      original.definition.definitionHash,
                    destinationProtection: { $exists: false },
                  },
                  { $set: { destinationProtection: protection } },
                  { session: active },
                ).exec(),
              );
              return Object.freeze({
                protection,
                gateRevision: gate.revision,
                replayed: false,
              });
            }
            if (boundWrite) {
              const { attempt: original, bound } = boundWrite;
              this.changed(
                await this.copyRecords!.updateOne(
                  {
                    id: original.id,
                    protocol: original.protocol,
                    row: original.row,
                    gateId: original.gateId,
                    copyIntentId: original.copyIntentId,
                    ordinal: original.ordinal,
                    state: original.state,
                    'definition.definitionHash':
                      original.definition.definitionHash,
                    delegationBound: { $exists: false },
                  },
                  { $set: { delegationBound: bound } },
                  { session: active },
                ).exec(),
              );
              return this.sourceBoundReceipt(bound, gate.revision, false);
            }
            if (attempt && !copyReplayed)
              await this.copyRecords!.create([attempt], { session: active });
            return this.copyRecordReceipt(gate, copyReplayed, attempt);
          }
          if (digestPreparation && preparedManifest) {
            if (!manifestReplayed) {
              const seal = preparedManifest.binding.observedSeal;
              this.changed(
                await this.archives
                  .updateOne(
                    {
                      id: archive!.id,
                      definitionHash: seal.definitionHash,
                      state: archive!.state,
                      'reservation.bindingHash': seal.reservationBindingHash,
                      'reservation.epoch': seal.reservationEpoch,
                      'capture.phase': 'COMPLETE',
                      'capture.revision': seal.captureRevision,
                      'capture.entryCount': seal.expectedEntryCount,
                      expectedEntryCount: seal.expectedEntryCount,
                      expectedFileCount: seal.expectedFileCount,
                      manifestDigest: { $exists: false },
                      evidenceConsumption: { $exists: false },
                    },
                    { $set: { manifestDigest: preparedManifest } },
                    { session: active },
                  )
                  .exec(),
              );
            }
            return Object.freeze({
              transferId: input.transferId,
              itemId: input.itemId,
              archiveId: archive!.id,
              manifestHash: preparedManifest.manifestHash,
              entryCount: preparedManifest.entryCount,
              fileCount: preparedManifest.fileCount,
              replayed: manifestReplayed,
              reservation: 'FENCED_AT_PREPARATION' as const,
              provenance: 'NOT_ASSESSED' as const,
              stableCut: 'NOT_ASSESSED' as const,
              retention: 'NOT_ASSESSED' as const,
              copyDispatch: 'NOT_AUTHORIZED' as const,
              businessCommit: 'NOT_AUTHORIZED' as const,
            });
          }
          if (
            preparation &&
            stagingBytes &&
            stagingObservation &&
            stagingObservedIntent
          ) {
            if (!stagingObservationReplayed)
              this.changed(
                await this.files
                  .updateOne(
                    {
                      id: preparation.fileId,
                      archiveId: archive!.id,
                      definitionHash: preparation.expectedFileDefinitionHash,
                      state: 'PENDING',
                      'historicalCopyIntent.definitionHash':
                        prepared!.definitionHash,
                      'stagingCopyIntent.definitionHash':
                        stagingObservedIntent.definitionHash,
                      stagingByteObservation: { $exists: false },
                      leaseToken: { $exists: false },
                      leaseUntil: { $exists: false },
                      verified: { $exists: false },
                      materialization: { $exists: false },
                    },
                    { $set: { stagingByteObservation: stagingObservation } },
                    { session: active },
                  )
                  .exec(),
              );
            return Object.freeze({
              transferId: input.transferId,
              itemId: input.itemId,
              fileId: preparation.fileId,
              intentId: stagingObservedIntent.id,
              intentDefinitionHash: stagingObservedIntent.definitionHash,
              observationHash: stagingObservation.observationHash,
              replayed: stagingObservationReplayed,
              reservation: 'FENCED_AT_PREPARATION' as const,
              provenance: 'NOT_ASSESSED' as const,
              stableCut: 'NOT_ASSESSED' as const,
              retention: 'NOT_ASSESSED' as const,
              copyDispatch: 'NOT_AUTHORIZED' as const,
              businessCommit: 'NOT_AUTHORIZED' as const,
            });
          }
          if (
            preparation &&
            prepared &&
            sourceObservation &&
            typeof admit === 'object' &&
            'historical' in admit &&
            admit.source
          ) {
            if (!sourceReplayed)
              this.changed(
                await this.files
                  .updateOne(
                    {
                      id: preparation.fileId,
                      archiveId: archive!.id,
                      definitionHash: preparation.expectedFileDefinitionHash,
                      state: 'PENDING',
                      'historicalCopyIntent.definitionHash':
                        prepared.definitionHash,
                      sourceByteObservation: { $exists: false },
                      sourceRetentionObservation: { $exists: false },
                      sourceProfileObservationSet: { $exists: false },
                      leaseToken: { $exists: false },
                      leaseUntil: { $exists: false },
                      verified: { $exists: false },
                      materialization: { $exists: false },
                    },
                    { $set: { sourceByteObservation: sourceObservation } },
                    { session: active },
                  )
                  .exec(),
              );
            return Object.freeze({
              transferId: input.transferId,
              itemId: input.itemId,
              fileId: preparation.fileId,
              intentId: prepared.id,
              intentDefinitionHash: prepared.definitionHash,
              observationHash: sourceObservation.observationHash,
              replayed: sourceReplayed,
              reservation: 'FENCED_AT_PREPARATION' as const,
              provenance: 'NOT_ASSESSED' as const,
              stableCut: 'NOT_ASSESSED' as const,
              retention: 'NOT_ASSESSED' as const,
              copyDispatch: 'NOT_AUTHORIZED' as const,
              businessCommit: 'NOT_AUTHORIZED' as const,
            });
          }
          if (preparation && prepared && finalVersion && putFinal) {
            const { intent, versionRecord } = finalVersion;
            await this.fencePutVersionConservation(
              putFinal.source,
              versionRecord,
              active,
            );
            if (!finalReplayed)
              this.changed(
                await this.files
                  .updateOne(
                    {
                      id: preparation.fileId,
                      archiveId: archive!.id,
                      definitionHash: preparation.expectedFileDefinitionHash,
                      state: 'PENDING',
                      'historicalCopyIntent.definitionHash':
                        prepared.definitionHash,
                      'stagingCopyIntent.definitionHash':
                        intent.predecessor.intentDefinitionHash,
                      historicalByteObservation: { $exists: false },
                      recipientFinalCopyIntent: { $exists: false },
                      leaseToken: { $exists: false },
                      leaseUntil: { $exists: false },
                      verified: { $exists: false },
                      materialization: { $exists: false },
                    },
                    { $set: { recipientFinalCopyIntent: intent } },
                    { session: active },
                  )
                  .exec(),
              );
            return this.observedCopyPreparationReceipt(
              intent,
              versionRecord.observation.observationHash,
              finalReplayed,
            );
          }
          if (preparation && prepared && (staging || stagingVersion)) {
            if (stagingVersion && putStaging)
              await this.fencePutVersionConservation(
                putStaging.source,
                stagingVersion.versionRecord,
                active,
              );
            const intent = staging?.intent ?? stagingVersion!.intent;
            if (!stagingReplayed)
              this.changed(
                await this.files
                  .updateOne(
                    {
                      id: preparation.fileId,
                      archiveId: archive!.id,
                      definitionHash: preparation.expectedFileDefinitionHash,
                      state: 'PENDING',
                      'historicalCopyIntent.definitionHash':
                        prepared.definitionHash,
                      historicalByteObservation: { $exists: false },
                      stagingCopyIntent: { $exists: false },
                      stagingByteObservation: { $exists: false },
                      leaseToken: { $exists: false },
                      leaseUntil: { $exists: false },
                      verified: { $exists: false },
                      materialization: { $exists: false },
                    },
                    {
                      $set: {
                        ...(staging
                          ? { historicalByteObservation: staging.observation }
                          : {}),
                        stagingCopyIntent: intent,
                      },
                    },
                    { session: active },
                  )
                  .exec(),
              );
            return this.observedCopyPreparationReceipt(
              intent,
              intent.predecessor!.observationHash,
              stagingReplayed,
            );
          }
          if (preparation && prepared) {
            if (!replayed)
              this.changed(
                await this.files
                  .updateOne(
                    {
                      id: preparation.fileId,
                      archiveId: archive!.id,
                      definitionHash: preparation.expectedFileDefinitionHash,
                      state: 'PENDING',
                      historicalCopyIntent: { $exists: false },
                      sourceByteObservation: { $exists: false },
                      sourceRetentionObservation: { $exists: false },
                      sourceProfileObservationSet: { $exists: false },
                      historicalByteObservation: { $exists: false },
                      stagingCopyIntent: { $exists: false },
                      stagingByteObservation: { $exists: false },
                      leaseToken: { $exists: false },
                      leaseUntil: { $exists: false },
                      verified: { $exists: false },
                      materialization: { $exists: false },
                    },
                    { $set: { historicalCopyIntent: prepared } },
                    { session: active },
                  )
                  .exec(),
              );
            return Object.freeze({
              transferId: input.transferId,
              itemId: input.itemId,
              fileId: preparation.fileId,
              intentId: prepared.id,
              intentDefinitionHash: prepared.definitionHash,
              replayed,
              reservation: 'FENCED_AT_PREPARATION' as const,
              stableCut: 'NOT_ASSESSED' as const,
              retention: 'NOT_ASSESSED' as const,
              copyDispatch: 'NOT_AUTHORIZED' as const,
              businessCommit: 'NOT_AUTHORIZED' as const,
            });
          }
          return { scope: assessment.scope };
        },
        {
          readConcern: { level: 'snapshot' },
          readPreference: 'primary',
          writeConcern: { w: 'majority', wtimeoutMS: 10000 },
          timeoutMS: 15000,
          maxCommitTimeMS: 5000,
        },
      );
    } catch (error) {
      failure =
        error instanceof DomainError || error instanceof HttpException
          ? error
          : this.unavailable();
    } finally {
      try {
        await session?.endSession();
      } catch {
        failure ??= this.unavailable();
      }
    }
    if (failure) throw failure;
    return result;
  }
  private async fenceItemCapture(
    input: ItemCaptureInput,
    snapshot: ItemCaptureSnapshot,
    selected: ReturnType<typeof selectItemCapture>['selected'],
    active: ClientSession,
  ): Promise<void> {
    const { request, item, claim, archive } = snapshot;
    const acceptance = request!.acceptanceStart as AcceptanceStartBinding;
    const revisions = [
      request!.captureStepRevision,
      item!.captureStepRevision,
      claim!.captureStepRevision,
    ];
    const next = revisions.map(nextItemCaptureFence);
    const written = await this.requests
      .updateOne(
        {
          _id: input.transferId,
          status: 'PROCESSING',
          version: request!.version,
          recipientId: input.actorId,
          decisionOperationId: input.decisionOperationId,
          'acceptanceStart.bindingHash': acceptance.bindingHash,
          captureStepRevision: revisions[0] ?? { $exists: false },
        },
        { $set: { captureStepRevision: next[0] } },
        { session: active },
      )
      .exec();
    this.changed(written);
    this.changed(
      await this.items
        .updateOne(
          {
            _id: input.itemId,
            transferId: input.transferId,
            status: 'PROCESSING',
            captureArchiveId: selected.archiveId,
            captureReservationEpoch: selected.reservationEpoch,
            captureStepRevision: revisions[1] ?? { $exists: false },
          },
          { $set: { captureStepRevision: next[1] } },
          { session: active },
        )
        .exec(),
    );
    this.changed(
      await this.claims
        .updateOne(
          {
            _id: selected.animalId,
            transferId: input.transferId,
            acceptanceOperationId: input.decisionOperationId,
            captureStepRevision: revisions[2] ?? { $exists: false },
          },
          { $set: { captureStepRevision: next[2] } },
          { session: active },
        )
        .exec(),
    );
    await fenceArchiveReservation(
      archive!,
      this.controls,
      this.periods,
      active,
    );
  }

  private async readCaptureSnapshot(
    input: ItemCaptureInput,
    active: ClientSession,
    includeManifestDigest: boolean,
  ) {
    const { selected, snapshot } = await this.readItemDecisionSnapshot(
      input,
      active,
      includeManifestDigest,
    );
    const assessment = assessItemCapture(input, snapshot);
    const { archive } = snapshot;
    if (
      !(await this.periods
        .exists({
          id: archive!.periodId,
          animalId: archive!.animalId,
          ownerId: archive!.ownerId,
          ownershipVersion: 1,
          status: 'ACTIVE',
        })
        .session(active)
        .exec()) ||
      (await this.periods
        .exists({ animalId: archive!.animalId, status: 'CLOSED' })
        .session(active)
        .exec())
    )
      throw new ConflictError(
        'Item capture still requires its initial active period',
      );
    return { selected, snapshot, assessment };
  }

  private async readItemDecisionSnapshot(
    input: ItemCaptureInput,
    active: ClientSession,
    includeManifestDigest: boolean,
    includeHistory = false,
  ) {
    const request = await this.requests
      .findById(input.transferId)
      .select({
        _id: 1,
        senderId: 1,
        recipientId: 1,
        status: 1,
        version: 1,
        animalCount: 1,
        decidedAt: 1,
        decisionOperationId: 1,
        decisionExpectedVersion: 1,
        acceptanceStart: 1,
        acceptedItemCount: 1,
        captureStepRevision: 1,
      })
      .session(active)
      .lean()
      .exec();
    const { selected } = selectItemCapture(input, request); // Authorize before associated reads.
    const item = await this.items
      .findById(selected.itemId)
      .select({
        _id: 1,
        transferId: 1,
        animalId: 1,
        expectedOwnerId: 1,
        expectedOwnershipVersion: 1,
        status: 1,
        captureArchiveId: 1,
        captureReservationEpoch: 1,
        captureStepRevision: 1,
      })
      .session(active)
      .lean()
      .exec();
    const claim = await this.claims
      .findById(selected.animalId)
      .select({
        _id: 1,
        transferId: 1,
        acceptanceOperationId: 1,
        captureStepRevision: 1,
      })
      .session(active)
      .lean()
      .exec();
    const archive = await this.archives
      .findOne({ id: selected.archiveId })
      .select({
        _id: 0,
        id: 1,
        animalId: 1,
        ownerId: 1,
        recipientId: 1,
        periodId: 1,
        transferId: 1,
        ownershipVersion: 1,
        definitionHash: 1,
        reservation: 1,
        evidenceConsumption: 1,
        ...(includeManifestDigest ? { manifestDigest: 1 } : {}),
        ...(includeHistory ? { history: 1, ownershipCommitHash: 1 } : {}),
        state: 1,
        capture: 1,
        expectedEntryCount: 1,
        expectedFileCount: 1,
        createdAt: 1,
      })
      .session(active)
      .lean()
      .exec();
    const control = await this.controls
      .findOne({ animalId: selected.animalId })
      .select({
        _id: 0,
        animalId: 1,
        ownerId: 1,
        ownershipVersion: 1,
        reservationEpoch: 1,
        transferLock: 1,
        activeWrites: 1,
      })
      .session(active)
      .lean()
      .exec();
    const snapshot = {
      request,
      item,
      claim,
      archive,
      control,
    };
    return { selected, snapshot };
  }

  private async readManifestPageInSnapshot(
    manifest: ItemManifestReadInput,
    snapshot: ItemCaptureSnapshot,
    includeFinalVersions: boolean,
    active: ClientSession,
  ): Promise<ItemManifestPage> {
    const archive = snapshot.archive!;
    const inspection = inspectItemCopyPreparation(manifest.selector, snapshot);
    if (inspection.observedSealHash !== manifest.expectedSealHash)
      throw new ConflictError('The expected manifest capture seal changed');
    const { phase, afterId } = manifest.cursor;
    if (phase === 'COMPLETE') return Object.freeze({ phase, snapshot });
    const filter = {
      archiveId: archive.id,
      ...(afterId === undefined ? {} : { id: { $gt: afterId } }),
    };
    const rows =
      phase === 'ENTRIES'
        ? await this.entries
            .find(filter)
            .select({
              _id: 0,
              id: 1,
              archiveId: 1,
              kind: 1,
              resourceId: 1,
              payload: 1,
              fileBindings: 1,
              contentHash: 1,
              retained: 1,
            })
            .collation({ locale: 'simple' })
            .sort({ id: 1 })
            .limit(ITEM_MANIFEST_PAGE_SIZE)
            .setOptions({ singleBatch: true, maxTimeMS: 5000 })
            .session(active)
            .lean()
            .exec()
        : await this.files
            .find(filter)
            .select(
              includeFinalVersions
                ? finalVersionFileProjection
                : manifestFileProjection,
            )
            .collation({ locale: 'simple' })
            .sort({ id: 1 })
            .limit(ITEM_MANIFEST_PAGE_SIZE)
            .setOptions({ singleBatch: true, maxTimeMS: 5000 })
            .session(active)
            .lean()
            .exec();
    let previous = afterId ?? '';
    if (!Array.isArray(rows) || rows.length > ITEM_MANIFEST_PAGE_SIZE)
      throw new ConflictError('The manifest page exceeds its read boundary');
    for (const row of rows) {
      if (
        !row ||
        typeof row.id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.id) ||
        row.id <= previous ||
        row.archiveId !== archive.id
      )
        throw new ConflictError(
          'The manifest page identity or order is inconsistent',
        );
      previous = row.id;
    }
    return phase === 'ENTRIES'
      ? Object.freeze({ phase, snapshot, rows: rows as ArchiveEntry[] })
      : Object.freeze({ phase, snapshot, rows: rows as ArchiveFile[] });
  }

  private async readRecipientProjectionMediaPageInSnapshot(
    raw: ItemRecipientFinalCoveragePageInput,
    snapshot: ItemCaptureSnapshot,
    session: ClientSession,
    retained?: ItemStableCutRetainedVersions,
  ): Promise<ItemRecipientProjectionMediaPage> {
    const coverage = recipientFinalCoveragePageInput(raw);
    const page = await this.readManifestPageInSnapshot(
      this.coverageManifestInput(coverage),
      snapshot,
      true,
      session,
    );
    if (page.phase !== 'FILES') throw this.unavailable();
    return this.observeRecipientFinalCoveragePage(
      coverage,
      snapshot,
      page.rows,
      'PROJECTION',
      session,
      retained,
    );
  }

  private coverageManifestInput(
    coverage: ItemRecipientFinalCoveragePageInput,
  ): ItemManifestReadInput {
    return {
      selector: coverage.selector,
      expectedSealHash: coverage.expectedSealHash,
      cursor: {
        phase: 'FILES',
        afterId: coverage.afterId,
        limit: ITEM_MANIFEST_PAGE_SIZE,
      },
    };
  }

  private copyRecordReceipt(
    gate: ItemCopyGateRecord,
    replayed: boolean,
    attempt?: Extract<ItemCopyRecord, { row: 'ATTEMPT' }>,
  ): ItemCopyRecordReceipt {
    return Object.freeze({
      gateId: gate.id,
      gateRevision: gate.revision,
      state: gate.state,
      replayed,
      ...(attempt
        ? {
            attemptId: attempt.id,
            attemptDefinitionHash: attempt.definition.definitionHash,
          }
        : {}),
      reservation: 'FENCED_AT_PREPARATION' as const,
      stableCut: 'NOT_ASSESSED' as const,
      retention: 'NOT_ASSESSED' as const,
      copyDispatch: 'NOT_AUTHORIZED' as const,
      businessCommit: 'NOT_AUTHORIZED' as const,
    });
  }

  private observedCopyPreparationReceipt(
    intent: Pick<ItemArchiveCopyIntent, 'binding' | 'id' | 'definitionHash'>,
    observationHash: string,
    replayed: boolean,
  ): ItemObservedCopyPreparationReceipt {
    const { transferId, itemId, fileId } = intent.binding;
    return Object.freeze({
      transferId,
      itemId,
      fileId,
      intentId: intent.id,
      intentDefinitionHash: intent.definitionHash,
      observationHash,
      replayed,
      reservation: 'FENCED_AT_PREPARATION',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
  }

  private async fencePutVersionConservation(
    source: Pick<
      ItemPutVersionPreparationInput['source'],
      'conservationControlsHash' | 'requiredThrough'
    >,
    version:
      | ItemHistoricalPutVersionRecord
      | ItemStagingPutVersionRecord
      | ItemRecipientFinalPutVersionRecord,
    session: ClientSession,
  ) {
    const config = this.sourceProfileConfirmation;
    if (!config?.profiles.fenceActiveSharedControls) throw this.unavailable();
    await config.profiles.fenceActiveSharedControls(
      source.conservationControlsHash,
      session,
    );
    assertHistoricalPutVersionUsable(
      version,
      source.requiredThrough,
      config.now().getTime(),
    );
  }

  private observeRecipientFinalCoveragePage(
    input: ItemRecipientFinalCoveragePageInput,
    snapshot: ItemCaptureSnapshot,
    files: readonly ArchiveFile[],
    registry: 'PROJECTION',
    session: ClientSession,
    retained?: ItemStableCutRetainedVersions,
  ): Promise<ItemRecipientProjectionMediaPage>;
  private observeRecipientFinalCoveragePage(
    input: ItemRecipientFinalCoveragePageInput,
    snapshot: ItemCaptureSnapshot,
    files: readonly ArchiveFile[],
    registry: RecipientRegistryRead | undefined,
    session: ClientSession,
  ): Promise<
    ItemRecipientFinalCoveragePage | ItemRecipientPreparedCoveragePage
  >;
  private async observeRecipientFinalCoveragePage(
    input: ItemRecipientFinalCoveragePageInput,
    snapshot: ItemCaptureSnapshot,
    files: readonly ArchiveFile[],
    registry: RecipientRegistryRead | undefined,
    session: ClientSession,
    retained?: ItemStableCutRetainedVersions,
  ): Promise<
    | ItemRecipientFinalCoveragePage
    | ItemRecipientPreparedCoveragePage
    | ItemRecipientProjectionMediaPage
  > {
    const { manifest, matched, gate } = await this.readRecipientFinalVersions(
      input,
      snapshot,
      files,
      session,
    );
    const archive = snapshot.archive!;
    if (!matched.length) {
      if (registry) {
        const count = await this.registrations!.countDocuments({
          archiveId: archive.id,
        })
          .maxTimeMS(5000)
          .session(session)
          .exec();
        if (count !== manifest.fileCount)
          throw new ConflictError(
            'The archive must have exactly one prepared registration per sealed file',
          );
      }
      return Object.freeze({
        manifest,
        rows: Object.freeze([]),
        ...(registry === 'PROJECTION' ? { media: Object.freeze([]) } : {}),
      });
    }

    const config = this.sourceProfileConfirmation;
    if (!config?.profiles.assertActiveSharedControls) throw this.unavailable();
    const registrations = registry
      ? await this.readPreparedCoverageRegistrations(
          archive,
          manifest,
          matched,
          session,
        )
      : undefined;
    const generations = new Set(
      matched.map(
        ({ versionRecord }) => versionRecord.evidence.conservationControlsHash,
      ),
    );
    for (const generation of generations)
      await config.profiles.assertActiveSharedControls(generation, session);
    if (retained && gate)
      await this.appendStableCutRetainedVersions(
        input,
        matched,
        gate,
        retained,
        session,
      );
    const checkedAt = config.now().getTime();
    const rows = matched.map(
      ({
        file,
        definition,
        permission,
        versionRecord,
      }): ItemRecipientFinalCoverageFile => {
        assertHistoricalPutVersionUsable(
          versionRecord,
          input.requiredThrough,
          checkedAt,
        );
        return Object.freeze({
          fileId: file.id,
          fileDefinitionHash: file.definitionHash,
          intentDefinitionHash: definition.copyIntentDefinitionHash,
          attemptDefinitionHash: definition.definitionHash,
          permissionHash: permission.permissionHash,
          versionObservationHash: versionRecord.observation.observationHash,
          conservationControlsHash:
            versionRecord.evidence.conservationControlsHash,
        });
      },
    );
    const covered = registrations
      ? rows.map((row) =>
          Object.freeze({
            ...row,
            registrationDefinitionHash: registrations.get(row.fileId)!
              .definitionHash,
          }),
        )
      : rows;
    return Object.freeze({
      manifest,
      rows: Object.freeze(covered),
      ...(registry === 'PROJECTION'
        ? {
            media: Object.freeze(
              rows.map((row) => registrations!.get(row.fileId)!),
            ),
          }
        : {}),
    });
  }

  private async appendStableCutRetainedVersions(
    input: ItemRecipientFinalCoverageInput,
    matched: readonly MatchedRecipientFinalVersion[],
    gate: ItemCopyGateRecord,
    retained: ItemStableCutRetainedVersions,
    session: ClientSession,
  ) {
    const config = this.sourceProfileConfirmation;
    if (!config?.profiles.assertActiveSharedControls) throw this.unavailable();
    for (const final of matched) {
      const source = final.historicalSource;
      const historical = await this.readStagingHistoricalPut(
        source,
        input.selector,
        gate,
        session,
      );
      const version = historical.versionRecord;
      if (
        !version ||
        version.observation.observationHash !== source.versionObservationHash ||
        version.evidence.conservationControlsHash !==
          source.conservationControlsHash ||
        historical.definition.manifestHash !== input.expectedManifestHash ||
        archiveHash(historical.definition.binding) !==
          archiveHash(final.definition.binding) ||
        version.observation.scope.target.key !== final.file.historicalKey ||
        version.observation.scope.sha256 !==
          final.versionRecord.observation.scope.sha256
      )
        throw new ConflictError(
          'The retained historical version changed for the selected file',
        );
      await config.profiles.assertActiveSharedControls(
        source.conservationControlsHash,
        session,
      );
      assertHistoricalPutVersionUsable(
        version,
        input.requiredThrough,
        config.now().getTime(),
      );

      retained.versionsDigest = archiveHash({
        previous: retained.versionsDigest,
        fileId: final.file.id,
        fileDefinitionHash: final.file.definitionHash,
        historical: version.observation.observationHash,
        final: final.versionRecord.observation.observationHash,
      });
      retained.controls.add(source.conservationControlsHash);
      retained.controls.add(
        final.versionRecord.evidence.conservationControlsHash,
      );
      retained.fileCount++;
    }
  }

  private async readStableCutCopyInventory(
    selection: ItemRecipientProjectionSelection,
    snapshot: ItemCaptureSnapshot,
    session: ClientSession,
  ): Promise<ItemStableCutCopyInventory> {
    const expected = buildItemCopyGate(selection.selector, snapshot);
    const rawGate = await this.copyRecords!.findOne({ id: expected.id })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    if (rawGate && rawGate.row !== 'GATE')
      throw new ConflictError('The stable-cut copy gate is inconsistent');
    const gate = rawGate && captureItemCopyGate(rawGate, expected);
    let afterId: string | undefined;
    let attemptCount = 0;
    let permissionCount = 0;
    let attemptsDigest = archiveHash([
      ITEM_STABLE_CUT_SCOPE_PROTOCOL,
      'COPY_ATTEMPTS',
    ]);
    for (;;) {
      const rows = await this.copyRecords!.find({
        gateId: expected.id,
        row: 'ATTEMPT',
        ...(afterId === undefined ? {} : { id: { $gt: afterId } }),
      })
        .select({ _id: 0 })
        .sort({ id: 1 })
        .collation({ locale: 'simple' })
        .limit(ITEM_MANIFEST_PAGE_SIZE)
        .setOptions({ singleBatch: true, maxTimeMS: 5000 })
        .session(session)
        .lean()
        .exec();
      if (!rows.length) break;
      if (!gate || rows.length > ITEM_MANIFEST_PAGE_SIZE)
        throw new ConflictError(
          'The stable-cut copy inventory is inconsistent',
        );
      for (const row of rows) {
        if (afterId !== undefined && row.id <= afterId)
          throw new ConflictError(
            'The stable-cut copy inventory cursor did not advance',
          );
        const pin = itemStableCutAttemptPin(
          row,
          gate,
          selection.expectedManifestHash,
        );
        attemptsDigest = archiveHash({ previous: attemptsDigest, pin });
        afterId = pin.attemptId;
        attemptCount++;
        if (pin.permission) permissionCount++;
      }
    }
    return Object.freeze({
      gate: gate
        ? Object.freeze({
            id: gate.id,
            recordHash: archiveHash(gate),
            revision: gate.revision,
            state: gate.state,
          })
        : null,
      attemptCount,
      permissionCount,
      attemptsDigest,
    });
  }

  private async readPreparedCoverageRegistrations(
    archive: OwnershipArchive,
    manifest: ItemManifestDigestResult,
    matched: readonly MatchedRecipientFinalVersion[],
    session: ClientSession,
  ) {
    const invalid = () =>
      new ConflictError(
        'The final version requires its exact prepared media registration',
      );
    const stored = await this.registrations!.find({
      archiveId: archive.id,
      fileId: { $in: matched.map(({ file }) => file.id) },
    })
      .limit(matched.length + 1)
      .setOptions({ singleBatch: true, maxTimeMS: 5000 })
      .session(session)
      .lean()
      .exec();
    if (stored.length !== matched.length) throw invalid();
    const byFile = new Map(stored.map((record) => [record.fileId, record]));
    if (byFile.size !== matched.length) throw invalid();
    const checked = new Map<string, ItemRecipientFinalMediaRegistration>();
    for (const version of matched) {
      const { file } = version;
      const current = byFile.get(file.id);
      if (!current) throw invalid();
      const expected = buildItemRecipientFinalMediaRegistration(
        archive,
        manifest,
        file,
        version,
      );
      assertSameMediaRegistration(current, expected);
      checked.set(file.id, expected);
    }
    return checked;
  }

  private async prepareRecipientFinalMediaRegistration(
    input: ItemRecipientFinalMediaRegistrationInput,
    snapshot: ItemCaptureSnapshot,
    session: ClientSession,
  ) {
    const archive = snapshot.archive!;
    const file = await this.files
      .findOne({ id: input.fileId, archiveId: archive.id })
      .select(finalVersionFileProjection)
      .maxTimeMS(5000)
      .session(session)
      .lean()
      .exec();
    if (!file || file.id !== input.fileId || file.archiveId !== archive.id)
      throw new ConflictError('The sealed manifest file is absent');
    const { manifest, matched } = await this.readRecipientFinalVersions(
      input,
      snapshot,
      [file],
      session,
    );
    const final = matched[0];
    if (
      final.versionRecord.observation.observationHash !==
      input.expectedVersionObservationHash
    )
      throw new ConflictError('The expected final version observation changed');
    const referenced = await this.entries
      .exists({
        archiveId: archive.id,
        'fileBindings.fileId': file.id,
        kind: { $in: ['ANIMAL', 'DIARY_ENTRY', 'MEDICAL_DOCUMENT'] },
        retained: { $exists: false },
      })
      .maxTimeMS(5000)
      .session(session)
      .exec();
    if (!referenced)
      throw new ConflictError(
        'The sealed manifest file has no captured resource binding',
      );
    return {
      record: buildItemRecipientFinalMediaRegistration(
        archive,
        manifest,
        file,
        final,
      ),
      version: final.versionRecord,
    };
  }

  private async readRecipientFinalVersions(
    input: ItemRecipientFinalCoverageInput,
    snapshot: ItemCaptureSnapshot,
    files: readonly ArchiveFile[],
    session: ClientSession,
  ) {
    const archive = snapshot.archive!;
    const invalid = () =>
      new ConflictError(
        'The final version does not match its sealed manifest file',
      );
    if (!archive.manifestDigest) throw invalid();
    const manifest = matchItemManifestDigest(
      input,
      snapshot,
      archive.manifestDigest,
    );
    if (manifest.manifestHash !== input.expectedManifestHash) throw invalid();
    const matched: MatchedRecipientFinalVersion[] = [];
    if (!files.length) return { manifest, matched };
    const gateDefinition = buildItemCopyGate(input.selector, snapshot);
    const rawGate = await this.copyRecords!.findOne({ id: gateDefinition.id })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    if (rawGate?.row !== 'GATE') throw invalid();
    const gate = captureItemCopyGate(rawGate, gateDefinition);
    const candidates = files.map((file) => {
      const intent = file.recipientFinalCopyIntent;
      if (
        intent?.protocol !== 'ITEM_RECIPIENT_FINAL_COPY_INTENT_V1' ||
        archive.state !== 'COPYING' ||
        file.state !== 'PENDING' ||
        file.leaseToken !== undefined ||
        file.leaseUntil !== undefined ||
        file.verified !== undefined ||
        file.materialization !== undefined
      )
        throw invalid();
      return { file, intent };
    });
    const attempts = await this.copyRecords!.find({
      row: 'ATTEMPT',
      gateId: gate.id,
      copyIntentId: { $in: candidates.map(({ intent }) => intent.id) },
      ordinal: 1,
    })
      .select({ _id: 0 })
      .limit(files.length + 1)
      .setOptions({ singleBatch: true, maxTimeMS: 5000 })
      .session(session)
      .lean()
      .exec();
    if (attempts.length !== files.length) throw invalid();
    const byIntent = new Map<string, ItemRecipientFinalPutAttemptRecord>();
    for (const attempt of attempts) {
      if (
        attempt.row !== 'ATTEMPT' ||
        attempt.definition?.protocol !==
          'ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1' ||
        !('finalDestinationAccreditation' in attempt) ||
        byIntent.has(attempt.copyIntentId)
      )
        throw invalid();
      byIntent.set(attempt.copyIntentId, attempt);
    }

    for (const { file, intent } of candidates) {
      const attempt = byIntent.get(intent.id);
      const protection = attempt?.destinationProtection;
      if (!attempt || !protection?.accreditationHash) throw invalid();
      const source = intent.predecessor?.stagingPutVersion;
      if (!source) throw invalid();
      const original = await this.readFinalStagingPut(
        source,
        input.selector,
        gate,
        session,
      );
      const { definition } = buildItemRecipientFinalPutAttempt(
        {
          selector: input.selector,
          snapshot,
          file,
          bucket: intent.bucket,
          sourceSha256: intent.source.sha256,
        },
        original,
        {
          attemptId: attempt.id,
          dispatcherInstanceId: attempt.definition.dispatcherInstanceId,
          expectedManifestHash: manifest.manifestHash,
          expectedFinalIntentHash: intent.definitionHash,
          source,
        },
      );
      const declaration = this.recipientFinalPutDeclaration(
        definition,
        gate.id,
        attempt.finalDestinationAccreditation,
        protection.controlsHash,
        protection.accreditationHash,
      );
      const { permission, versionRecord } = this.matchStoredRecipientFinalPut(
        attempt,
        declaration,
        gate,
        original,
      );
      if (!permission || !versionRecord) throw invalid();
      matched.push({
        file,
        definition,
        permission,
        versionRecord,
        historicalSource: original.definition.predecessor,
      });
    }
    return { manifest, matched, gate };
  }

  private async readFinalStagingPut(
    source: ItemPutVersionPreparationInput['source'],
    selector: ItemCaptureInput,
    gate: ItemCopyGateRecord,
    session: ClientSession,
  ) {
    const original = await this.stagingPutPermissionObservation(
      {
        mode: 'READ_STAGING_PUT_RECONCILIATION',
        input: {
          selector,
          attemptId: source.attemptId,
          expectedAttemptDefinitionHash: source.attemptDefinitionHash,
          authorizationId: source.authorizationId,
        },
      },
      gate,
      session,
    );
    if (!original || !('definition' in original))
      throw new ConflictError('The staging PUT permission is absent');
    return original;
  }

  private async loadRecipientFinalPutRecord(
    action: RecipientFinalPutAction,
    context: ItemCopyIntentContext,
    manifestHash: string,
    original: ItemStagingPutVersionContext,
    gate: ItemCopyGateRecord,
    session: ClientSession,
  ) {
    const { input } = action;
    const raw = await this.copyRecords!.findOne({ id: input.attemptId })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    const changed = () =>
      new ConflictError('The expected final PUT attempt changed or is absent');
    if (
      raw &&
      (raw.row !== 'ATTEMPT' ||
        raw.definition?.protocol !== 'ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1' ||
        !('finalDestinationAccreditation' in raw))
    )
      throw changed();
    const declaration =
      action.mode === 'DECLARE_FINAL_PUT' ? action : undefined;
    if (!declaration && !raw) throw changed();
    const { definition, versionRecord } = buildItemRecipientFinalPutAttempt(
      context,
      original,
      {
        attemptId: input.attemptId,
        dispatcherInstanceId:
          declaration?.input.dispatcherInstanceId ??
          raw!.definition.dispatcherInstanceId,
        expectedManifestHash: manifestHash,
        expectedFinalIntentHash: input.expectedFinalIntentHash,
        source: input.source,
      },
    );
    if (definition.definitionHash !== input.expectedAttemptDefinitionHash)
      throw changed();
    const accreditation =
      declaration?.accreditation ?? raw!.finalDestinationAccreditation;
    const record = this.recipientFinalPutDeclaration(
      definition,
      gate.id,
      accreditation,
      input.expectedControlsHash,
      input.expectedAccreditationHash,
    );
    if (raw) {
      return {
        record: this.matchStoredRecipientFinalPut(raw, record, gate, original),
        versionRecord,
        replayed: true,
      };
    }
    await this.assertInitialCopySlot(record, session);
    return { record, versionRecord, replayed: false };
  }

  private recipientFinalPutDeclaration(
    definition: ItemRecipientFinalPutAttempt,
    gateId: string,
    accreditation: ItemRecipientFinalPutDestinationAccreditation,
    controlsHash: string,
    accreditationHash: string,
  ): ItemRecipientFinalPutAttemptRecord {
    return Object.freeze({
      ...newIntendedCopyRecord(definition, gateId),
      finalDestinationAccreditation: accreditation,
      destinationProtection:
        protectRecipientFinalPutDestinationFromAccreditation(
          definition,
          controlsHash,
          accreditationHash,
          accreditation,
        ),
    });
  }

  private matchStoredRecipientFinalPut(
    raw: ItemRecipientFinalPutAttemptRecord,
    declaration: ItemRecipientFinalPutAttemptRecord,
    gate: ItemCopyGateRecord,
    original: ItemStagingPutVersionContext,
    authorizationId?: string,
  ): ItemRecipientFinalPutAttemptRecord {
    const { permission, transportObservation, versionRecord } = raw;
    let record = declaration;
    if (permission) {
      const checked = observeInitialRecipientFinalPutPermission(
        gate,
        declaration,
        original,
        permission,
        authorizationId ?? permission.authorizationId,
      );
      record = {
        ...record,
        permission: checked.permission,
        identityIds: Object.freeze([
          declaration.id,
          checked.permission.authorizationId,
        ]),
        ...(transportObservation
          ? {
              transportObservation: matchRecipientFinalPutTransportObservation(
                checked.permission,
                transportObservation,
              ),
            }
          : {}),
        ...(versionRecord
          ? {
              versionRecord: matchRecipientFinalPutVersionRecord(
                {
                  definition: declaration.definition,
                  permission: checked.permission,
                },
                versionRecord,
              ),
            }
          : {}),
      };
    }
    if (archiveHash(raw) !== archiveHash(record))
      throw new ConflictError('The stored final PUT attempt is inconsistent');
    return Object.freeze(record);
  }

  private async recipientFinalPutPermissionObservation(
    action:
      | RecipientFinalPutPermissionHistoryAction
      | RecipientFinalPutReconciliationAction,
    gate: ItemCopyGateRecord,
    session: ClientSession,
  ): Promise<
    | ItemRecipientFinalPutPermissionObservation
    | ItemRecipientFinalPutVersionContext
    | null
  > {
    const { input } = action;
    const raw = await this.copyRecords!.findOne({
      id: input.attemptId,
      gateId: gate.id,
    })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    if (
      raw?.row !== 'ATTEMPT' ||
      raw.definition?.protocol !== 'ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1' ||
      raw.definition.definitionHash !== input.expectedAttemptDefinitionHash ||
      !('finalDestinationAccreditation' in raw)
    )
      throw new ConflictError(
        'The expected final PUT attempt changed or is absent',
      );
    const { definition, destinationProtection, finalDestinationAccreditation } =
      raw;
    if (!destinationProtection?.accreditationHash)
      throw new ConflictError('The stored final PUT accreditation is absent');
    const original = await this.readFinalStagingPut(
      definition.predecessor,
      input.selector,
      gate,
      session,
    );
    const declaration = this.recipientFinalPutDeclaration(
      definition,
      gate.id,
      finalDestinationAccreditation,
      destinationProtection.controlsHash,
      destinationProtection.accreditationHash,
    );
    const { permission, transportObservation, versionRecord } =
      this.matchStoredRecipientFinalPut(
        raw,
        declaration,
        gate,
        original,
        input.authorizationId,
      );
    if (action.mode === 'READ_FINAL_PUT_RECONCILIATION')
      return permission
        ? Object.freeze({
            definition,
            permission,
            ...(versionRecord ? { versionRecord } : {}),
          })
        : null;
    if (action.mode === 'RECORD_FINAL_PUT_VERSION') {
      if (!permission)
        throw new ConflictError(
          'The original final PUT permission is required',
        );
      const context = { definition, permission };
      const version = await this.persistPutVersion(
        declaration,
        permission,
        versionRecord,
        matchRecipientFinalPutVersionRecord(context, action.version),
        session,
      );
      return Object.freeze({ ...context, versionRecord: version });
    }
    let observed = transportObservation;
    if (action.mode === 'RECORD_FINAL_PUT_TRANSPORT_OBSERVATION') {
      if (
        !permission ||
        permission.permissionHash !== action.input.expectedPermissionHash
      )
        throw new ConflictError(
          'The original final PUT permission is required',
        );
      observed = await this.persistPutTransportObservation(
        declaration,
        observed,
        buildRecipientFinalPutTransportObservation(
          permission,
          action.input.localReturn,
        ),
        session,
      );
    }
    return permission
      ? Object.freeze({
          permission,
          ...(observed ? { transportObservation: observed } : {}),
          copyDispatch: 'NOT_AUTHORIZED' as const,
          businessCommit: 'NOT_AUTHORIZED' as const,
        })
      : null;
  }

  private async readStagingHistoricalPut(
    source: ItemHistoricalPutStagingInput['source'],
    selector: ItemCaptureInput,
    gate: ItemCopyGateRecord,
    session: ClientSession,
  ) {
    const original = await this.historicalPutPermissionObservation(
      {
        mode: 'READ_PUT_RECONCILIATION',
        input: {
          selector,
          attemptId: source.attemptId,
          expectedAttemptDefinitionHash: source.attemptDefinitionHash,
          authorizationId: source.authorizationId,
        },
      },
      gate,
      session,
    );
    if (!original || !('definition' in original))
      throw new ConflictError('The historical PUT V2 permission is absent');
    return original;
  }

  private async loadStagingPutRecord(
    action: StagingPutAction,
    context: ItemCopyIntentContext,
    manifestHash: string,
    original: ItemHistoricalPutVersionContext,
    gate: ItemCopyGateRecord,
    session: ClientSession,
  ) {
    const { input } = action;
    const previous = await this.copyRecords!.findOne({ id: input.attemptId })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    const changed = () =>
      new ConflictError(
        'The expected staging PUT attempt changed or is absent',
      );
    if (
      previous &&
      (previous.row !== 'ATTEMPT' ||
        previous.definition?.protocol !== 'ITEM_STAGING_PUT_ATTEMPT_V1' ||
        !('stagingDestinationAccreditation' in previous))
    )
      throw changed();
    const declaration =
      action.mode === 'DECLARE_STAGING_PUT' ? action : undefined;
    if (!declaration && !previous) throw changed();
    const definition = buildItemStagingPutAttempt(context, original, {
      attemptId: input.attemptId,
      dispatcherInstanceId:
        declaration?.input.dispatcherInstanceId ??
        previous!.definition.dispatcherInstanceId,
      expectedManifestHash: manifestHash,
      expectedStagingIntentHash: input.expectedStagingIntentHash,
    });
    if (
      definition.definitionHash !== input.expectedAttemptDefinitionHash ||
      archiveHash(definition.predecessor) !== archiveHash(input.source)
    )
      throw changed();

    const accreditation =
      declaration?.accreditation ?? previous!.stagingDestinationAccreditation;
    const record: ItemStagingPutAttemptRecord = Object.freeze({
      ...newIntendedCopyRecord(definition, gate.id),
      stagingDestinationAccreditation: accreditation,
      destinationProtection: protectStagingPutDestinationFromAccreditation(
        definition,
        input.expectedControlsHash,
        input.expectedAccreditationHash,
        accreditation,
      ),
    });
    if (previous)
      return {
        record: this.matchStoredStagingPut(previous, record, gate, original),
        replayed: true,
      };
    await this.assertInitialCopySlot(record, session);
    return { record, replayed: false };
  }

  private matchStoredStagingPut(
    raw: ItemStagingPutAttemptRecord,
    declaration: ItemStagingPutAttemptRecord,
    gate: ItemCopyGateRecord,
    original: ItemHistoricalPutVersionContext,
    expectedAuthorizationId?: string,
  ): ItemStagingPutAttemptRecord {
    let record = declaration;
    if ('permission' in raw) {
      if (!raw.permission)
        throw new ConflictError(
          'The stored staging PUT permission is inconsistent',
        );
      const { permission } = observeInitialStagingPutPermission(
        gate,
        declaration,
        original,
        raw.permission,
        expectedAuthorizationId ?? raw.permission.authorizationId,
      );
      record = {
        ...declaration,
        identityIds: Object.freeze([
          declaration.id,
          permission.authorizationId,
        ]),
        permission,
      };
    }
    if ('transportObservation' in raw) {
      if (!record.permission || !raw.transportObservation)
        throw new ConflictError(
          'The stored staging PUT transport observation is inconsistent',
        );
      record = {
        ...record,
        transportObservation: matchStagingPutTransportObservation(
          record.permission,
          raw.transportObservation,
        ),
      };
    }
    if ('versionRecord' in raw) {
      if (!record.permission || !raw.versionRecord)
        throw new ConflictError(
          'The stored staging PUT version observation is inconsistent',
        );
      record = {
        ...record,
        versionRecord: matchStagingPutVersionRecord(
          { definition: record.definition, permission: record.permission },
          raw.versionRecord,
        ),
      };
    }
    if (archiveHash(raw) !== archiveHash(record))
      throw new ConflictError(
        'The expected staging PUT attempt changed or is absent',
      );
    return Object.freeze(record);
  }

  private async stagingPutPermissionObservation(
    action: StagingPutPermissionHistoryAction | StagingPutReconciliationAction,
    gate: ItemCopyGateRecord,
    session: ClientSession,
  ): Promise<
    ItemStagingPutPermissionObservation | ItemStagingPutVersionContext | null
  > {
    const { input } = action;
    const row = await this.copyRecords!.findOne({
      id: input.attemptId,
      gateId: gate.id,
    })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    if (
      row?.row !== 'ATTEMPT' ||
      row.definition?.protocol !== 'ITEM_STAGING_PUT_ATTEMPT_V1' ||
      row.definition.definitionHash !== input.expectedAttemptDefinitionHash ||
      !('stagingDestinationAccreditation' in row)
    )
      throw new ConflictError(
        'The expected staging PUT attempt changed or is absent',
      );
    const {
      definition,
      stagingDestinationAccreditation,
      destinationProtection,
    } = row;
    const accreditationHash = destinationProtection?.accreditationHash;
    if (!accreditationHash)
      throw new ConflictError('The stored staging PUT accreditation is absent');
    const original = await this.readStagingHistoricalPut(
      definition.predecessor,
      input.selector,
      gate,
      session,
    );
    const declaration = {
      ...newIntendedCopyRecord(definition, gate.id),
      stagingDestinationAccreditation,
      destinationProtection: protectStagingPutDestinationFromAccreditation(
        definition,
        destinationProtection.controlsHash,
        accreditationHash,
        stagingDestinationAccreditation,
      ),
    };
    const { permission, transportObservation, versionRecord } =
      this.matchStoredStagingPut(
        row,
        declaration,
        gate,
        original,
        input.authorizationId,
      );
    if (action.mode === 'READ_STAGING_PUT_RECONCILIATION')
      return permission
        ? Object.freeze({
            definition,
            permission,
            ...(versionRecord ? { versionRecord } : {}),
          })
        : null;
    if (action.mode === 'RECORD_STAGING_PUT_VERSION') {
      if (!permission)
        throw new ConflictError(
          'The original staging PUT permission is required',
        );
      const context = { definition, permission };
      const saved = await this.persistPutVersion(
        declaration,
        permission,
        versionRecord,
        matchStagingPutVersionRecord(context, action.version),
        session,
      );
      return Object.freeze({ ...context, versionRecord: saved });
    }
    let observed = transportObservation;
    if (action.mode === 'RECORD_STAGING_PUT_TRANSPORT_OBSERVATION') {
      if (
        !permission ||
        permission.permissionHash !== action.input.expectedPermissionHash
      )
        throw new ConflictError(
          'The original staging PUT permission is required',
        );
      observed = await this.persistPutTransportObservation(
        declaration,
        transportObservation,
        buildStagingPutTransportObservation(
          permission,
          action.input.localReturn,
        ),
        session,
      );
    }
    return permission
      ? Object.freeze({
          permission,
          ...(observed ? { transportObservation: observed } : {}),
          ...(versionRecord ? { versionRecord } : {}),
          copyDispatch: 'NOT_AUTHORIZED' as const,
          businessCommit: 'NOT_AUTHORIZED' as const,
        })
      : null;
  }

  private async prepareInitialStagingPutPermission(
    pins: ItemStagingPutPermissionRecordInput,
    gate: ItemCopyGateRecord,
    attempt: ItemStagingPutAttemptRecord,
    historical: ItemHistoricalPutVersionContext,
    session: ClientSession,
  ) {
    const config = this.sourceProfileConfirmation;
    if (!config?.stagingPermissionEvidenceFor) throw this.unavailable();
    await this.assertCopyRecordIdentityAvailable(pins.authorizationId, session);
    const evidence = config.stagingPermissionEvidenceFor(
      pins,
      attempt.definition,
    );
    if (
      !evidence ||
      evidence.transportRequestHash !== pins.transportRequestHash
    )
      throw new ConflictError(
        'The exact held staging artifact and transport request are required',
      );
    return buildInitialStagingPutPermission(gate, attempt, historical, {
      ...evidence,
      authorizationId: pins.authorizationId,
      expectedGateRevision: pins.expectedGateRevision,
      expectedArtifactHash: pins.expectedArtifactHash,
      checkedAt: config.now().getTime(),
    });
  }

  private async prepareInitialRecipientFinalPutPermission(
    pins: ItemRecipientFinalPutPermissionRecordInput,
    gate: ItemCopyGateRecord,
    attempt: ItemRecipientFinalPutAttemptRecord,
    original: ItemStagingPutVersionContext,
    session: ClientSession,
  ) {
    const config = this.sourceProfileConfirmation;
    if (!config?.finalPermissionEvidenceFor) throw this.unavailable();
    await this.assertCopyRecordIdentityAvailable(pins.authorizationId, session);
    const evidence = config.finalPermissionEvidenceFor(
      pins,
      attempt.definition,
    );
    if (
      !evidence ||
      evidence.transportRequestHash !== pins.transportRequestHash
    )
      throw new ConflictError(
        'The exact held final artifact and transport request are required',
      );
    return buildInitialRecipientFinalPutPermission(gate, attempt, original, {
      ...evidence,
      authorizationId: pins.authorizationId,
      expectedGateRevision: pins.expectedGateRevision,
      expectedArtifactHash: pins.expectedArtifactHash,
      checkedAt: config.now().getTime(),
    });
  }

  private async persistInitialPutPermission(
    original:
      | ItemHistoricalPutAttemptV2Record
      | ItemStagingPutAttemptRecord
      | ItemRecipientFinalPutAttemptRecord,
    permission:
      | ItemHistoricalPutPermission
      | ItemStagingPutPermission
      | ItemRecipientFinalPutPermission,
    session: ClientSession,
  ) {
    this.changed(
      await this.copyRecords!.updateOne(
        {
          id: original.id,
          protocol: original.protocol,
          row: original.row,
          gateId: original.gateId,
          copyIntentId: original.copyIntentId,
          ordinal: original.ordinal,
          state: original.state,
          'definition.protocol': original.definition.protocol,
          'definition.definitionHash': original.definition.definitionHash,
          'destinationProtection.protectionHash': permission.protectionHash,
          permission: { $exists: false },
        },
        {
          $set: {
            permission,
            identityIds: [original.id, permission.authorizationId],
          },
        },
        { session },
      ).exec(),
    );
  }

  private async checkVersionedPutControls(
    input: Pick<ItemStagingPutReadInput, 'source' | 'expectedControlsHash'>,
    record: ItemHistoricalPutVersionRecord | ItemStagingPutVersionRecord,
    session: ClientSession,
    fence: boolean,
  ) {
    const config = this.sourceProfileConfirmation;
    if (!config) throw this.unavailable();
    const guard = fence
      ? config.profiles.fenceActiveSharedControls
      : config.profiles.assertActiveSharedControls;
    if (!guard) throw this.unavailable();
    const generations = new Set([
      input.source.conservationControlsHash,
      input.expectedControlsHash,
    ]);
    for (const generation of generations)
      await guard.call(config.profiles, generation, session);
    assertHistoricalPutVersionUsable(
      record,
      input.source.requiredThrough,
      config.now().getTime(),
    );
  }

  private async prepareHistoricalPutRecord(
    input:
      | ItemHistoricalPutDeclarationInput
      | ItemHistoricalPutDeclarationV2Input,
    {
      context,
      material,
    }: {
      context: ItemCopyIntentContext;
      material: ItemHistoricalSourceAnchorMaterial;
    },
    gateId: string,
    session: ClientSession,
  ): Promise<
    ItemHistoricalPutAttemptRecord | ItemHistoricalPutAttemptV2Record
  > {
    const config = this.sourceProfileConfirmation;
    if (!config?.assessment) throw this.unavailable();
    const { expectedBucketOwner } = config.assessment;
    let record:
      | ItemHistoricalPutAttemptRecord
      | ItemHistoricalPutAttemptV2Record
      | undefined;
    await config.profiles.fenceActiveSourceProfile(
      input.expectedProfile,
      session,
      (profile) => {
        const original = {
          attemptId: input.attemptId,
          dispatcherInstanceId: input.dispatcherInstanceId,
          expectedBucketOwner,
          profile,
          anchor: material,
          artifact: input.artifact,
        };
        if ('metadata' in input) {
          const definition = buildItemHistoricalPutAttemptV2(context, {
            ...original,
            metadata: input.metadata,
            expectedMetadataHash: input.expectedMetadataHash,
          });
          record = Object.freeze({
            ...newIntendedCopyRecord(definition, gateId),
            sourceArtifactMetadata: input.metadata,
          });
        } else {
          record = newIntendedCopyRecord(
            buildItemHistoricalPutAttempt(context, original),
            gateId,
          );
        }
      },
    );
    if (!record) throw this.unavailable();
    return record;
  }

  private async readPersistedHistoricalPutV2(
    input: ItemHistoricalPutReadInput,
    context: ItemCopyIntentContext,
    material: ItemHistoricalSourceAnchorMaterial,
    gate: ItemCopyGateRecord,
    session: ClientSession,
  ) {
    const config = this.sourceProfileConfirmation;
    if (!config?.assessment || !config.profiles.readActiveSourceProfile)
      throw this.unavailable();
    const row = await this.copyRecords!.findOne({ id: input.attemptId })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    const changed = () =>
      new ConflictError(
        'The expected historical PUT V2 attempt changed or is absent',
      );
    if (
      row?.row !== 'ATTEMPT' ||
      row.definition?.protocol !== 'ITEM_HISTORICAL_PUT_ATTEMPT_V2' ||
      row.definition.definitionHash !== input.expectedAttemptDefinitionHash ||
      !('sourceArtifactMetadata' in row) ||
      'delegationBound' in row
    )
      throw changed();

    const profile = await config.profiles.readActiveSourceProfile(
      input.expectedProfile,
      session,
    );
    const definition = matchItemHistoricalPutAttemptV2(
      context,
      {
        attemptId: input.attemptId,
        dispatcherInstanceId: row.definition.dispatcherInstanceId,
        expectedBucketOwner: config.assessment.expectedBucketOwner,
        profile,
        anchor: material,
        artifact: row.definition.artifact,
        metadata: row.sourceArtifactMetadata,
        expectedMetadataHash: row.definition.metadataHash,
      },
      row.definition,
      input.expectedAttemptDefinitionHash,
    );
    const record = {
      ...newIntendedCopyRecord(definition, gate.id),
      sourceArtifactMetadata: buildItemSourceArtifactMetadata(
        definition.artifact,
        row.sourceArtifactMetadata.representation,
      ),
    };
    return {
      record: Object.freeze(record),
      stored: this.matchStoredHistoricalPutV2(row, record, gate),
      sourceControlsHash: profile.controlsHash,
    };
  }

  private matchStoredHistoricalPutV2(
    row: ItemCopyRecord,
    declaration: ItemHistoricalPutAttemptV2Record,
    gate: ItemCopyGateRecord,
    expectedAuthorizationId?: string,
  ) {
    const permission =
      'sourceArtifactMetadata' in row && row.permission
        ? observeInitialHistoricalPutPermission(
            gate,
            {
              ...declaration,
              destinationProtection: row.destinationProtection,
            },
            row.permission,
            expectedAuthorizationId ?? row.permission.authorizationId,
          ).permission
        : undefined;
    return matchHistoricalPutV2Record(row, declaration, permission);
  }

  private async historicalPutPermissionObservation(
    action:
      | PutReconciliationAction
      | Extract<
          HistoricalPutPermissionAction,
          { mode: 'READ_PUT_PERMISSION' | 'RECORD_PUT_TRANSPORT_OBSERVATION' }
        >,
    gate: ItemCopyGateRecord,
    session: ClientSession,
  ): Promise<
    | ItemHistoricalPutPermissionObservation
    | ItemHistoricalPutVersionContext
    | null
  > {
    const { input } = action;
    const row = await this.copyRecords!.findOne({
      id: input.attemptId,
      gateId: gate.id,
    })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    if (
      row?.row !== 'ATTEMPT' ||
      row.definition?.protocol !== 'ITEM_HISTORICAL_PUT_ATTEMPT_V2' ||
      row.definition.definitionHash !== input.expectedAttemptDefinitionHash ||
      !('sourceArtifactMetadata' in row)
    )
      throw new ConflictError(
        'The expected historical PUT V2 attempt changed or is absent',
      );

    const { definition } = row;
    const { definitionHash, ...definitionFacts } = definition;
    if (archiveHash(definitionFacts) !== definitionHash)
      throw new ConflictError(
        'The stored historical PUT V2 definition is inconsistent',
      );
    const declaration = {
      ...newIntendedCopyRecord(definition, gate.id),
      sourceArtifactMetadata: matchItemSourceArtifactMetadata(
        row.definition.artifact,
        row.sourceArtifactMetadata,
        row.definition.metadataHash,
      ),
    };
    const { permission, transportObservation, versionRecord } =
      this.matchStoredHistoricalPutV2(
        row,
        declaration,
        gate,
        input.authorizationId,
      );
    if (action.mode === 'READ_PUT_RECONCILIATION')
      return permission
        ? Object.freeze({
            definition,
            permission,
            ...(versionRecord ? { versionRecord } : {}),
          })
        : null;
    if (action.mode === 'RECORD_PUT_VERSION') {
      if (!permission)
        throw new ConflictError(
          'The original historical PUT permission is required',
        );
      const context = { definition, permission };
      const saved = await this.persistPutVersion(
        declaration,
        permission,
        versionRecord,
        matchHistoricalPutVersionRecord(context, action.version),
        session,
      );
      return Object.freeze({ ...context, versionRecord: saved });
    }
    let observed = transportObservation;
    if (action.mode === 'RECORD_PUT_TRANSPORT_OBSERVATION') {
      const { expectedPermissionHash, localReturn } = action.input;
      if (!permission || permission.permissionHash !== expectedPermissionHash)
        throw new ConflictError(
          'The original historical PUT permission is required',
        );
      observed = await this.persistPutTransportObservation(
        declaration,
        transportObservation,
        buildHistoricalPutTransportObservation(permission, localReturn),
        session,
      );
    }
    if (!permission) return null;
    return Object.freeze({
      permission,
      ...(observed ? { transportObservation: observed } : {}),
      ...(versionRecord ? { versionRecord } : {}),
      copyDispatch: 'NOT_AUTHORIZED' as const,
      businessCommit: 'NOT_AUTHORIZED' as const,
    });
  }

  private async persistPutTransportObservation<
    Observation extends
      | ItemHistoricalPutTransportObservation
      | ItemStagingPutTransportObservation
      | ItemRecipientFinalPutTransportObservation,
  >(
    declaration:
      | ItemHistoricalPutAttemptV2Record
      | ItemStagingPutAttemptRecord
      | ItemRecipientFinalPutAttemptRecord,
    stored: Observation | undefined,
    expected: Observation,
    session: ClientSession,
  ): Promise<Observation> {
    if (stored) {
      if (stored.observationHash !== expected.observationHash) {
        const stage =
          expected.protocol === 'ITEM_STAGING_PUT_TRANSPORT_OBSERVATION_V1'
            ? 'staging'
            : expected.protocol ===
                'ITEM_RECIPIENT_FINAL_PUT_TRANSPORT_OBSERVATION_V1'
              ? 'final'
              : 'historical';
        throw new ConflictError(
          `The original ${stage} PUT transport observation cannot be replaced`,
        );
      }
      return stored;
    }
    this.changed(
      await this.copyRecords!.updateOne(
        {
          id: declaration.id,
          protocol: declaration.protocol,
          row: declaration.row,
          gateId: declaration.gateId,
          state: declaration.state,
          'definition.protocol': declaration.definition.protocol,
          'definition.definitionHash': declaration.definition.definitionHash,
          'permission.authorizationId': expected.authorizationId,
          'permission.permissionHash': expected.permissionHash,
          transportObservation: { $exists: false },
        },
        { $set: { transportObservation: expected } },
        { session },
      ).exec(),
    );
    return expected;
  }

  private async persistPutVersion<
    Version extends
      | ItemHistoricalPutVersionRecord
      | ItemStagingPutVersionRecord
      | ItemRecipientFinalPutVersionRecord,
  >(
    attempt:
      | ItemHistoricalPutAttemptV2Record
      | ItemStagingPutAttemptRecord
      | ItemRecipientFinalPutAttemptRecord,
    permission:
      | ItemHistoricalPutPermission
      | ItemStagingPutPermission
      | ItemRecipientFinalPutPermission,
    stored: Version | undefined,
    record: Version,
    session: ClientSession,
  ): Promise<Version> {
    if (stored) {
      if (
        stored.observation.observationHash !==
        record.observation.observationHash
      )
        throw new ConflictError(
          attempt.definition.protocol === 'ITEM_STAGING_PUT_ATTEMPT_V1'
            ? 'The original staging PUT version observation cannot be replaced'
            : attempt.definition.protocol ===
                'ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1'
              ? 'The original final PUT version observation cannot be replaced'
              : 'The original historical PUT version observation cannot be replaced',
        );
      return stored;
    }
    const config = this.sourceProfileConfirmation;
    if (!config?.profiles.fenceActiveSharedControls) throw this.unavailable();
    await config.profiles.fenceActiveSharedControls(
      record.evidence.conservationControlsHash,
      session,
    );
    assertHistoricalPutVersionUsable(
      record,
      record.observation.requiredThrough,
      config.now().getTime(),
    );
    this.changed(
      await this.copyRecords!.updateOne(
        {
          id: attempt.id,
          protocol: attempt.protocol,
          row: attempt.row,
          state: attempt.state,
          gateId: attempt.gateId,
          'definition.protocol': attempt.definition.protocol,
          'definition.definitionHash': attempt.definition.definitionHash,
          'permission.authorizationId': permission.authorizationId,
          'permission.permissionHash': permission.permissionHash,
          versionRecord: { $exists: false },
        },
        { $set: { versionRecord: record } },
        { session },
      ).exec(),
    );
    return record;
  }

  private async prepareInitialHistoricalPutPermission(
    pins: ItemHistoricalPutPermissionRecordInput,
    gate: ItemCopyGateRecord,
    attempt: ItemHistoricalPutAttemptV2Record,
    session: ClientSession,
  ) {
    const config = this.sourceProfileConfirmation;
    if (!config?.permissionEvidenceFor) throw this.unavailable();
    await this.assertCopyRecordIdentityAvailable(pins.authorizationId, session);

    let profile: ItemSourceProfileRecord | undefined;
    await config.profiles.fenceActiveSourceProfile(
      pins.expectedProfile,
      session,
      (checked) => {
        profile = checked;
      },
    );
    if (!profile) throw this.unavailable();
    if (profile.controlsHash !== pins.expectedControlsHash) {
      if (!config.profiles.fenceActiveSharedControls) throw this.unavailable();
      await config.profiles.fenceActiveSharedControls(
        pins.expectedControlsHash,
        session,
      );
    }
    const evidence = config.permissionEvidenceFor(pins, attempt.definition);
    if (
      !evidence ||
      evidence.transportRequestHash !== pins.transportRequestHash
    )
      throw new ConflictError(
        'The exact held artifact and transport request evidence is required',
      );

    return buildInitialHistoricalPutPermission(gate, attempt, {
      ...evidence,
      authorizationId: pins.authorizationId,
      expectedGateRevision: pins.expectedGateRevision,
      activeProfile: profile,
      checkedAt: config.now().getTime(),
    });
  }

  private async checkInitialCopyAttempt(
    attempt:
      | ItemCopyAttemptRecord
      | ItemHistoricalPutAttemptRecord
      | ItemHistoricalPutAttemptV2Record,
    session: ClientSession,
    gate: ItemCopyGateRecord,
  ) {
    const previous = await this.copyRecords!.findOne({ id: attempt.id })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    if (previous) {
      const cannotReplace = () =>
        new ConflictError(
          'The original historical PUT attempt cannot be replaced',
        );
      if ('sourceArtifactMetadata' in attempt) {
        try {
          this.matchStoredHistoricalPutV2(previous, attempt, gate);
        } catch (error) {
          if (error instanceof ConflictError) throw cannotReplace();
          throw error;
        }
      } else if (
        attempt.definition.protocol !== 'ITEM_COPY_ATTEMPT_INTENT_V1'
      ) {
        if (
          'delegationBound' in previous ||
          archiveHash(previous) !== archiveHash(attempt)
        )
          throw cannotReplace();
      } else {
        matchItemCopyAttempt(
          previous as ItemCopyAttemptRecord,
          attempt as ItemCopyAttemptRecord,
        );
      }
      return true;
    }
    await this.assertInitialCopySlot(attempt, session);
    return false;
  }

  private async assertInitialCopySlot(
    attempt: Pick<ItemCopyAttemptRecord, 'id' | 'copyIntentId'>,
    session: ClientSession,
  ) {
    await this.assertCopyRecordIdentityAvailable(attempt.id, session);
    if (
      await this.copyRecords!.exists({
        row: 'ATTEMPT',
        copyIntentId: attempt.copyIntentId,
        ordinal: 1,
      })
        .session(session)
        .exec()
    )
      throw new ConflictError(
        'The logical copy intent already has its initial attempt',
      );
  }

  private async assertCopyRecordIdentityAvailable(
    id: string,
    session: ClientSession,
  ) {
    if (
      await this.copyRecords!.exists({ identityIds: id })
        .session(session)
        .exec()
    )
      throw new ConflictError('The copy record identity has already been used');
  }

  private async readHistoricalAttempt(
    input: Omit<ItemSourceDelegationBoundInput, 'signerContextHash'>,
    context: ItemCopyIntentContext,
    gateId: string,
    session: ClientSession,
  ) {
    const row = await this.copyRecords!.findOne({ id: input.attemptId })
      .select({ _id: 0 })
      .session(session)
      .lean()
      .exec();
    if (
      row?.row !== 'ATTEMPT' ||
      row.definition?.protocol !== 'ITEM_COPY_ATTEMPT_INTENT_V1' ||
      row.definition?.definitionHash !== input.expectedAttemptDefinitionHash
    )
      throw new ConflictError(
        'The expected historical attempt changed or is absent',
      );
    const expected = newItemCopyAttempt(
      context,
      {
        preparation: input.preparation,
        kind: 'HISTORICAL',
        attemptId: input.attemptId,
        dispatcherInstanceId: row.definition.dispatcherInstanceId,
        origin: 'INITIAL',
        expectedGateRevision: input.expectedGateRevision,
      },
      gateId,
    );
    return {
      attempt: expected,
      bound: matchItemCopyAttempt(row as ItemCopyAttemptRecord, expected),
    };
  }
  private sourceBoundReceipt(
    bound: ItemSourceDelegationBound,
    gateRevision: number,
    replayed: boolean,
  ): ItemSourceDelegationBoundReceipt {
    return Object.freeze({
      bound,
      gateRevision,
      replayed,
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
  }
  private async evaluatePersistedSourceWindow(
    input: ItemSourceWindowAssessmentInput,
    context: ItemCopyIntentContext,
    material: ItemHistoricalSourceAnchorMaterial,
    gateId: string,
    session: ClientSession,
  ): Promise<SourceWindowAssessment> {
    const config = this.sourceProfileConfirmation;
    if (!config?.assessment || !config.profiles.readActiveSourceAccreditation)
      throw this.unavailable();
    const observation = context.file.sourceProfileObservationSet;
    if (!observation)
      throw new ConflictError(
        'The original source observation set is required',
      );
    const { attempt: expected, bound } = await this.readHistoricalAttempt(
      { ...input, preparation: input.anchor.preparation },
      context,
      gateId,
      session,
    );
    const accredited = await config.profiles.readActiveSourceAccreditation(
      input.expectedProfile,
      session,
    );
    if (!accredited)
      throw new ConflictError(
        'The source operational accreditation is required',
      );
    const { profile, accreditation } = accredited;
    const { expectedBucketOwner, boundFor } = config.assessment;
    const expectedBoundHash = input.expectedBoundHash;
    if (expectedBoundHash === undefined && !boundFor) throw this.unavailable();
    const readBound =
      expectedBoundHash === undefined
        ? (boundFor?.(
            expected.definition.definitionHash,
            profile.signerContextHash,
          ) ?? undefined)
        : undefined;
    const now = config.now().getTime();
    if (!Number.isFinite(now))
      throw new ConflictError('The source assessment clock is invalid');
    const evaluation = {
      material,
      observation,
      expectedBucketOwner,
      currentProfile: profile,
      accreditation,
      attempt: expected.definition,
      evaluatedAt: new Date(now).toISOString(),
    };
    return expectedBoundHash === undefined
      ? evaluateItemSourceReadWindow({ ...evaluation, readBound })
      : evaluateRecordedItemSourceReadWindow(
          evaluation,
          bound,
          expectedBoundHash,
        );
  }
  private changed(result: { matchedCount: number; modifiedCount: number }) {
    if (result.matchedCount !== 1 || result.modifiedCount !== 1)
      throw new ConflictError('The item capture admission fence changed');
  }
}
