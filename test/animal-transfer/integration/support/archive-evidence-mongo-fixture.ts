import { randomUUID } from 'node:crypto';
import { ClientSession, Connection, Types } from 'mongoose';
import { OwnershipPeriodStartProvenance } from '../../../../src/context/animal-transfer/domain/animal-ownership';
import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchive,
} from '../../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ArchiveEvidenceConsumptionRequest,
  archiveEvidenceHash,
} from '../../../../src/context/animal-transfer/domain/ownership-archive-evidence-consumption';
import { ArchiveMediaRegistration } from '../../../../src/context/animal-transfer/domain/ownership-archive-media-registration';
import { ArchiveMetadataRevalidation } from '../../../../src/context/animal-transfer/domain/ownership-archive-metadata-revalidation';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
  AnimalOwnershipPeriodStatus,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { MongoOwnershipArchiveMetadataRevalidation } from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-metadata-revalidation';
import {
  OwnershipArchiveSchema,
  OwnershipArchiveEntrySchema,
  OwnershipArchiveFileSchema,
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import {
  OwnershipArchiveMediaRegistrationSchema,
  OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-media-registration.schema';
import {
  OwnershipArchiveMetadataRevalidationSchema,
  OWNERSHIP_ARCHIVE_METADATA_REVALIDATION_MODEL,
} from '../../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-metadata-revalidation.schema';
import { historyKeyFromUrl } from '../../fixtures/ownership-archive-history.fixture';
import { metadataRevalidationFixture } from '../../fixtures/ownership-archive-metadata-revalidation.fixture';
import {
  assertOwnedEvidenceTestDatabase,
  createEvidenceTestNamespace,
} from './archive-evidence-mongo-safety';
import {
  LocalMongoTestSettings,
  WRITE_TEST_MARKER,
} from './local-mongo-test-safety';
import { EvidenceRaceGate } from './evidence-race-gate';
import { WriteMongoFixture } from './write-mongo-fixture';

function createSide(connection: Connection) {
  const gate = new EvidenceRaceGate();
  const controlSchema = AnimalOwnershipControlSchema.clone();
  controlSchema.pre('updateOne', async function () {
    await gate.before('CONTROL');
  });
  const archiveSchema = OwnershipArchiveSchema.clone();
  archiveSchema.pre('updateOne', async function () {
    await gate.before('HEADER');
  });
  const runSchema = OwnershipArchiveMetadataRevalidationSchema.clone();
  runSchema.pre('updateOne', async function () {
    await gate.before('RUN');
    const set = (this.getUpdate() as { $set?: { consumption?: unknown } })
      ?.$set;
    if (set?.consumption && gate.failRunCas) {
      gate.failRunCas = false;
      // Force a real zero-match update, not a fabricated Mongo result.
      this.setQuery({ _id: new Types.ObjectId() });
    }
  });
  const controls = connection.model<AnimalOwnershipControlEntity>(
    AnimalOwnershipControlEntity.name,
    controlSchema,
  );
  const periods = connection.model<AnimalOwnershipPeriodEntity>(
    AnimalOwnershipPeriodEntity.name,
    AnimalOwnershipPeriodSchema.clone(),
  );
  const archives = connection.model<OwnershipArchive>(
    OWNERSHIP_ARCHIVE_MODEL,
    archiveSchema,
  );
  const entries = connection.model<ArchiveEntry>(
    OWNERSHIP_ARCHIVE_ENTRY_MODEL,
    OwnershipArchiveEntrySchema.clone(),
  );
  const files = connection.model<ArchiveFile>(
    OWNERSHIP_ARCHIVE_FILE_MODEL,
    OwnershipArchiveFileSchema.clone(),
  );
  const registrations = connection.model<ArchiveMediaRegistration>(
    OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
    OwnershipArchiveMediaRegistrationSchema.clone(),
  );
  const runs = connection.model<ArchiveMetadataRevalidation>(
    OWNERSHIP_ARCHIVE_METADATA_REVALIDATION_MODEL,
    runSchema,
  );
  return {
    connection,
    gate,
    controls,
    periods,
    archives,
    entries,
    files,
    registrations,
    runs,
    repository: new MongoOwnershipArchiveMetadataRevalidation(
      runs,
      archives,
      entries,
      files,
      registrations,
      controls,
      periods,
      { keyFromUrl: historyKeyFromUrl },
    ),
  };
}
export type EvidenceMongoSide = ReturnType<typeof createSide>;

export const EVIDENCE_TRANSACTION_OPTIONS = {
  readConcern: { level: 'snapshot' as const },
  readPreference: 'primary' as const,
  writeConcern: { w: 'majority' as const },
  maxCommitTimeMS: 5000,
};

/** Fresh namespace per test, two independent clients; no app bootstrap or AWS. */
export class ArchiveEvidenceMongoFixture extends WriteMongoFixture {
  override readonly namespace = createEvidenceTestNamespace();
  left!: EvidenceMongoSide;
  right!: EvidenceMongoSide;

  protected override assertOwnership(
    name: string,
    marker: unknown,
    collections: string[],
  ): void {
    assertOwnedEvidenceTestDatabase(this.namespace, name, marker, collections);
  }
  protected override monitoredCommands(): string[] {
    return [...super.monitoredCommands(), 'insert', 'aggregate'];
  }

  override async open(settings: LocalMongoTestSettings): Promise<void> {
    console.info(
      `Disposable evidence-test database: ${this.namespace.databaseName}`,
    );
    const first = await this.connect(settings, 'left');
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
      this.left.controls,
      this.left.periods,
      this.left.archives,
      this.left.entries,
      this.left.files,
      this.left.registrations,
      this.left.runs,
    ]) {
      await model.createCollection();
      await model.createIndexes();
    }
    await db.createCollection('_synthetic_joint_writes');
    this.right = createSide(await this.connect(settings, 'right'));
  }

  async seedObserved(withFiles = true) {
    const fixture = metadataRevalidationFixture(withFiles ? 1 : 0, withFiles);
    const s = this.left;
    await s.archives.create(fixture.archive);
    await s.controls.create(fixture.control);
    await s.periods.create({
      id: fixture.archive.periodId,
      animalId: fixture.archive.animalId,
      ownerId: fixture.archive.ownerId,
      ownershipVersion: fixture.archive.ownershipVersion,
      status: AnimalOwnershipPeriodStatus.Active,
      startedAtKnown: false,
      startProvenance: OwnershipPeriodStartProvenance.Unknown,
    });
    await s.entries.insertMany(fixture.entries);
    if (fixture.files.length) await s.files.insertMany(fixture.files);
    if (fixture.registrations.length)
      await s.registrations.insertMany(fixture.registrations);
    const runId = randomUUID();
    let run = await s.repository.start(runId, fixture.archive.id);
    for (let pages = 0; run.phase !== 'METADATA_OBSERVED'; pages++) {
      if (pages >= 10)
        throw new Error('Synthetic metadata pagination did not finish');
      run = await s.repository.nextPage(runId, 100);
    }
    await s.repository.startS3(runId);
    const page = await s.repository.s3Page(runId, 20);
    // Explicitly synthetic S3 receipts: tests validate Mongo, never remote bytes.
    run = await s.repository.confirmS3(
      page,
      page.items.map((item) => ({
        fileId: item.fileId,
        revision: item.revision,
        sha256: item.intent.sha256,
      })),
    );
    const request: ArchiveEvidenceConsumptionRequest = {
      id: randomUUID(),
      runId,
      archiveId: fixture.archive.id,
      expectedRunRevision: run.revision,
      expectedEvidenceHash: archiveEvidenceHash(run),
    };
    return { fixture, request, run };
  }

  async joint(
    side: EvidenceMongoSide,
    request: ArchiveEvidenceConsumptionRequest,
    after?: (session: ClientSession) => Promise<void>,
  ) {
    const session = await side.connection.startSession();
    try {
      // Explicit transactions, no automatic callback replay in this harness.
      session.startTransaction(EVIDENCE_TRANSACTION_OPTIONS);
      const receipt = await side.repository.consumeWithinTransaction(
        request,
        session,
      );
      await side.connection
        .db!.collection<{ _id: string }>('_synthetic_joint_writes')
        .insertOne({ _id: request.id }, { session });
      await after?.(session);
      await session.commitTransaction();
      return receipt;
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async snapshot() {
    const s = this.right;
    return {
      archive: await s.archives
        .findOne()
        .read('primary')
        .readConcern('majority')
        .lean()
        .exec(),
      run: await s.runs
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
      joint: await s.connection
        .db!.collection('_synthetic_joint_writes')
        .find({}, { readConcern: { level: 'majority' } })
        .toArray(),
    };
  }

  override async drain(): Promise<void> {
    this.left?.gate.releaseAll();
    this.right?.gate.releaseAll();
    await super.drain();
  }
}
