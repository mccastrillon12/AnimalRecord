import { Connection, Schema } from 'mongoose';
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
import { TransferRequests } from '../../../../src/context/animal-transfer/application/transfer-requests';
import { OwnershipArchiveCapture } from '../../../../src/context/animal-transfer/application/ownership-archive-capture';
import { OwnershipArchivePreparer } from '../../../../src/context/animal-transfer/application/ownership-archive-preparer';
import { AnimalWriteCoordinator } from '../../../../src/context/animal-transfer/application/animal-write-coordinator';
import { AnimalWriteInstance } from '../../../../src/context/animal-transfer/application/animal-write-instance';
import { OwnershipArchiveStorage } from '../../../../src/context/animal-transfer/domain/ownership-archive';
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

function createSide(connection: Connection) {
  const gate = new AcceptanceRaceGate();
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
        if (
          (this.getUpdate() as { $set?: { status?: string } }).$set?.status ===
          'PROCESSING'
        )
          await gate.before('DECISION');
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
    entries: model(OWNERSHIP_ARCHIVE_ENTRY_MODEL, OwnershipArchiveEntrySchema),
    files: model(OWNERSHIP_ARCHIVE_FILE_MODEL, OwnershipArchiveFileSchema),
    journals: model(ANIMAL_WRITE_JOURNAL_MODEL, AnimalWriteJournalSchema),
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
  return {
    connection,
    gate,
    rows,
    ownership,
    repository,
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
    capture: new OwnershipArchiveCapture(
      ownership,
      repository,
      source,
      storage,
      preparer,
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
    const names = Object.values(this.left.rows).map(
      (m) => m.collection.collectionName,
    );
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
  async snapshot() {
    const result: Record<string, unknown> = {};
    for (const [role, model] of Object.entries(this.right.rows))
      result[role] = await model.collection.find({}).sort({ _id: 1 }).toArray();
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
