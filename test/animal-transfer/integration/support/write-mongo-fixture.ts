import { randomUUID } from 'node:crypto';
import { Connection, createConnection, mongo } from 'mongoose';
import {
  AnimalDocument,
  AnimalEntity,
  AnimalSchema,
} from '../../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';
import { AnimalWriteRecovery } from '../../../../src/context/animal-transfer/application/animal-write-recovery';
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
import {
  assertOwnedWriteTestDatabase,
  createWriteTestNamespace,
  LocalMongoTestSettings,
  WRITE_TEST_MARKER,
} from './local-mongo-test-safety';
import { WriteRaceGate } from './write-race-gate';

export type WriteCommandEvidence = {
  side: string;
  command: string;
  collection?: string;
  transaction?: string;
  snapshot: boolean;
  majority: boolean;
};

function createSide(connection: Connection) {
  const gate = new WriteRaceGate();
  const schema = AnimalWriteJournalSchema.clone();
  schema.pre('updateOne', async function () {
    await gate.beforeWrite(this.getUpdate());
  });
  const journals = connection.model<AnimalWriteJournal>(
    ANIMAL_WRITE_JOURNAL_MODEL,
    schema,
  );
  const controls = connection.model<AnimalOwnershipControlDocument>(
    AnimalOwnershipControlEntity.name,
    AnimalOwnershipControlSchema.clone(),
  );
  // Constructor dependencies only; these collections are never created/seeded.
  const periods = connection.model<AnimalOwnershipPeriodDocument>(
    AnimalOwnershipPeriodEntity.name,
    AnimalOwnershipPeriodSchema.clone(),
  );
  const animals = connection.model<AnimalDocument>(
    AnimalEntity.name,
    AnimalSchema.clone(),
  );
  const ownership = new MongoAnimalOwnershipRepository(
    periods,
    controls,
    animals,
    journals,
  );
  return {
    connection,
    gate,
    journals,
    controls,
    ownership,
    journal: new MongoAnimalWriteJournal(journals),
    recovery: new AnimalWriteRecovery(ownership),
  };
}
export type WriteMongoSide = ReturnType<typeof createSide>;

/** Standalone models only: no Nest bootstrap, application .env, backfill or AWS. */
export class WriteMongoFixture {
  readonly namespace = createWriteTestNamespace();
  readonly commands: WriteCommandEvidence[] = [];
  a!: WriteMongoSide;
  b!: WriteMongoSide;
  protected connections: Connection[] = [];
  protected ownsDatabase = false;
  private restorers: Array<() => void> = [];
  private pending = new Set<Promise<unknown>>();

  async open(settings: LocalMongoTestSettings): Promise<void> {
    console.info(
      `Disposable write-test database: ${this.namespace.databaseName}`,
    );
    const first = await this.connect(settings, 'a');
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
    this.a = createSide(first);
    await this.a.controls.createCollection();
    await this.a.journals.createCollection();
    await this.a.controls.createIndexes();
    await this.a.journals.createIndexes();
    this.b = createSide(await this.connect(settings, 'b'));
  }

  protected assertOwnership(
    databaseName: string,
    markerRunId: unknown,
    collections: string[],
  ): void {
    assertOwnedWriteTestDatabase(
      this.namespace,
      databaseName,
      markerRunId,
      collections,
    );
  }

  protected monitoredCommands(): string[] {
    return [
      'update',
      'find',
      'commitTransaction',
      'abortTransaction',
      'createIndexes',
    ];
  }

  protected async connect(
    settings: LocalMongoTestSettings,
    side: string,
  ): Promise<Connection> {
    const connection = createConnection(settings.uri, {
      dbName: this.namespace.databaseName,
      directConnection: true,
      autoCreate: false,
      autoIndex: false,
      bufferCommands: false,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 10000,
      timeoutMS: 15000,
      maxPoolSize: 4,
      readPreference: 'primary',
      monitorCommands: true,
    });
    this.connections.push(connection); // Also close a partially opened connection.
    await connection.asPromise();
    const hello = (await connection.db!.admin().command({ hello: 1 })) as {
      setName?: string;
      isWritablePrimary?: boolean;
      msg?: string;
      logicalSessionTimeoutMinutes?: number;
    };
    if (
      hello.setName !== settings.replicaSet ||
      !hello.isWritablePrimary ||
      hello.msg === 'isdbgrid' ||
      typeof hello.logicalSessionTimeoutMinutes !== 'number'
    )
      throw new Error(
        'Integration requires a writable replica-set primary with sessions',
      );
    connection
      .getClient()
      .on('commandStarted', (event: mongo.CommandStartedEvent) => {
        if (!this.monitoredCommands().includes(event.commandName)) return;
        const command = event.command as Record<string, unknown>;
        // Retain only transport/protocol metadata, never queries, documents or URIs.
        this.commands.push({
          side,
          command: event.commandName,
          collection:
            typeof command[event.commandName] === 'string'
              ? (command[event.commandName] as string)
              : undefined,
          transaction:
            command.autocommit === false
              ? `${side}:${JSON.stringify(command.lsid)}:${String(command.txnNumber)}`
              : undefined,
          snapshot:
            (command.readConcern as { level?: unknown } | undefined)?.level ===
            'snapshot',
          majority:
            (command.writeConcern as { w?: unknown } | undefined)?.w ===
            'majority',
        });
      });
    return connection;
  }

