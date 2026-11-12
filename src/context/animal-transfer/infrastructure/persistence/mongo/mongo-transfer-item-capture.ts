import {
  Injectable,
  HttpException,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, STATES } from 'mongoose';
import { DomainError } from '../../../../shared/domain/DomainError';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
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
  OwnershipArchive,
  ArchiveFile,
  ArchiveEntry,
  archiveHash,
} from '../../../domain/ownership-archive';
import {
  ItemRecipientFinalMediaRegistration,
  TransferredMediaRegistration,
  assertSameMediaRegistration,
  buildItemRecipientFinalMediaRegistration,
} from '../../../domain/ownership-archive-media-registration';
import {
  RequestClaim,
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
  buildItemHistoricalCopyIntent,
  historicalCopyPreparationInput,
  historicalSourceAnchorInput,
} from '../../../domain/transfer-item-copy-intent';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';
import {
  assertArchiveCallerTransaction,
  fenceArchiveReservation,
} from './archive-reservation-fence';
import type { ArchiveProjectionUrls } from '../../../domain/ownership-archive-recipient-projection';
import {
  ItemRecipientProjectionSelection,
  itemRecipientProjectionSelection,
} from '../../../domain/transfer-item-recipient-projection-selection';
import {
  ITEM_STABLE_CUT_SCOPE_PROTOCOL,
  ItemStableCutCopyInventory,
  ItemStableCutScope,
  buildItemStableCutScope,
  itemStableCutAttemptPin,
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
} from '../../../domain/transfer-item-manifest-digest';
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
    return this.readSelectedRecipientProjection(raw, session, urls);
  }

  readItemStableCutScopeWithinTransaction(
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
  ): Promise<
    SelectedRecipientProjection & Readonly<{ scope: ItemStableCutScope }>
  >;
  private async readSelectedRecipientProjection(
    raw: ItemRecipientProjectionSelection,
    session: ClientSession,
    urls: ArchiveProjectionUrls,
    retained?: ItemStableCutRetainedVersions,
  ) {
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
      const selection = itemRecipientProjectionSelection(raw);
      const { expectedPreparedCoverageHash, expectedProjectionHash, ...input } =
        selection;
      const { snapshot } = await this.readCaptureSnapshot(
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
        throw new ConflictError(
          'The selected item projection manifest changed',
        );

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
          scope: buildItemStableCutScope(selection, inventory, {
            fileCount: retained.fileCount,
            versionsDigest: retained.versionsDigest,
            conservationControlsHashes: [...retained.controls].sort(),
          }),
        });
      }
      return Object.freeze({ selection, projection });
    } catch (error) {
      if (session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      throw error;
    }
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
          const { request, item, claim, archive } = snapshot;
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
                version: input.expectedRequestVersion,
                recipientId: input.actorId,
                decisionOperationId: input.decisionOperationId,
                'acceptanceStart.bindingHash':
                  request!.acceptanceStart!.bindingHash,
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
  private async readCaptureSnapshot(
    input: ItemCaptureInput,
    active: ClientSession,
    includeManifestDigest: boolean,
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
    const assessment = assessItemCapture(input, snapshot);
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
    attempt?: Exclude<ItemCopyRecord, ItemCopyGateRecord>,
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
