import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { PublishedOwnershipHistoryDownloader } from '../../../src/context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
  itemSourceControlsHash,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-item-source-profile-state';
import { MongoOwnershipArchiveHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';
import { restoreNodeDisposeSymbolForSuite } from './support/restore-node-dispose-symbol';
import {
  type AcceptanceSide,
  TransferAcceptanceMongoFixture,
} from './support/transfer-acceptance-mongo-fixture';
import { readAcceptanceMongoSettings } from './support/transfer-acceptance-mongo-safety';

type Dossier = Awaited<ReturnType<typeof publishedLaterPeriod>>;
type ClosePins = Dossier['commitSelection'];

function activeControls(purpose: string) {
  const generationId = randomUUID();
  const configurationHash = archiveHash(purpose);
  return {
    _id: itemSourceControlsHash(generationId, configurationHash),
    protocol: ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
    row: 'CONTROLS',
    state: 'ACTIVE',
    generationId,
    configurationHash,
  } as const;
}

/** Seed the same original decision with two sealed dossiers. Evidence and file contents are synthetic. */
async function seedSecondTransfer(fixture: TransferAcceptanceMongoFixture) {
  const input = await fixture.seedAcceptance(3, '2026-10-29T11:59:00.000Z');
  const dossiers = await Promise.all(
    ([0, 1] as const).map(async (selectedIndex) => {
      const retained = activeControls('synthetic retained conservation');
      const live = activeControls('synthetic second-period photo conservation');
      const dossier = await publishedLaterPeriod('processing', {
        bothLater: true,
        selectedIndex,
        controls: { retained: retained._id, live: live._id },
      });
      return { dossier, retained, live };
    }),
  );
  await fixture.left.sourceProfileRows.insertMany(
    dossiers.flatMap(({ retained, live }) => [retained, live]),
    { writeConcern: { w: 'majority' } },
  );
  const [first, second] = dossiers.map(({ dossier }) => dossier);
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
    // The driver adds _id in place. Keep the hashed projection's registrations intact.
    await rows.registrations.collection.insertMany(
      db.registrations.map((registration) => ({ ...registration })),
    );
    await rows.copyRecords.collection.insertMany(
      db.copyRecords.map((record) => ({ ...record })),
    );
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
  const { rows, archiveSource, sourceProfiles: controls } = side;
  const now = dossiers[0].now;
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
  // Supply the retained projection while keeping its conservation fence in the caller session.
  jest
    .spyOn(history, 'fencePublishedStableCutScopeWithinTransaction')
    .mockImplementation(async (selection, session) => {
      const dossier = dossiers.find(
        (candidate) =>
          candidate.retainedScope.binding.archiveId === selection.archiveId,
      );
      if (!dossier) throw new Error('Missing synthetic retained projection');
      expect(selection).toEqual(dossier.commitSelection.retainedSelection);
      for (const hash of dossier.retainedScope.retained
        .conservationControlsHashes)
        await controls.fenceActiveSharedControls(hash, session);
      return {
        projection: dossier.retainedProjection,
        scope: dossier.retainedScope,
        files: dossier.retainedFiles,
      };
    });
  return {
    store,
    commit: (dossier: Dossier) =>
      store.commitLaterPeriodItemOwnership(
        dossier.commitSelection,
        dossier.urls,
        archiveSource,
        history,
        rows,
      ),
    read: (pins: ClosePins) => store.readLaterPeriodItemOwnershipCommit(pins),
  };
}

describe('Opt-in Mongo ownership commit of a later period', () => {
  let fixture: TransferAcceptanceMongoFixture;
  let seed: Awaited<ReturnType<typeof seedSecondTransfer>>;
  restoreNodeDisposeSymbolForSuite();
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

  it('lists and pages the second closed dossier from the receipt on another client', async () => {
    const { first } = seed;
    const { store } = closeOn(fixture.right, [first]);
    const reader = new PublishedOwnershipHistoryReader(store, first.keyFromUrl);
    const { previousOwnerId: actorId, closedPeriodId: periodId } =
      first.expectedReceipt;
    const page = { actorId, periodId, limit: 1 };
    await expect(reader.list({ actorId, limit: 2 })).resolves.toMatchObject({
      periods: [],
    });
    await expect(reader.read(page)).rejects.toThrow(
      'Published ownership history not found',
    );

    const receipt = await closeOn(fixture.left, [first]).commit(first);
    const before = await fixture.snapshot();
    const { periods } = await reader.list({ actorId, limit: 2 });
    expect(periods).toMatchObject([
      {
        periodId,
        animalId: receipt.animalId,
        ownershipVersion: 2,
        endedAt: receipt.effectiveAt,
        publicationHash: receipt.commitHash,
        mode: 'HISTORICAL_READ_ONLY',
      },
    ]);
    const selection = { ...page, publicationHash: periods[0].publicationHash };
    const initial = await reader.read(selection);
    expect(initial.entries).toHaveLength(1);
    expect(initial.nextCursor).toEqual({
      publicationHash: receipt.commitHash,
      afterEntryId: initial.entries[0].entryId,
    });
    const remaining = await reader.read({
      ...selection,
      after: initial.nextCursor,
    });
    expect(remaining.entries).toHaveLength(1);
    expect(remaining.nextCursor).toBeUndefined();
    expect([...initial.entries, ...remaining.entries]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: first.liveSelection.entryId,
          kind: 'ANIMAL',
          media: [
            expect.objectContaining({ fileId: first.liveSelection.fileId }),
          ],
        }),
        expect.objectContaining({
          entryId: first.selection.entryId,
          kind: 'RETAINED_RECORD',
          media: [expect.objectContaining({ fileId: first.selection.fileId })],
        }),
      ]),
    );
    await expect(
      reader.read({ ...selection, actorId: receipt.ownerId }),
    ).rejects.toThrow('Published ownership history not found');
    await expect(
      reader.read({
        ...selection,
        after: {
          publicationHash: archiveHash('other publication'),
          afterEntryId: initial.entries[0].entryId,
        },
      }),
    ).rejects.toThrow('The selected history publication changed');
    expect(await fixture.snapshot()).toEqual(before);
  });

  it('downloads both versions selected by the second-period receipt and rejects the revoked generation', async () => {
    const { first } = seed;
    const receipt = await closeOn(fixture.left, [first]).commit(first);
    const { store, read } = closeOn(fixture.right, [first]);
    await expect(read(first.commitSelection)).resolves.toEqual(receipt);

    const live = first.live.media.historical;
    const objects = [
      { target: live.target, revision: live.revision, bytes: first.live.bytes },
      { target: first.target, revision: first.revision, bytes: first.bytes },
    ];
    const readVersion = jest.fn(
      (target: (typeof objects)[number]['target']) => {
        const object = objects.find(
          ({ target: stored }) => stored.key === target.key,
        );
        if (!object) throw new Error('Unexpected historical key');
        const body = Readable.from([object.bytes]);
        return Promise.resolve({
          revision: object.revision,
          body,
          close: () => body.destroy(),
        });
      },
    );
    const downloader = new PublishedOwnershipHistoryDownloader(
      store.publishedHistoryVersionSource({
        readPublishedRetainedCopyFacts: first.readPublishedRetainedCopyFacts,
      }),
      { readVersion },
      first.keyFromUrl,
      5000,
      first.now,
    );
    const bodies: Buffer[][] = [];
    const open = jest.fn(() => {
      const chunks: Buffer[] = [];
      bodies.push(chunks);
      return new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
      });
    });
    const liveInput = {
      ...first.liveSelection,
      publicationHash: receipt.commitHash,
    };
    const retainedInput = {
      ...first.selection,
      publicationHash: receipt.commitHash,
    };
    const before = await fixture.snapshot();
    await expect(
      downloader.download({ ...retainedInput, fileId: liveInput.fileId }, open),
    ).rejects.toThrow('Historical file not found');
    expect(readVersion).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    await downloader.download(liveInput, open);
    await downloader.download(retainedInput, open);
    expect(readVersion).toHaveBeenCalledTimes(objects.length);
    for (const [index, { target, revision }] of objects.entries())
      expect(readVersion).toHaveBeenNthCalledWith(
        index + 1,
        target,
        revision,
        expect.any(AbortSignal),
      );
    expect(first.readPublishedRetainedCopyFacts).toHaveBeenCalledTimes(1);
    const [retainedFile] = first.retainedFiles;
    expect(first.readPublishedRetainedCopyFacts).toHaveBeenCalledWith(
      expect.objectContaining({ archiveId: receipt.archiveId }),
      expect.objectContaining({ id: receipt.archiveId }),
      expect.objectContaining({
        id: first.retainedScope.binding.sourceArchiveId,
      }),
      expect.objectContaining({ id: retainedFile.fileId }),
      expect.objectContaining({ id: retainedFile.sourceFileId }),
    );
    expect(bodies.map((chunks) => Buffer.concat(chunks))).toEqual(
      objects.map(({ bytes }) => bytes),
    );
    expect(await fixture.snapshot()).toEqual(before);

    await fixture.left.sourceProfiles.invalidateSharedControls(
      first.originalControlsHash,
      {
        requestId: randomUUID(),
        evidenceHash: archiveHash(
          'synthetic retained conservation invalidation',
        ),
      },
    );
    await expect(downloader.download(retainedInput, open)).rejects.toThrow(
      'shared controls state changed or is invalid',
    );
    expect(readVersion).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(2);
    await downloader.download(liveInput, open);
    expect(readVersion).toHaveBeenCalledTimes(3);
    expect(bodies).toHaveLength(3);
    expect(Buffer.concat(bodies[2])).toEqual(first.live.bytes);
  });

  it('rolls back the period rotation and all associated writes when publication fails', async () => {
    const { first } = seed;
    const left = closeOn(fixture.left, [first]);
    const before = await fixture.snapshot();
    const from = fixture.commands.length;
    fixture.left.gate.fail = 'OWNERSHIP_PUBLICATION';
    await expect(left.commit(first)).rejects.toThrow(
      'The later-period ownership commit could not be acknowledged',
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
