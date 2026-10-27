import { randomUUID } from 'node:crypto';
import { Connection, Model, Types } from 'mongoose';
import {
  AnimalDocument,
  AnimalEntity,
  AnimalSchema,
} from '../../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';
import { AnimalMediaUpload } from '../../../../src/context/animal-media/domain/animal-media-upload';
import {
  MEDIA_PROMOTION_STORAGE_PROTOCOL,
  PromotionRow,
  PromotionStoredCommand,
} from '../../../../src/context/animal-media/domain/media-promotion-persistence';
import {
  MEDIA_PROMOTION_RECORD_MODEL,
  MediaPromotionRecordSchema,
} from '../../../../src/context/animal-media/infrastructure/media-promotion-record.schema';
import {
  ANIMAL_MEDIA_UPLOAD_MODEL,
  AnimalMediaUploadSchema,
  MongoAnimalMediaUploadRepository,
} from '../../../../src/context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import { MongoMediaPromotionPersistence } from '../../../../src/context/animal-media/infrastructure/mongo-media-promotion-persistence';
import { AnimalWriteJournal } from '../../../../src/context/animal-transfer/domain/animal-write-journal';
import {
  AnimalOwnershipControlDocument,
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodDocument,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { MongoAnimalOwnershipRepository } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import {
  ANIMAL_WRITE_JOURNAL_MODEL,
  AnimalWriteJournalSchema,
  MongoAnimalWriteJournal,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';
import { promotionFixture } from '../../fixtures/media-promotion.fixture';
import {
  LocalMongoTestSettings,
  WRITE_TEST_MARKER,
} from './local-mongo-test-safety';
import {
  assertOwnedPromotionTestDatabase,
  createPromotionTestNamespace,
  readMediaPromotionMongoSettings,
} from './media-promotion-mongo-safety';
import { PromotionRaceGate } from './promotion-race-gate';
import { WriteMongoFixture } from './write-mongo-fixture';

function createSide(connection: Connection) {
  const gate = new PromotionRaceGate();
  const journalSchema = AnimalWriteJournalSchema.clone();
  journalSchema.pre('updateOne', async function () {
    const update = this.getUpdate() as {
      $inc?: { mediaPromotionRevision?: number };
      $set?: { callbackSettledAt?: string };
    };
    if (update.$inc?.mediaPromotionRevision !== undefined)
      await gate.before('JOURNAL_FENCE');
    if (update.$set?.callbackSettledAt !== undefined)
      await gate.before('CALLBACK_SETTLE');
  });
  const controlSchema = AnimalOwnershipControlSchema.clone();
  controlSchema.pre('updateOne', async function () {
    const update = this.getUpdate() as {
      $inc?: { mediaPromotionRevision?: number };
    };
    if (update.$inc?.mediaPromotionRevision !== undefined)
      await gate.before('CONTROL_FENCE');
  });
  const recordSchema = MediaPromotionRecordSchema.clone();
  recordSchema.pre('updateOne', async function () {
    if (this.getFilter().kind !== 'GATE') return;
    await gate.before('GATE_WRITE');
    if (gate.failGateCas) {
      gate.failGateCas = false;
      // Real zero-match update AFTER tentative row/fence writes; no mock result.
      this.setQuery({ _id: new Types.ObjectId() });
    }
  });
  const records = connection.model<PromotionRow>(
    MEDIA_PROMOTION_RECORD_MODEL,
    recordSchema,
  );
  const journals = connection.model<AnimalWriteJournal>(
    ANIMAL_WRITE_JOURNAL_MODEL,
    journalSchema,
  );
  const controls = connection.model<AnimalOwnershipControlEntity>(
    AnimalOwnershipControlEntity.name,
    controlSchema,
  );
  const uploads = connection.model<AnimalMediaUpload>(
    ANIMAL_MEDIA_UPLOAD_MODEL,
    AnimalMediaUploadSchema.clone(),
  );
  // Constructor dependencies only: no period/animal collections are created.
  const periods = connection.model<AnimalOwnershipPeriodDocument>(
    AnimalOwnershipPeriodEntity.name,
    AnimalOwnershipPeriodSchema.clone(),
  );
  const animals = connection.model<AnimalDocument>(
    AnimalEntity.name,
    AnimalSchema.clone(),
  );
  return {
    connection,
    gate,
    records,
    journals,
    controls,
    uploads,
    journal: new MongoAnimalWriteJournal(journals),
    uploadRepository: new MongoAnimalMediaUploadRepository(uploads),
    ownership: new MongoAnimalOwnershipRepository(
      periods,
      controls as unknown as Model<AnimalOwnershipControlDocument>,
      animals,
      journals,
    ),
    repository: new MongoMediaPromotionPersistence(
      records,
      journals,
      controls,
      uploads,
    ),
  };
}
export type PromotionMongoSide = ReturnType<typeof createSide>;

/** New namespace per case. No Nest bootstrap, environment loading or AWS client. */
export class MediaPromotionMongoFixture extends WriteMongoFixture {
  override readonly namespace = createPromotionTestNamespace();
  left!: PromotionMongoSide;
  right!: PromotionMongoSide;

  protected override assertOwnership(
    name: string,
    marker: unknown,
    collections: string[],
  ): void {
    assertOwnedPromotionTestDatabase(this.namespace, name, marker, collections);
  }
  protected override monitoredCommands(): string[] {
    return [...super.monitoredCommands(), 'insert'];
  }

  override async open(settings: LocalMongoTestSettings): Promise<void> {
    // Defense in depth for direct fixture callers, before createConnection.
    const checked = readMediaPromotionMongoSettings({
      MEDIA_PROMOTION_MONGO_TESTS: '1',
      MEDIA_PROMOTION_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    console.info(
      `Disposable promotion-test database: ${this.namespace.databaseName}`,
    );
    const first = await this.connect(checked, 'left');
    const db = first.db!;
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length)
      throw new Error(
        'Generated integration database was not empty; setup refused',
      );
    await db.createCollection(WRITE_TEST_MARKER);
    await db
      .collection<{ _id: string; runId: string }>(WRITE_TEST_MARKER)
      .insertOne(
        { _id: 'owner', runId: this.namespace.runId },
        { writeConcern: { w: 'majority' } },
      );
    this.ownsDatabase = true;
    this.left = createSide(first);
    for (const model of [
      this.left.records,
      this.left.journals,
      this.left.controls,
      this.left.uploads,
    ]) {
      await model.createCollection();
      await model.createIndexes();
    }
    this.right = createSide(await this.connect(checked, 'right'));
  }

  async seedPromotion(
    kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
    permit = true,
    optIn = true,
  ) {
    const f = promotionFixture(kind);
    const { journal: j, animalId } = f;
    const handle = { id: j.id, instanceId: j.instanceId };
    const selection = { operationId: j.id, instanceId: j.instanceId, animalId };
    const at = j.createdAt;
    await this.left.controls.create(
      [{ animalId, ownerId: j.actorId, ownershipVersion: 2 }],
      { w: 'majority' },
    );
    // Deliberately construct the initial record; never retag a MAY_RUN journal.
    await this.left.journal.create({
      ...handle,
      protocol: j.protocol,
      ...(optIn
        ? { mediaPromotionProtocol: MEDIA_PROMOTION_STORAGE_PROTOCOL }
        : {}),
      actorId: j.actorId,
      kind,
      instanceStartedAt: at,
      createdAt: at,
      updatedAt: at,
      issuesUploadUrl: false,
      lifecycle: 'OPEN',
      callback: 'NOT_STARTED',
      claims: [{ animalId, state: 'NOT_ATTEMPTED', updatedAt: at }],
    });
    await this.left.journal.claim(handle, animalId, 'INTENT', at, 2);
    const acquired = await this.left.ownership.beginWrite({
      animalId,
      ownerId: j.actorId,
      expectedOwnershipVersion: 2,
      token: j.id,
      startedAt: at,
      journal: { operationId: j.id, instanceId: j.instanceId },
    });
    if (!acquired)
      throw new Error('Synthetic promotion claim was not acquired');
    if (permit) await this.left.journal.permitCallback(handle, at);
    const { pinned, ...unsealed } = f.upload;
    await this.left.uploadRepository.create(unsealed);
    await this.left.uploadRepository.pin(f.upload.finalKey, pinned!); // Synthetic pin, no S3 read.
    const declaration: PromotionStoredCommand = {
      type: 'DECLARE_EFFECT',
      effectId: f.effectId,
      uploadId: f.upload.id,
      bucket: 'animalrecord-test-media',
    };
    const intention: PromotionStoredCommand = {
      type: 'INTEND_ATTEMPT',
      effectId: f.effectId,
      attemptId: f.attemptId,
      dispatcherInstanceId: f.id(10),
      origin: 'INITIAL',
    };
    const authorize: PromotionStoredCommand = {
      type: 'AUTHORIZE_ATTEMPT',
      effectId: f.effectId,
      attemptId: f.attemptId,
      dispatcherInstanceId: f.id(10),
      authorizationId: f.id(11),
    };
    const audit = {
      requestId: randomUUID(),
      operatorId: randomUUID(),
      evidenceRef: 'test:promotion-revocation',
    };
    return {
      ...f,
      handle,
      selection,
      declaration,
      intention,
      authorize,
      audit,
      prepare: async () => {
        await this.left.repository.open(selection);
        await this.left.repository.apply(selection, 0, declaration);
        return this.left.repository.apply(selection, 1, intention);
      },
    };
  }

  async snapshot() {
    const s = this.right;
    return {
      records: await s.records
        .find()
        .sort({ id: 1 })
        .read('primary')
        .readConcern('majority')
        .lean()
        .exec(),
      journal: await s.journals
        .findOne()
        .read('primary')
        .readConcern('majority')
        .lean()
        .exec(),
      control: await s.controls
        .findOne()
        .read('primary')
        .readConcern('majority')
        .lean()
        .exec(),
    };
  }

  override async drain(): Promise<void> {
    this.left?.gate.releaseAll();
    this.right?.gate.releaseAll();
    await super.drain();
  }
}