  async seed(count = 2) {
    const animalIds = Array.from({ length: count }, () => randomUUID()).sort();
    const actorId = randomUUID(),
      id = randomUUID(),
      instanceId = randomUUID();
    const at = new Date().toISOString();
    await this.a.controls.create(
      animalIds.map((animalId) => ({
        animalId,
        ownerId: actorId,
        ownershipVersion: 1,
      })),
      { w: 'majority' },
    );
    const handle = { id, instanceId };
    await this.a.journal.create({
      ...handle,
      protocol: 'TRANSACTIONAL_CLAIMS_V1',
      actorId,
      kind: 'ANIMAL_UPDATE',
      instanceStartedAt: at,
      createdAt: at,
      updatedAt: at,
      issuesUploadUrl: false,
      lifecycle: 'OPEN',
      callback: 'NOT_STARTED',
      claims: animalIds.map((animalId) => ({
        animalId,
        state: 'NOT_ATTEMPTED',
        updatedAt: at,
      })),
    });
    for (const animalId of animalIds)
      await this.a.journal.claim(handle, animalId, 'INTENT', at, 1);
    const request = {
      operationId: id,
      instanceId,
      requestId: randomUUID(),
      operatorId: randomUUID(),
      reason: 'OPERATOR_INTERVENTION' as const,
      evidenceRef: `test:${randomUUID()}`,
    };
    return {
      animalIds,
      actorId,
      handle,
      request,
      acquire: (side: WriteMongoSide, index = 0) =>
        side.ownership.beginWrite({
          animalId: animalIds[index],
          ownerId: actorId,
          expectedOwnershipVersion: 1,
          token: id,
          startedAt: at,
          journal: { operationId: id, instanceId },
        }),
      control: (index = 0) =>
        this.a.controls
          .findOne({ animalId: animalIds[index] })
          .read('primary')
          .readConcern('majority')
          .lean()
          .exec(),
    };
  }

  /** Lose the application's observation AFTER an actual successful commit.
   * This is not a server/network fault or a simulated Mongo transaction. */
  loseNextCommitReply(side: WriteMongoSide): void {
    const start = side.connection.startSession.bind(side.connection);
    const spy = jest
      .spyOn(side.connection, 'startSession')
      .mockImplementation(async (...args) => {
        spy.mockRestore();
        const session = await start(...args);
        const transaction = session.withTransaction.bind(session);
        jest
          .spyOn(session, 'withTransaction')
          .mockImplementation(async (work, options) => {
            await transaction(work, options);
            throw new Error('Injected application commit reply loss');
          });
        return session;
      });
    this.restorers.push(() => spy.mockRestore());
  }

  observe<T>(operation: Promise<T>) {
    // Attach rejection handling immediately; assertion can wait for the barrier.
    const observed = operation.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    this.pending.add(observed);
    void observed.finally(() => this.pending.delete(observed));
    return observed;
  }

  async drain(): Promise<void> {
    this.a?.gate.releaseAll();
    this.b?.gate.releaseAll();
    for (const restore of this.restorers) restore();
    this.restorers = [];
    await Promise.allSettled([...this.pending]);
  }

  async close(): Promise<void> {
    await this.drain();
    let cleanupFailure: unknown;
    try {
      if (this.ownsDatabase) {
        const db = this.connections[0].db!;
        const marker = await db
          .collection<{ _id: string; runId: string }>(WRITE_TEST_MARKER)
          .findOne({ _id: 'owner' });
        const collections = await db
          .listCollections({}, { nameOnly: true })
          .toArray();
        this.assertOwnership(
          db.databaseName,
          marker?.runId,
          collections.map((row) => row.name),
        );
        await db.dropDatabase({ writeConcern: { w: 'majority' } });
        this.ownsDatabase = false;
      }
    } catch (error) {
      cleanupFailure = error;
    }
    const closed = await Promise.allSettled(
      this.connections.map((connection) => connection.close()),
    );
    if (cleanupFailure !== undefined)
      throw cleanupFailure instanceof Error
        ? cleanupFailure
        : new Error('Disposable database cleanup failed');
    if (closed.some((result) => result.status === 'rejected'))
      throw new Error('Integration connection cleanup failed');
  }
}
