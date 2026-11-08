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
import {
  ItemCaptureAdmission,
  ItemCaptureInput,
  ItemCaptureProgress,
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
  buildItemHistoricalCopyIntent,
  historicalCopyPreparationInput,
  historicalSourceAnchorInput,
} from '../../../domain/transfer-item-copy-intent';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';
import { fenceArchiveReservation } from './archive-reservation-fence';
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
  ItemSourceProfileObservationSet,
  ItemSourceProfileObservationReceipt,
  ItemSourceLastReadBound,
  ItemSourceDelegationBound,
  assertItemSourceProfileWindow,
  captureItemSourceProfileObservationSet,
  evaluateItemSourceReadWindow,
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
  ItemCopyRecordStore,
  ItemCopyRecord,
  ItemCopyGateRecord,
  ItemCopyRecordReceipt,
  ItemCopyDeclarationInput,
  ItemCopyRevocationInput,
  ItemCopyAttemptRecord,
  ItemSourceWindowAssessmentInput,
  ItemSourceDelegationBoundInput,
  ItemSourceDelegationBoundReceipt,
  copyDeclarationInput,
  copyRevocationInput,
  buildItemCopyGate,
  captureItemCopyGate,
  newItemCopyGate,
  newItemCopyAttempt,
  matchItemCopyAttempt,
  nextCopyGateRevision,
  sourceWindowAssessmentInput,
  sourceDelegationBoundInput,
} from '../../../domain/transfer-item-copy-record';
import {
  ITEM_COPY_RECORD_MODEL,
  ITEM_COPY_RECORD_COLLECTION,
} from './transfer-item-copy-record.schema';
import { MongoItemSourceProfileState } from './mongo-item-source-profile-state';
type SourceProfileConfirmation = Readonly<{
  profiles: Pick<MongoItemSourceProfileState, 'fenceActiveSourceProfile'> &
    Partial<Pick<MongoItemSourceProfileState, 'readActiveSourceAccreditation'>>;
  now: () => Date;
  assessment?: Readonly<{
    expectedBucketOwner: string;
    /** Local trusted lookup only. Do not call a provider while holding the snapshot. */
    boundFor: (
      attemptDefinitionHash: string,
      signerContextHash: string,
    ) => ItemSourceLastReadBound | null;
  }>;
}>;
type SourceWindowAssessment = ReturnType<typeof evaluateItemSourceReadWindow>;
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
type CopyRecordAction =
  | { mode: 'READ' }
  | { mode: 'OPEN' }
  | { mode: 'REVOKE'; input: ItemCopyRevocationInput }
  | { mode: 'DECLARE'; input: ItemCopyDeclarationInput }
  | { mode: 'ASSESS_SOURCE_WINDOW'; input: ItemSourceWindowAssessmentInput }
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
      copy: Extract<CopyRecordAction, { mode: 'OPEN' | 'REVOKE' | 'DECLARE' }>;
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
  private async transaction(
    input: ItemCaptureInput,
    admit:
      | boolean
      | 'inspect'
      | { copy: CopyRecordAction }
      | { manifest: ItemManifestReadInput }
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
    | ItemManifestPreparationReceipt
    | ItemStagingCopyPreparationReceipt
    | ItemCopyGateRecord
    | ItemCopyRecordReceipt
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
        | ItemManifestPreparationReceipt
        | ItemStagingCopyPreparationReceipt
        | ItemCopyGateRecord
        | ItemCopyRecordReceipt
        | SourceWindowAssessment
        | ItemSourceDelegationBoundReceipt
        | null;
    const copy =
      typeof admit === 'object' && 'copy' in admit ? admit.copy : undefined;
    const sourceWindow =
      copy?.mode === 'ASSESS_SOURCE_WINDOW' ? copy.input : undefined;
    const preparation =
      copy?.mode === 'DECLARE' || copy?.mode === 'SOURCE_BOUND'
        ? copy.input.preparation
        : (sourceWindow?.anchor.preparation ??
          (typeof admit === 'object' && 'historical' in admit
            ? admit.historical
            : undefined));
    const manifest =
      typeof admit === 'object' && 'manifest' in admit
        ? admit.manifest
        : undefined;
    const digestPreparation =
      typeof admit === 'object' && 'digest' in admit ? admit : undefined;
    const expectedManifestHash =
      sourceWindow?.anchor.expectedManifestHash ??
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
    const manifestModels = !!manifest || !!digestPreparation;
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
        ...(preparation || manifestModels ? [this.files] : []),
        ...(manifestModels ? [this.entries] : []),
        ...(copy ? [this.copyRecords] : []),
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
        ...(preparation || manifestModels
          ? ['animal_ownership_archive_files']
          : []),
        ...(manifestModels ? ['animal_ownership_archive_entries'] : []),
        ...(copy ? [ITEM_COPY_RECORD_COLLECTION] : []),
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
        ...(copy
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
        ...(preparation || manifestModels
          ? [
              { name: 'animal_ownership_archive_files', key: { id: 1 } },
              {
                name: 'animal_ownership_archive_files',
                key: { archiveId: 1, sourceKey: 1 },
              },
            ]
          : []),
        ...(manifestModels
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
              ...(digestPreparation || expectedManifestHash !== undefined
                ? { manifestDigest: 1 }
                : {}),
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
          if (admit === 'inspect')
            return inspectItemCopyPreparation(input, snapshot);
          let gate: ItemCopyGateRecord | undefined;
          let priorGate: ItemCopyGateRecord | undefined;
          let attempt: ItemCopyAttemptRecord | undefined;
          let boundWrite:
            | {
                attempt: ItemCopyAttemptRecord;
                bound: ItemSourceDelegationBound;
              }
            | undefined;
          let copyReplayed = false;
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
            } else {
              if (!priorGate || priorGate.state !== 'OPEN')
                throw new ConflictError(
                  'An original open copy gate is required',
                );
              if (priorGate.revision !== copy.input.expectedGateRevision)
                throw new ConflictError(
                  'The expected copy gate revision changed',
                );
              if (copy.mode === 'DECLARE')
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
            const inspection = inspectItemCopyPreparation(input, snapshot);
            if (inspection.observedSealHash !== manifest.expectedSealHash)
              throw new ConflictError(
                'The expected manifest capture seal changed',
              );
            const { phase, afterId } = manifest.cursor;
            if (phase === 'COMPLETE') return Object.freeze({ phase, snapshot });
            const filter = {
              archiveId: archive!.id,
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
                      retained: 1,
                    })
                    .collation({ locale: 'simple' })
                    .sort({ id: 1 })
                    .limit(ITEM_MANIFEST_PAGE_SIZE)
                    .setOptions({ singleBatch: true, maxTimeMS: 5000 })
                    .session(active)
                    .lean()
                    .exec();
            let previous = afterId ?? '';
            if (!Array.isArray(rows) || rows.length > ITEM_MANIFEST_PAGE_SIZE)
              throw new ConflictError(
                'The manifest page exceeds its read boundary',
              );
            for (const row of rows) {
              if (
                !row ||
                typeof row.id !== 'string' ||
                !/^[a-f0-9]{64}$/.test(row.id) ||
                row.id <= previous ||
                row.archiveId !== archive!.id
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
          let prepared: ItemArchiveCopyIntent | undefined;
          let replayed = false;
          let staging:
            | ReturnType<typeof buildStagingCopyPreparation>
            | undefined;
          let stagingReplayed = false;
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
              const previous = await this.copyRecords!.findOne({
                id: attempt.id,
              })
                .select({ _id: 0 })
                .session(active)
                .lean()
                .exec();
              if (previous) {
                matchItemCopyAttempt(
                  previous as ItemCopyAttemptRecord,
                  attempt,
                );
                copyReplayed = true;
              } else {
                if (
                  await this.copyRecords!.exists({ identityIds: attempt.id })
                    .session(active)
                    .exec()
                )
                  throw new ConflictError(
                    'The copy record identity has already been used',
                  );
                if (
                  await this.copyRecords!.exists({
                    row: 'ATTEMPT',
                    copyIntentId: attempt.copyIntentId,
                    ordinal: 1,
                  })
                    .session(active)
                    .exec()
                )
                  throw new ConflictError(
                    'The logical copy intent already has its initial attempt',
                  );
              }
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
            if (hasObservation !== hasStaging || (hasObservation && !replayed))
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
              if (sourceWindow)
                return this.evaluatePersistedSourceWindow(
                  sourceWindow,
                  context,
                  material,
                  priorGate!.id,
                  active,
                );
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
              } else return material;
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
            return Object.freeze({
              gateId: gate.id,
              gateRevision: gate.revision,
              state: gate.state,
              replayed: copyReplayed,
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
          if (preparation && prepared && staging) {
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
                        historicalByteObservation: staging.observation,
                        stagingCopyIntent: staging.intent,
                      },
                    },
                    { session: active },
                  )
                  .exec(),
              );
            return Object.freeze({
              transferId: input.transferId,
              itemId: input.itemId,
              fileId: preparation.fileId,
              intentId: staging.intent.id,
              intentDefinitionHash: staging.intent.definitionHash,
              observationHash: staging.observation.observationHash,
              replayed: stagingReplayed,
              reservation: 'FENCED_AT_PREPARATION' as const,
              provenance: 'NOT_ASSESSED' as const,
              stableCut: 'NOT_ASSESSED' as const,
              retention: 'NOT_ASSESSED' as const,
              copyDispatch: 'NOT_AUTHORIZED' as const,
              businessCommit: 'NOT_AUTHORIZED' as const,
            });
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
    return { attempt: expected, bound: matchItemCopyAttempt(row, expected) };
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
    const { attempt: expected } = await this.readHistoricalAttempt(
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
    const readBound = boundFor(
      expected.definition.definitionHash,
      profile.signerContextHash,
    );
    const now = config.now().getTime();
    if (!Number.isFinite(now))
      throw new ConflictError('The source assessment clock is invalid');
    return evaluateItemSourceReadWindow({
      material,
      observation,
      expectedBucketOwner,
      currentProfile: profile,
      accreditation,
      attempt: expected.definition,
      readBound: readBound ?? undefined,
      evaluatedAt: new Date(now).toISOString(),
    });
  }
  private changed(result: { matchedCount: number; modifiedCount: number }) {
    if (result.matchedCount !== 1 || result.modifiedCount !== 1)
      throw new ConflictError('The item capture admission fence changed');
  }
}
