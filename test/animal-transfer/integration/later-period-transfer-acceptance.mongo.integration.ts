import { type ClientSession } from 'mongoose';
import { MongoOwnershipArchiveHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';
import {
  type AcceptanceSide,
  TransferAcceptanceMongoFixture,
} from './support/transfer-acceptance-mongo-fixture';
import { readAcceptanceMongoSettings } from './support/transfer-acceptance-mongo-safety';

type Dossier = Awaited<ReturnType<typeof publishedLaterPeriod>>;
type ClosePins = Dossier['commitSelection'];

/** Seed the same original decision with two sealed dossiers. Evidence and file contents are synthetic. */
async function seedSecondTransfer(fixture: TransferAcceptanceMongoFixture) {
  const input = await fixture.seedAcceptance(3, '2026-10-29T11:59:00.000Z');
  const first = await publishedLaterPeriod('processing', { bothLater: true });
  const second = await publishedLaterPeriod('processing', {
    bothLater: true,
    selectedIndex: 1,
  });
  const rows = fixture.left.rows;
  const { _id, ...decision } = first.state.db.requests[0];
  expect(_id).toBe(input.transferId);
  expect(decision.acceptanceStart).toEqual(
    second.state.db.requests[0].acceptanceStart,
  );
  expect(
    await rows.requests
      .updateOne(
        { _id: input.transferId, status: 'PENDING' },
        { $set: decision },
      )
      .exec(),
  ).toMatchObject({ modifiedCount: 1 });
  await rows.users.collection.updateOne(
    { id: input.actorId },
    { $set: { transferRequestRevision: 1 } },
  );
  for (const dossier of [first, second]) {
    const { animalId, itemId } = dossier.expectedReceipt;
    const db = dossier.state.db;
    const { _id: seedItemId, ...item } = db.items.find(
      (row) => row._id === itemId,
    )!;
    expect(
      await rows.items
        .updateOne(
          { _id: String(seedItemId), status: 'PENDING' },
          { $set: item },
        )
        .exec(),
    ).toMatchObject({ modifiedCount: 1 });
    expect(
      await rows.claims
        .updateOne(
          { _id: animalId, transferId: input.transferId },
          { $set: { acceptanceOperationId: input.operationId } },
        )
        .exec(),
    ).toMatchObject({ modifiedCount: 1 });
    const control = db.controls.find((row) => row.animalId === animalId)!;
    expect(
      await rows.controls.collection.updateOne({ animalId }, { $set: control }),
    ).toMatchObject({ modifiedCount: 1 });
    const animal = Object.fromEntries(
      Object.entries(dossier.live.animal).filter(
        ([, value]) => value !== undefined,
      ),
    );
    expect(
      await rows.animals.collection.updateOne(
        { id: animalId },
        { $set: animal },
      ),
    ).toMatchObject({ modifiedCount: 1 });
    const periods = db.periods.filter((row) => row.animalId === animalId);
    expect(
      await rows.periods.collection.updateOne(
        { animalId, status: 'ACTIVE' },
        {
          $set: {
            ...periods.find((row) => row.status === 'ACTIVE'),
            startProvenance: 'TRANSFER',
          },
        },
      ),
    ).toMatchObject({ modifiedCount: 1 });
    await rows.periods.collection.insertOne({
      ...periods.find((row) => row.status === 'CLOSED'),
      startedAtKnown: false,
      startProvenance: 'UNKNOWN',
    });
    await rows.archives.collection.insertMany(
      db.archives.filter((row) => row.animalId === animalId),
    );
    await rows.entries.collection.insertMany(db.entries);
    await rows.files.collection.insertMany(db.files);
    await rows.registrations.collection.insertMany(db.registrations);
    await rows.copyRecords.collection.insertMany(db.copyRecords);
  }
  const rejected = first.state.db.items.find(
    (row) => row.status === 'REJECTED',
  )!;
  expect(
    await rows.items
      .updateOne(
        { _id: String(rejected._id), status: 'PENDING' },
        { $set: { status: 'REJECTED' } },
      )
      .exec(),
  ).toMatchObject({ modifiedCount: 1 });
  expect(
    await rows.claims.deleteOne({ _id: String(rejected.animalId) }).exec(),
  ).toMatchObject({ deletedCount: 1 });
  return { first, second, input };
}

function closeOn(side: AcceptanceSide, dossiers: readonly Dossier[]) {
  const { rows, archiveSource } = side;
  const now = dossiers[0].now;
  const controls = {
    fenceActiveSourceProfile: jest
      .fn()
      .mockRejectedValue(
        new Error('Unexpected source profile fence during ownership close'),
      ),
    fenceActiveSharedControls: jest.fn().mockResolvedValue(undefined),
  };
  const store = new MongoTransferItemCapture(
    rows.requests,
    rows.items,
    rows.claims,
    rows.archives,
    rows.controls,
    rows.periods,
    rows.files,
    rows.entries,
    rows.copyRecords,
    { profiles: controls, now },
    rows.registrations,
  );
  const history = new MongoOwnershipArchiveHistory(
    rows.archives,
    rows.entries,
    rows.files,
    rows.periods,
    rows.controls,
    undefined,
    { controls, now, accreditationFor: () => null },
    rows.registrations,
    rows.copyRecords,
  );
  // Only the checked retained-file projection and control generations are supplied.
  // Both consumption records, live-resource checks and all business writes use the adapters.
  jest
    .spyOn(history, 'fencePublishedStableCutScopeWithinTransaction')
    .mockImplementation((selection) => {
      const dossier = dossiers.find(
        (candidate) =>
          candidate.retainedScope.binding.archiveId === selection.archiveId,
      );
      if (!dossier) throw new Error('Missing synthetic retained projection');
      expect(selection).toEqual(dossier.commitSelection.retainedSelection);
      return Promise.resolve({
        projection: dossier.retainedProjection,
        scope: dossier.retainedScope,
      });
    });
  async function transaction<T>(
    operation: (session: ClientSession) => Promise<T>,
  ) {
    const session = await rows.requests.db.startSession();
    try {
      return await session.withTransaction(() => operation(session), {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
        maxCommitTimeMS: 5000,
      });
    } finally {
      await session.endSession();
    }
  }
  return {
    commit: (dossier: Dossier) =>
      transaction((session) =>
        store.commitLaterPeriodItemOwnershipWithinTransaction(
          dossier.commitSelection,
          session,
          dossier.urls,
          archiveSource,
          history,
          rows,
        ),
      ),
    read: (pins: ClosePins) =>
      transaction((session) =>
        store.readLaterPeriodItemOwnershipCommitWithinTransaction(
          pins,
          session,
        ),
      ),
  };
}

describe('Opt-in Mongo ownership commit of a later period', () => {
  let fixture: TransferAcceptanceMongoFixture;
  let seed: Awaited<ReturnType<typeof seedSecondTransfer>>;
  beforeEach(async () => {
    fixture = new TransferAcceptanceMongoFixture();
    await fixture.open(readAcceptanceMongoSettings(process.env));
    seed = await seedSecondTransfer(fixture);
  });
  afterEach(async () => {
    try {
      await fixture.close();
    } finally {
      jest.restoreAllMocks();
    }
  });

  async function assertPeriodRotation(receipt: Dossier['expectedReceipt']) {
    const periods = await fixture.right.rows.periods
      .find({ animalId: receipt.animalId })
      .sort({ ownershipVersion: 1 })
      .lean()
      .exec();
    expect(periods).toMatchObject([
      { ownershipVersion: 1, status: 'CLOSED' },
      {
        id: receipt.closedPeriodId,
        ownerId: receipt.previousOwnerId,
        ownershipVersion: 2,
        status: 'CLOSED',
        endedAt: receipt.effectiveAt,
        archiveId: receipt.archiveId,
      },
      {
        id: receipt.activePeriodId,
        ownerId: receipt.ownerId,
        ownershipVersion: 3,
        status: 'ACTIVE',
        startedAt: receipt.effectiveAt,
        sourceTransferId: receipt.transferId,
      },
    ]);
  }

  it('closes and opens ownership in the same snapshot/majority transaction under the installed unique index', async () => {
    const { first } = seed;
    const r = fixture.right.rows;
    expect(await r.periods.listIndexes()).toContainEqual(
      expect.objectContaining({
        key: { animalId: 1 },
        unique: true,
        partialFilterExpression: { status: 'ACTIVE' },
      }),
    );
    const from = fixture.commands.length;
    const receipt = await closeOn(fixture.left, [first]).commit(first);
    expect(receipt).toEqual(first.expectedReceipt);
    await assertPeriodRotation(receipt);
    const commands = fixture.commands.slice(from);
    const periodWrites = commands.filter(
      ({ command, collection }) =>
        collection === 'animal_ownership_periods' &&
        ['update', 'insert'].includes(command),
    );
    expect(periodWrites.map(({ command }) => command)).toEqual([
      'update',
      'insert',
    ]);
    const transaction = periodWrites[0].transaction;
    expect(transaction).toBeDefined();
    expect(periodWrites[1].transaction).toBe(transaction);
    expect(
      commands.some(
        (command) => command.transaction === transaction && command.snapshot,
      ),
    ).toBe(true);
    expect(commands).toContainEqual(
      expect.objectContaining({
        transaction,
        command: 'commitTransaction',
        majority: true,
      }),
    );
    await expect(
      closeOn(fixture.right, [first]).read(first.commitSelection),
    ).resolves.toEqual(receipt);
  });

  it('retries a stale snapshot when two clients close distinct animals of the same decision', async () => {
    const { first, second, input } = seed;
    const left = closeOn(fixture.left, [first]);
    const right = closeOn(fixture.right, [second]);
    const from = fixture.commands.length;
    const pause = fixture.left.gate.arm('CAPTURE_ADMISSION');
    const pending = fixture.observe(left.commit(first));
    let winner: Dossier['expectedReceipt'];
    try {
      await pause.entered();
      winner = await right.commit(second);
      expect(winner).toEqual(second.expectedReceipt);
      expect(
        await fixture.right.rows.requests
          .findById(input.transferId)
          .lean()
          .exec(),
      ).toMatchObject({
        version: 3,
        acceptedItemCount: 1,
        status: 'PROCESSING',
      });
      await expect(right.read(first.commitSelection)).resolves.toBeNull();
    } finally {
      pause.release();
    }
    const result = await pending;
    if ('error' in result) throw result.error;
    const resumed = result.value;
    expect(resumed).toMatchObject({
      itemId: first.expectedReceipt.itemId,
      requestVersion: 4,
    });
    await assertPeriodRotation(winner);
    await assertPeriodRotation(resumed);
    const commands = fixture.commands
      .slice(from)
      .filter(({ side }) => side === 'left');
    const snapshots = commands.filter((command) => command.snapshot);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    const staleTransaction = snapshots[0].transaction;
    expect(commands).toContainEqual(
      expect.objectContaining({
        transaction: staleTransaction,
        command: 'abortTransaction',
      }),
    );
    expect(
      commands.some(
        (command) =>
          command.command === 'commitTransaction' &&
          command.transaction === staleTransaction,
      ),
    ).toBe(false);

    const r = fixture.right.rows;
    const request = await r.requests.findById(input.transferId).lean().exec();
    expect(request).toMatchObject({
      version: 4,
      acceptedItemCount: 2,
      status: 'PARTIALLY_ACCEPTED',
    });
    expect(request?.acceptanceStart).toEqual(
      first.state.db.requests[0].acceptanceStart,
    );
    expect(
      await r.claims.countDocuments({ transferId: input.transferId }),
    ).toBe(0);
    expect(
      await r.events.countDocuments({
        type: 'ITEM_ACCEPTED',
        transferId: input.transferId,
      }),
    ).toBe(2);
    expect(
      await r.notices.countDocuments({ transferId: input.transferId }),
    ).toBe(4);
    expect(
      await r.outbox.countDocuments({ transferId: input.transferId }),
    ).toBe(4);
    const beforeReplay = await fixture.snapshot();
    await expect(left.commit(first)).resolves.toEqual(resumed);
    await expect(right.commit(second)).resolves.toEqual(winner);
    expect(await fixture.snapshot()).toEqual(beforeReplay);
  });

  it('rolls back the period rotation and all associated writes when publication fails', async () => {
    const { first } = seed;
    const left = closeOn(fixture.left, [first]);
    const before = await fixture.snapshot();
    const from = fixture.commands.length;
    fixture.left.gate.fail = 'OWNERSHIP_PUBLICATION';
    await expect(left.commit(first)).rejects.toThrow(
      'Injected acceptance failure at OWNERSHIP_PUBLICATION',
    );
    expect(await fixture.snapshot()).toEqual(before);
    const commands = fixture.commands.slice(from);
    const inserted = commands.find(
      (command) =>
        command.side === 'left' &&
        command.command === 'insert' &&
        command.collection === 'animal_ownership_periods',
    );
    expect(inserted?.transaction).toBeDefined();
    expect(commands).toContainEqual(
      expect.objectContaining({
        side: 'left',
        transaction: inserted?.transaction,
        command: 'abortTransaction',
      }),
    );
    await expect(left.read(first.commitSelection)).resolves.toBeNull();
    await expect(left.commit(first)).resolves.toEqual(first.expectedReceipt);
  });
});
