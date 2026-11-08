import { Connection, Schema } from 'mongoose';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AnimalEntity,
  AnimalSchema,
} from '../../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';
import { MongoAnimalRepository } from '../../../../src/context/animal/infrastructure/persistence/mongo/mongo-animal-repository';
import { AnimalAccessPolicy } from '../../../../src/context/animal/application/animal-access-policy';
import {
  UserEntity,
  UserSchema,
} from '../../../../src/context/user/infrastructure/persistence/mongo/user.schema';
import {
  DiaryEntryEntity,
  DiaryEntrySchema,
} from '../../../../src/context/diary/infrastructure/persistence/mongo/diary-entry.schema';
import {
  MedicalDocumentEntity,
  MedicalDocumentSchema,
} from '../../../../src/context/medical-document/infrastructure/persistence/mongo/medical-document.schema';
import {
  AnimalTransferReasonEntity,
  AnimalTransferReasonSchema,
} from '../../../../src/context/catalogs/infrastructure/persistence/mongo/catalogs.schema';
import { AnimalTransferReasonCode } from '../../../../src/context/catalogs/domain/animal-transfer-reason';
import {
  AnimalMediaUploadSchema,
  ANIMAL_MEDIA_UPLOAD_MODEL,
} from '../../../../src/context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import {
  TransferRequestSchema,
  TransferRequestItemSchema,
  TransferRequestClaimSchema,
  TransferNoticeSchema,
  TransferOutboxSchema,
  TransferEventSchema,
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
  TRANSFER_NOTICE_MODEL,
  TRANSFER_OUTBOX_MODEL,
  TRANSFER_EVENT_MODEL,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  OwnershipArchiveSchema,
  OwnershipArchiveEntrySchema,
  OwnershipArchiveFileSchema,
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import {
  ANIMAL_WRITE_JOURNAL_MODEL,
  AnimalWriteJournalSchema,
  MongoAnimalWriteJournal,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';
import { MongoAnimalOwnershipRepository } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import { MongoTransferRequests } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-requests';
import { MongoTransferAcceptancePreparation } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-acceptance-preparation';
import { MongoTransferAcceptanceStart } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-acceptance-start';
import { MongoOwnershipArchiveRepository } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-repository';
import { MongoOwnershipArchiveSource } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-source';
import { TransferAcceptancePreparation } from '../../../../src/context/animal-transfer/application/transfer-acceptance-preparation';
import { TransferAcceptanceStart } from '../../../../src/context/animal-transfer/application/transfer-acceptance-start';
import { TransferItemCapture } from '../../../../src/context/animal-transfer/application/transfer-item-capture';
import { ItemHistoricalCopyObserver } from '../../../../src/context/animal-transfer/application/item-historical-copy-observer';
import { ItemStagingCopyPreparer } from '../../../../src/context/animal-transfer/application/item-staging-copy-preparer';
import { ItemSourceObservationPreparer } from '../../../../src/context/animal-transfer/application/item-source-observation-preparer';
import { ItemManifestObserver } from '../../../../src/context/animal-transfer/application/item-manifest-observer';
import { ItemManifestPreparer } from '../../../../src/context/animal-transfer/application/item-manifest-preparer';
import { ItemManifestDigestInput } from '../../../../src/context/animal-transfer/domain/transfer-item-manifest-digest';
import { MongoTransferItemCapture } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import {
  ITEM_SOURCE_PROFILE_STATE_COLLECTION,
  ItemSourceProfileStateRow,
  MongoItemSourceProfileState,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-item-source-profile-state';
import {
  ITEM_COPY_RECORD_MODEL,
  ItemCopyRecordSchema,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-item-copy-record.schema';
import { TransferRequests } from '../../../../src/context/animal-transfer/application/transfer-requests';
import { OwnershipArchiveCapture } from '../../../../src/context/animal-transfer/application/ownership-archive-capture';
import { OwnershipArchivePreparer } from '../../../../src/context/animal-transfer/application/ownership-archive-preparer';
import { AnimalWriteCoordinator } from '../../../../src/context/animal-transfer/application/animal-write-coordinator';
import { AnimalWriteInstance } from '../../../../src/context/animal-transfer/application/animal-write-instance';
import {
  ArchiveFile,
  ArchiveEntry,
  ObjectRevision,
  OwnershipArchiveStorage,
  archiveHash,
  buildArchiveEntry,
} from '../../../../src/context/animal-transfer/domain/ownership-archive';
import { AcceptanceSelection } from '../../../../src/context/animal-transfer/domain/transfer-acceptance-preparation';
import {
  ItemHistoricalCopyPreparationInput,
  ItemHistoricalSourceAnchorInput,
} from '../../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  HistoricalReadTarget,
  ItemHistoricalObjectReader,
  ItemSourceRetentionTarget,
  ItemSourceProfileObservationInput,
} from '../../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { transferRecordId } from '../../../../src/context/animal-transfer/domain/transfer-record-id';
import {
  LocalMongoTestSettings,
  WRITE_TEST_MARKER,
} from './local-mongo-test-safety';
import { WriteMongoFixture } from './write-mongo-fixture';
import {
  ACCEPTANCE_COLLECTIONS,
  assertOwnedAcceptanceDatabase,
  createAcceptanceNamespace,
  readAcceptanceMongoSettings,
} from './transfer-acceptance-mongo-safety';
import { AcceptanceRaceGate } from './transfer-acceptance-race-gate';
import { archiveAnimal } from '../../fixtures/ownership-archive.fixture';
import { otpActor, otpOther } from '../../fixtures/transfer-otp.fixture';
import { promotionTestId as id } from '../../fixtures/media-promotion.fixture';

/** Driver-command metadata only; never retains filters, payloads or raw commands. */
export function manifestFindMetadata(
  side: string,
  event: { commandName: string; command: Record<string, unknown> },
) {
  const command = event.command;
  if (
    event.commandName !== 'find' ||
    command.autocommit !== false ||
    ![
      'animal_ownership_archive_entries',
      'animal_ownership_archive_files',
    ].includes(command.find as string)
  )
    return null;
  return Object.freeze({
    side,
    collection: command.find as string,
    limit: typeof command.limit === 'number' ? command.limit : undefined,
    singleBatch: command.singleBatch === true,
    simpleCollation:
      (command.collation as { locale?: unknown } | undefined)?.locale ===
      'simple',
    ascendingId:
      (command.sort instanceof Map
        ? (command.sort as Map<string, unknown>).get('id')
        : (command.sort as { id?: unknown } | undefined)?.id) === 1,
    transactional: command.autocommit === false,
  });
}

/** In-memory object double only. Never creates a client or reads a real object. */
export class SyntheticHistoricalReader implements ItemHistoricalObjectReader {
  bytes = Buffer.from('animal-bytes');
  revision: ObjectRevision = {
    etag: 'synthetic-historical',
    size: 12,
    versionId: 'synthetic-historical-v1',
  };
  readonly calls: Array<'HEAD' | 'READ' | 'CLOSE'> = [];
  readonly targets: HistoricalReadTarget[] = [];
  assertOutsideTransaction?: () => void;
  private heads = 0;
  constructor(
    private readonly gate: AcceptanceRaceGate,
    private readonly kind: 'HISTORICAL' | 'SOURCE' | 'STAGING' = 'HISTORICAL',
  ) {
    if (kind === 'SOURCE')
      this.revision = {
        etag: 'synthetic-source',
        size: 12,
        versionId: 'synthetic-source-v1',
      };
    if (kind === 'STAGING')
      this.revision = {
        etag: 'synthetic-staging',
        size: 12,
        versionId: 'synthetic-staging-v1',
      };
  }
  async head(target: HistoricalReadTarget) {
    this.assertOutsideTransaction?.();
    this.calls.push('HEAD');
    this.targets.push(Object.freeze({ ...target }));
    const head = { ...target, ...this.revision };
    if (++this.heads % 2 === 0)
      await this.gate.before(
        this.kind === 'SOURCE'
          ? 'SOURCE_OBSERVED'
          : this.kind === 'STAGING'
            ? 'STAGING_OBSERVED'
            : 'HISTORICAL_OBSERVED',
      );
    return head;
  }
  async read(target: HistoricalReadTarget, revision: Readonly<ObjectRevision>) {
    this.assertOutsideTransaction?.();
    this.calls.push('READ');
    this.targets.push(Object.freeze({ ...target }));
    const fixed = {
      etag: revision.etag,
      size: revision.size,
      ...(revision.versionId === undefined
        ? {}
        : { versionId: revision.versionId }),
    };
    await this.gate.before(
      this.kind === 'SOURCE'
        ? 'SOURCE_READ'
        : this.kind === 'STAGING'
          ? 'STAGING_READ'
          : 'HISTORICAL_READ',
    );
    const body = Readable.from([Buffer.from(this.bytes)]);
    return {
      revision: fixed,
      body,
      close: () => {
        this.assertOutsideTransaction?.();
        this.calls.push('CLOSE');
        body.destroy();
      },
    };
  }
}

function createSide(connection: Connection) {
  const gate = new AcceptanceRaceGate();
  const db = connection.db!;
  const sourceProfileRows = db.collection<ItemSourceProfileStateRow>(
    ITEM_SOURCE_PROFILE_STATE_COLLECTION,
  );
  // Give the adapter this native handle so tests can pause its exact operations.
  const collection = jest
    .spyOn(db, 'collection')
    .mockImplementationOnce((name) => {
      if (name !== ITEM_SOURCE_PROFILE_STATE_COLLECTION)
        throw new Error(
          'Unexpected native collection for source profile adapter',
        );
      // The driver handle is the same at runtime for either collection type.
      return sourceProfileRows as unknown as ReturnType<typeof db.collection>;
    });
  let sourceProfiles: MongoItemSourceProfileState;
  try {
    sourceProfiles = new MongoItemSourceProfileState(db);
  } finally {
    collection.mockRestore();
  }
  function model<T>(
    name: string,
    source: Schema<T>,
    configure?: (schema: Schema<T>) => void,
  ) {
    const schema = source.clone();
    schema.set('autoCreate', false);
    schema.set('autoIndex', false);
    configure?.(schema);
    return connection.model<T>(name, schema);
  }
  const rows = {
    requests: model(TRANSFER_REQUEST_MODEL, TransferRequestSchema, (schema) => {
      schema.pre('updateOne', async function () {
        const set = (this.getUpdate() as { $set?: Record<string, unknown> })
          .$set;
        if (set?.status === 'PROCESSING') await gate.before('DECISION');
        if (set?.captureStepRevision !== undefined)
          await gate.before('CAPTURE_ADMISSION');
      });
    }),
    items: model(
      TRANSFER_REQUEST_ITEM_MODEL,
      TransferRequestItemSchema,
      (schema) => {
        schema.pre('find', async function () {
          await gate.before('SNAPSHOT');
        });
        schema.pre('updateOne', async function () {
          await gate.before('ITEM');
        });
        schema.pre('updateMany', async function () {
          await gate.before('REJECT_ITEMS');
        });
      },
    ),
    claims: model(
      TRANSFER_REQUEST_CLAIM_MODEL,
      TransferRequestClaimSchema,
      (schema) => {
        schema.pre('updateOne', async function () {
          await gate.before('CLAIM');
        });
        schema.pre('deleteMany', async function () {
          await gate.before('RELEASE_CLAIMS');
        });
      },
    ),
    animals: model(AnimalEntity.name, AnimalSchema, (schema) => {
      schema.pre('updateOne', async function () {
        await gate.before('PROFILE');
      });
    }),
    controls: model(
      AnimalOwnershipControlEntity.name,
      AnimalOwnershipControlSchema,
      (schema) => {
        schema.pre('updateOne', async function () {
          const inc = (this.getUpdate() as { $inc?: Record<string, unknown> })
            .$inc;
          if (inc?.reservationEpoch) await gate.before('ACQUIRE');
          if (inc?.archivePreparationRevision) await gate.before('FENCE');
        });
      },
    ),
    periods: model(
      AnimalOwnershipPeriodEntity.name,
      AnimalOwnershipPeriodSchema,
    ),
    medical: model(MedicalDocumentEntity.name, MedicalDocumentSchema),
    diary: model(DiaryEntryEntity.name, DiaryEntrySchema),
    media: model(ANIMAL_MEDIA_UPLOAD_MODEL, AnimalMediaUploadSchema),
    archives: model(
      OWNERSHIP_ARCHIVE_MODEL,
      OwnershipArchiveSchema,
      (schema) => {
        schema.pre('findOne', async function () {
          await gate.before('CAPTURE_SNAPSHOT');
          await gate.before('MANIFEST_SNAPSHOT');
        });
        schema.pre('updateOne', async function () {
          const set = (this.getUpdate() as { $set?: Record<string, unknown> })
            .$set;
          if (set?.manifestDigest !== undefined)
            await gate.before('MANIFEST_DIGEST');
        });
        schema.pre('save', async function () {
          await gate.before('HEADER');
        });
      },
    ),
    events: model(TRANSFER_EVENT_MODEL, TransferEventSchema, (schema) => {
      schema.pre('save', async function () {
        await gate.before('EVENT');
      });
    }),
    users: model(UserEntity.name, UserSchema),
    entries: model(
      OWNERSHIP_ARCHIVE_ENTRY_MODEL,
      OwnershipArchiveEntrySchema,
      (schema) => {
        schema.pre('find', async function () {
          if (this.getOptions().singleBatch === true)
            await gate.before('MANIFEST_ROWS');
        });
      },
    ),
    files: model(
      OWNERSHIP_ARCHIVE_FILE_MODEL,
      OwnershipArchiveFileSchema,
      (schema) => {
        schema.pre('find', async function () {
          if (this.getOptions().singleBatch === true)
            await gate.before('MANIFEST_ROWS');
        });
        schema.pre('findOne', async function () {
          await gate.before('HISTORICAL_SNAPSHOT');
        });
        schema.pre('updateOne', async function () {
          const set = (this.getUpdate() as { $set?: Record<string, unknown> })
            .$set;
          if (set?.historicalCopyIntent !== undefined)
            await gate.before('HISTORICAL_INTENT');
          if (set?.stagingCopyIntent !== undefined)
            await gate.before('STAGING_INTENT');
          if (set?.sourceByteObservation !== undefined)
            await gate.before('SOURCE_OBSERVATION');
          if (set?.sourceRetentionObservation !== undefined)
            await gate.before('SOURCE_RETENTION_WRITE');
          if (set?.sourceProfileObservationSet !== undefined)
            await gate.before('SOURCE_PROFILE_SET_WRITE');
          if (set?.stagingByteObservation !== undefined)
            await gate.before('STAGING_OBSERVATION');
        });
      },
    ),
    journals: model(ANIMAL_WRITE_JOURNAL_MODEL, AnimalWriteJournalSchema),
    copyRecords: model(
      ITEM_COPY_RECORD_MODEL,
      ItemCopyRecordSchema,
      (schema) => {
        schema.pre('save', async function () {
          await gate.before(
            this.row === 'GATE' ? 'COPY_GATE_INSERT' : 'COPY_ATTEMPT_INSERT',
          );
        });
        schema.pre('updateOne', async function () {
          await gate.before('COPY_GATE_CAS');
        });
      },
    ),
    reasons: model(AnimalTransferReasonEntity.name, AnimalTransferReasonSchema),
    notices: model(TRANSFER_NOTICE_MODEL, TransferNoticeSchema),
    outbox: model(TRANSFER_OUTBOX_MODEL, TransferOutboxSchema),
  };
  const args = [
    rows.requests,
    rows.items,
    rows.claims,
    rows.animals,
    rows.controls,
    rows.periods,
    rows.medical,
  ] as const;
  const keys = {
    keyFromUrl: (url: string) =>
      url.startsWith('https://acceptance.invalid/')
        ? url.slice('https://acceptance.invalid/'.length)
        : undefined,
  };
  const forbidden = () => {
    throw new Error(
      'Storage I/O forbidden: this fixture proves only Mongo behavior',
    );
  };
  const storage: OwnershipArchiveStorage = {
    keyFromUrl: keys.keyFromUrl,
    assertTransferSafe: () => Promise.resolve(),
    inspect: forbidden,
    copyAndVerify: forbidden,
  };
  // Hydrated model type aliases differ between existing constructors. All of
  // these are real Mongoose models on this connection, never query-result doubles.
  const ownership = new MongoAnimalOwnershipRepository(
    rows.periods as never,
    rows.controls as never,
    rows.animals as never,
    rows.journals,
  );
  const repository = new MongoOwnershipArchiveRepository(
    rows.archives,
    rows.entries,
    rows.files,
    rows.periods,
    rows.controls,
  );
  const source = new MongoOwnershipArchiveSource(
    rows.animals as never,
    rows.diary as never,
    rows.medical as never,
    rows.periods,
  );
  const preparer = new OwnershipArchivePreparer(ownership, repository, storage);
  const requestStore = new MongoTransferRequests(
    rows.requests,
    rows.items,
    rows.claims,
    rows.notices,
    rows.outbox,
    rows.events,
    rows.users,
    rows.reasons,
    rows.animals,
    rows.controls,
  );
  const startStore = new MongoTransferAcceptanceStart(
    ...args,
    rows.diary,
    rows.media,
    rows.archives,
    rows.events,
    rows.users,
    keys,
  );
  const capture = new OwnershipArchiveCapture(
    ownership,
    repository,
    source,
    storage,
    preparer,
  );
  // Barriers surround the real callback, outside its Mongo transactions. No
  // query/checkpoint/commit result is replaced; storage remains forbidden.
  const batch: Pick<OwnershipArchiveCapture, 'captureBatch'> = {
    async captureBatch(...args) {
      await gate.before('CAPTURE_CALL');
      const result = await capture.captureBatch(...args);
      await gate.before('CAPTURE_RETURN');
      return result;
    },
  };
  const sourceRetentionReader = {
    expectedBucketOwner: '123456789012',
    observedAt: '2026-11-07T15:00:00.000Z',
    reportedRetainUntil: '2027-01-01T00:00:00.000Z',
    targets: [] as ItemSourceRetentionTarget[],
    readSourceRetention(target: ItemSourceRetentionTarget) {
      sourceRetentionReader.targets.push(Object.freeze({ ...target }));
      return Promise.resolve({
        expectedBucketOwner: sourceRetentionReader.expectedBucketOwner,
        mode: 'COMPLIANCE' as const,
        reportedRetainUntil: sourceRetentionReader.reportedRetainUntil,
      });
    },
  };
  const itemCaptureStore = new MongoTransferItemCapture(
    rows.requests,
    rows.items,
    rows.claims,
    rows.archives,
    rows.controls,
    rows.periods,
    rows.files,
    rows.entries,
    rows.copyRecords,
    {
      profiles: sourceProfiles,
      now: () => new Date(sourceRetentionReader.observedAt),
    },
  );
  const historicalReader = new SyntheticHistoricalReader(gate);
  const historicalObserver = new ItemHistoricalCopyObserver(
    itemCaptureStore,
    historicalReader,
  );
  const sourceReader = new SyntheticHistoricalReader(gate, 'SOURCE');
  const sourceObserver = new ItemHistoricalCopyObserver(
    itemCaptureStore,
    sourceReader,
  );
  const stagingReader = new SyntheticHistoricalReader(gate, 'STAGING');
  const stagingObserver = new ItemHistoricalCopyObserver(
    itemCaptureStore,
    stagingReader,
  );
  const manifestPages: Array<{ phase: string; count?: number }> = [];
  const manifestObserver = new ItemManifestObserver(
    {
      async readHistoricalSourceForAnchor(input) {
        await gate.before('HISTORICAL_SOURCE_ANCHOR');
        return itemCaptureStore.readHistoricalSourceForAnchor(input);
      },
      async readManifestPage(input) {
        const page = await itemCaptureStore.readManifestPage(input);
        manifestPages.push({
          phase: page.phase,
          ...('rows' in page ? { count: page.rows.length } : {}),
        });
        if (page.phase === 'FILES' && page.rows.length === 0)
          await gate.before('MANIFEST_TERMINAL');
        return page;
      },
    },
    keys.keyFromUrl,
    {
      reader: {
        readSourceRetention: (target) =>
          sourceRetentionReader.readSourceRetention(target),
        async readFixedSource(
          target: HistoricalReadTarget,
          revision: Readonly<ObjectRevision>,
        ) {
          return {
            ...(await sourceReader.read(target, revision)),
            expectedBucketOwner: sourceRetentionReader.expectedBucketOwner,
            fixedRetainUntil: sourceRetentionReader.reportedRetainUntil,
            mode: 'COMPLIANCE' as const,
            eventHold: 'OFF' as const,
            storage: {
              encryption: 'SSE_S3' as const,
              storageClass: 'OMITTED' as const,
              restoreOrArchiveReported: false,
            },
          };
        },
      },
      now: () => new Date(sourceRetentionReader.observedAt),
      profiles: sourceProfiles,
    },
  );
  const manifestCollector = {
    async observeHistoricalSourceProfile(
      input: ItemSourceProfileObservationInput,
    ) {
      const result =
        await manifestObserver.observeHistoricalSourceProfile(input);
      await gate.before('SOURCE_PROFILE_SET_OBSERVED');
      return result;
    },
    async observeHistoricalSourceRetention(
      input: ItemHistoricalSourceAnchorInput,
    ) {
      const result =
        await manifestObserver.observeHistoricalSourceRetention(input);
      await gate.before('SOURCE_RETENTION_OBSERVED');
      return result;
    },
    async observe(input: ItemManifestDigestInput) {
      const result = await manifestObserver.observe(input);
      await gate.before('MANIFEST_OBSERVED');
      return result;
    },
  };
  return {
    connection,
    gate,
    rows,
    sourceProfileRows,
    sourceProfiles,
    ownership,
    repository,
    storage,
    requestStore,
    startStore,
    prepare: new TransferAcceptancePreparation(
      new MongoTransferAcceptancePreparation(...args),
    ),
    start: new TransferAcceptanceStart(startStore),
    // Only rejection/list/detail are used; proof creation/consumption is outside this harness.
    requests: new TransferRequests(requestStore, {
      consume: forbidden,
    } as never),
    capture,
    batch,
    itemCaptureStore,
    itemCapture: new TransferItemCapture(itemCaptureStore, batch),
    historicalReader,
    historicalObserver,
    sourceReader,
    sourceObserver,
    source: new ItemSourceObservationPreparer(itemCaptureStore, sourceObserver),
    stagingReader,
    stagingObserver,
    staging: new ItemStagingCopyPreparer(itemCaptureStore, {
      observe: (input) => historicalObserver.observe(input),
      observeStaging: (input) => stagingObserver.observeStaging(input),
    }),
    manifestPages,
    manifestObserver,
    sourceRetentionReader,
    manifestPreparer: new ItemManifestPreparer(
      itemCaptureStore,
      manifestCollector,
      sourceRetentionReader.expectedBucketOwner,
    ),
    writer: new AnimalWriteCoordinator(
      new AnimalAccessPolicy(
        new MongoAnimalRepository(rows.animals as never),
        ownership,
      ),
      ownership,
      new MongoAnimalWriteJournal(rows.journals),
      new AnimalWriteInstance(),
    ),
  };
}
export type AcceptanceSide = ReturnType<typeof createSide>;
export class TransferAcceptanceMongoFixture extends WriteMongoFixture {
  override readonly namespace = createAcceptanceNamespace();
  left!: AcceptanceSide;
  right!: AcceptanceSide;
  readonly manifestFinds: Array<
    NonNullable<ReturnType<typeof manifestFindMetadata>>
  > = [];
  protected override async connect(
    settings: LocalMongoTestSettings,
    side: string,
  ): Promise<Connection> {
    const connection = await super.connect(settings, side);
    connection.getClient().on('commandStarted', (event) => {
      const metadata = manifestFindMetadata(side, event);
      if (metadata) this.manifestFinds.push(metadata);
    });
    return connection;
  }
  protected override assertOwnership(
    name: string,
    marker: unknown,
    collections: string[],
  ) {
    assertOwnedAcceptanceDatabase(this.namespace, name, marker, collections);
  }
  protected override clientTimeoutMS(): undefined {
    return undefined;
  } // Same app/driver bulkWrite bounds as the flow harness.
  protected override monitoredCommands() {
    return [
      ...super.monitoredCommands(),
      'insert',
      'delete',
      'findAndModify',
      'getMore',
      'listCollections',
      'listIndexes',
      'create',
      'drop',
      'dropDatabase',
      'listDatabases',
    ];
  }
  override async open(settings: LocalMongoTestSettings) {
    const checked = readAcceptanceMongoSettings({
      TRANSFER_ACCEPTANCE_MONGO_TESTS: '1',
      TRANSFER_ACCEPTANCE_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    console.info(
      `Disposable acceptance-test database: ${this.namespace.databaseName}`,
    );
    const connection = await this.connect(checked, 'left'),
      db = connection.db!;
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length)
      throw new Error(
        'Generated acceptance database was not empty; setup refused',
      );
    await db.createCollection(WRITE_TEST_MARKER);
    await db
      .collection<{ _id: string; runId: string }>(WRITE_TEST_MARKER)
      .insertOne(
        { _id: 'owner', runId: this.namespace.runId },
        { writeConcern: { w: 'majority' } },
      );
    this.ownsDatabase = true;
    this.left = createSide(connection);
    const names = [
      ...Object.values(this.left.rows).map((m) => m.collection.collectionName),
      this.left.sourceProfileRows.collectionName,
    ];
    if (
      names.length !== ACCEPTANCE_COLLECTIONS.length - 1 ||
      new Set(names).size !== names.length ||
      names.some(
        (name) => !(ACCEPTANCE_COLLECTIONS as readonly string[]).includes(name),
      )
    )
      throw new Error(
        'Acceptance models must exactly match their allowlist before DDL',
      );
    for (const model of Object.values(this.left.rows)) {
      await model.createCollection();
      await model.createIndexes();
    }
    await db.createCollection(this.left.sourceProfileRows.collectionName);
    this.right = createSide(await this.connect(checked, 'right'));
  }
  async seedAcceptance(count = 3) {
    const r = this.left.rows,
      at = new Date().toISOString();
    const animalIds = Array.from({ length: count }, (_, n) => id(100 + n)),
      transferId = id(1);
    await r.users.collection.insertMany([
      { id: otpActor, name: 'Ana', identificationNumber: 'synthetic-100' },
      { id: otpOther, name: 'Luis', identificationNumber: 'synthetic-200' },
    ]);
    await r.animals.collection.insertMany(
      animalIds.map((animalId, n) => ({
        ...structuredClone(archiveAnimal),
        id: animalId,
        ownerId: otpActor,
        code: `AR-${n}`,
        isActive: true,
      })),
    );
    await r.controls.collection.insertMany(
      animalIds.map((animalId) => ({
        animalId,
        ownerId: otpActor,
        ownershipVersion: 1,
        activeWrites: [],
      })),
    );
    await r.periods.collection.insertMany(
      animalIds.map((animalId, n) => ({
        id: id(1000 + n),
        animalId,
        ownerId: otpActor,
        ownershipVersion: 1,
        status: 'ACTIVE',
        startedAt: at,
        startedAtKnown: true,
        startProvenance: 'CREATED',
      })),
    );
    // Synthetic already-persisted request/proof metadata, not OTP or signup execution.
    await r.requests.create(
      [
        {
          _id: transferId,
          senderId: otpActor,
          senderName: 'Ana',
          recipientId: otpOther,
          recipientName: 'Luis',
          reasonCode: AnimalTransferReasonCode.Other,
          reasonName: 'Otro',
          status: 'PENDING',
          version: 1,
          createdAt: at,
          animalCount: count,
          bodyHash: 'a'.repeat(64),
          authorizationChallengeId: id(50),
        },
      ],
      { w: 'majority' },
    );
    await r.items.create(
      animalIds.map((animalId, n) => ({
        _id: transferRecordId('item', transferId, animalId),
        transferId,
        animalId,
        animalName: 'Brownie',
        animalCode: `AR-${n}`,
        expectedOwnerId: otpActor,
        expectedOwnershipVersion: 1,
        status: 'PENDING',
      })),
      { w: 'majority' },
    );
    await r.claims.create(
      animalIds.map((animalId) => ({ _id: animalId, transferId })),
      { w: 'majority' },
    );
    await r.events.create(
      [
        {
          _id: transferRecordId('created', transferId),
          transferId,
          actorId: otpActor,
          type: 'REQUEST_CREATED',
          createdAt: at,
        },
      ],
      { w: 'majority' },
    );
    return {
      actorId: otpOther,
      transferId,
      operationId: id(2),
      expectedVersion: 1,
      acceptedAnimalIds: animalIds.slice(0, 2),
      animalIds,
    };
  }
  /** Synthetic sealed metadata only: no capture with files, S3 pinning or byte verification. */
  async seedHistoricalCopy(input: AcceptanceSelection, versioned = true) {
    const receipt = await this.left.start.start(input);
    const selected = receipt.binding.selected[0];
    const rows = this.left.rows;
    const archive = (await rows.archives
      .findOne({ id: selected.archiveId })
      .lean()
      .exec())!;
    const key = `users/${archive.ownerId}/animals/${archive.animalId}/profile/photo.jpg`;
    const built = buildArchiveEntry(
      archive,
      {
        kind: 'ANIMAL',
        data: {
          ...archiveAnimal,
          id: archive.animalId,
          ownerId: archive.ownerId,
          profilePictureUrl: `https://acceptance.invalid/${key}`,
        },
      },
      (url) => url.slice('https://acceptance.invalid/'.length),
    );
    const definition = {
      ...built.files[0],
      source: {
        etag: 'synthetic-source',
        size: 12,
        ...(versioned ? { versionId: 'synthetic-source-v1' } : {}),
      },
    };
    const file: ArchiveFile = {
      ...definition,
      definitionHash: archiveHash(definition),
      state: 'PENDING',
    };
    await rows.entries.create([built.entry], { w: 'majority' });
    await rows.files.create([file], { w: 'majority' });
    const saved = await rows.archives
      .updateOne(
        { id: archive.id, state: 'COLLECTING' },
        {
          $set: {
            state: 'COPYING',
            capture: { revision: 3, phase: 'COMPLETE', entryCount: 1 },
            expectedEntryCount: 1,
            expectedFileCount: 1,
          },
        },
        { writeConcern: { w: 'majority' } },
      )
      .exec();
    if (saved.modifiedCount !== 1)
      throw new Error('Synthetic sealed manifest setup failed');
    const selector = {
      actorId: input.actorId,
      transferId: input.transferId,
      itemId: selected.itemId,
      decisionOperationId: input.operationId,
      expectedRequestVersion: receipt.requestVersion,
      expectedCaptureRevision: 3,
    };
    const observation =
      await this.left.itemCapture.inspectCopyPreparation(selector);
    const preparation: ItemHistoricalCopyPreparationInput = {
      selector,
      fileId: file.id,
      expectedFileDefinitionHash: file.definitionHash,
      expectedSealHash: observation.observedSealHash,
      bucket: 'synthetic-archive-bucket',
      sourceSha256: 'a'.repeat(64),
    };
    return { selected, file, preparation };
  }
  /** Original decision/reservation + synthetic file metadata and local bytes, no copy. */
  async seedStagingCopy(input: AcceptanceSelection) {
    const seeded = await this.seedHistoricalCopy(input);
    const preparation = {
      ...seeded.preparation,
      sourceSha256: createHash('sha256')
        .update(this.left.historicalReader.bytes)
        .digest('hex'),
    };
    await this.left.itemCapture.prepareHistoricalCopy(preparation);
    return { ...seeded, preparation };
  }
  /** Original reservation with synthetic source metadata/bytes. Never reads S3. */
  async seedSourceObservation(input: AcceptanceSelection, versioned = true) {
    const seeded = await this.seedHistoricalCopy(input, versioned);
    const { file } = seeded;
    for (const side of [this.left, this.right])
      side.sourceReader.revision = { ...file.source };
    const preparation = {
      ...seeded.preparation,
      expectedFileDefinitionHash: file.definitionHash,
      sourceSha256: createHash('sha256')
        .update(this.left.sourceReader.bytes)
        .digest('hex'),
    };
    await this.left.itemCapture.prepareHistoricalCopy(preparation);
    return { ...seeded, preparation };
  }
  /** Persist the complete predecessor chain; all historical/staging bytes are synthetic. */
  async seedStagingObservation(input: AcceptanceSelection, versioned = true) {
    const seeded = await this.seedStagingCopy(input);
    await this.left.staging.prepare(seeded.preparation);
    if (!versioned)
      for (const side of [this.left, this.right])
        delete side.stagingReader.revision.versionId;
    return seeded;
  }
  /** Synthetic sealed rows only. No capture with files, byte reads or physical copies. */
  async seedManifest(
    input: AcceptanceSelection,
    count = 1,
    withFiles = true,
    payloadBytes = 0,
  ) {
    const receipt = await this.left.start.start(input),
      selected = receipt.binding.selected[0];
    const rows = this.left.rows;
    const archive = (await rows.archives
      .findOne({ id: selected.archiveId })
      .lean()
      .exec())!;
    const prefix = `users/${archive.ownerId}/animals/${archive.animalId}/`;
    const keys = (url: string) =>
      url.startsWith('https://acceptance.invalid/')
        ? url.slice('https://acceptance.invalid/'.length)
        : undefined;
    const built = [
      buildArchiveEntry(
        archive,
        {
          kind: 'ANIMAL',
          data: {
            ...archiveAnimal,
            id: archive.animalId,
            ownerId: archive.ownerId,
            ...(withFiles
              ? {
                  profilePictureUrl: `https://acceptance.invalid/${prefix}profile/photo.jpg`,
                }
              : {}),
          },
        },
        keys,
      ),
      ...Array.from({ length: count - 1 }, (_, i) =>
        buildArchiveEntry(
          archive,
          {
            kind: 'DIARY_ENTRY',
            data: {
              id: id(1000 + i),
              animalId: archive.animalId,
              title: `Synthetic manifest entry ${i}`,
              date: '2026-11-02',
              createdAt: '2026-11-02',
              updatedAt: '2026-11-02',
              ...(payloadBytes ? { content: 'x'.repeat(payloadBytes) } : {}),
              attachments: withFiles
                ? [
                    {
                      id: id(2000 + i),
                      fileName: 'synthetic.jpg',
                      fileType: 'image',
                      mimeType: 'image/jpeg',
                      size: 12,
                      createdAt: '2026-11-02',
                      url: `https://acceptance.invalid/${prefix}diary/manifest-${i}.jpg`,
                    },
                  ]
                : [],
            },
          },
          keys,
        ),
      ),
    ];
    const entries: ArchiveEntry[] = built.map((b) => b.entry);
    const files = new Map<string, ArchiveFile>();
    for (const row of built)
      for (const file of row.files) {
        const definition = {
          ...file,
          source: {
            etag: 'synthetic-source',
            size: 12,
            versionId: 'synthetic-source-v1',
          },
        };
        files.set(file.id, {
          ...definition,
          definitionHash: archiveHash(definition),
          state: 'PENDING',
        });
      }
    await rows.entries.create(entries, { w: 'majority' });
    if (files.size)
      await rows.files.create([...files.values()], { w: 'majority' });
    const saved = await rows.archives
      .updateOne(
        { id: archive.id, state: 'COLLECTING' },
        {
          $set: {
            state: 'COPYING',
            capture: { revision: 3, phase: 'COMPLETE', entryCount: count },
            expectedEntryCount: count,
            expectedFileCount: files.size,
          },
        },
        { writeConcern: { w: 'majority' } },
      )
      .exec();
    if (saved.modifiedCount !== 1)
      throw new Error('Synthetic manifest setup failed');
    const selector = {
      actorId: input.actorId,
      transferId: input.transferId,
      itemId: selected.itemId,
      decisionOperationId: input.operationId,
      expectedRequestVersion: receipt.requestVersion,
      expectedCaptureRevision: 3,
    };
    const observation =
      await this.left.itemCapture.inspectCopyPreparation(selector);
    return {
      selected,
      archiveId: archive.id,
      entries,
      files: [...files.values()],
      manifest: { selector, expectedSealHash: observation.observedSealHash },
    };
  }
  /** Persist anchor prerequisites using the same sealed-manifest and synthetic source paths. */
  async seedHistoricalSourceAnchor(
    input: AcceptanceSelection,
    count = 3,
    payloadBytes = 0,
  ) {
    const seeded = await this.seedManifest(input, count, true, payloadBytes);
    const file = [...seeded.files]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .at(-1);
    if (!file)
      throw new Error('Anchor fixture requires at least one source file');
    const preparation: ItemHistoricalCopyPreparationInput = {
      ...seeded.manifest,
      fileId: file.id,
      expectedFileDefinitionHash: file.definitionHash,
      bucket: 'synthetic-archive-bucket',
      sourceSha256: createHash('sha256')
        .update(this.left.sourceReader.bytes)
        .digest('hex'),
    };
    for (const side of [this.left, this.right])
      side.sourceReader.revision = { ...file.source };
    await this.left.itemCapture.prepareHistoricalCopy(preparation);
    const source = await this.left.source.prepare(preparation);
    const manifest = await this.left.manifestPreparer.prepare(seeded.manifest);
    return {
      ...seeded,
      source,
      anchor: { preparation, expectedManifestHash: manifest.manifestHash },
    };
  }
  async snapshot() {
    const result: Record<string, unknown> = {};
    for (const [role, model] of Object.entries(this.right.rows))
      result[role] = await model.collection.find({}).sort({ _id: 1 }).toArray();
    result.sourceProfileStates = await this.right.sourceProfileRows
      .find({})
      .sort({ _id: 1 })
      .toArray();
    return result;
  }
  override async drain() {
    this.left?.gate.releaseAll();
    this.right?.gate.releaseAll();
    await super.drain();
  }
  override async close() {
    let failure: unknown;
    try {
      await this.drain();
      if (this.ownsDatabase) {
        const db = this.connections[0].db!;
        const marker = await db
          .collection<{ _id: string; runId: string }>(WRITE_TEST_MARKER)
          .findOne({ _id: 'owner' });
        const names = await db
          .listCollections({}, { nameOnly: true })
          .toArray();
        this.assertOwnership(
          db.databaseName,
          marker?.runId,
          names.map((r) => r.name),
        );
        await db.dropDatabase({ writeConcern: { w: 'majority' } });
        this.ownsDatabase = false;
        const remaining = await db.admin().listDatabases({
          nameOnly: true,
          filter: { name: this.namespace.databaseName },
        });
        if (remaining.databases.length)
          throw new Error('Acceptance namespace absence could not be verified');
        console.info(
          `Acceptance-test namespace verified absent: ${this.namespace.databaseName}`,
        );
      }
    } catch (error) {
      failure = error;
    }
    const closed = await Promise.allSettled(
      this.connections.map((c) => c.close()),
    );
    if (failure !== undefined)
      throw failure instanceof Error
        ? failure
        : new Error('Acceptance cleanup failed');
    if (closed.some((r) => r.status === 'rejected'))
      throw new Error('Acceptance connection cleanup failed');
  }
}
