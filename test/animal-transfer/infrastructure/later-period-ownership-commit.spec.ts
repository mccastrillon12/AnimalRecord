import { type ClientSession } from 'mongoose';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { MongoOwnershipArchiveHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { MongoOwnershipArchiveSource } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-source';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';

type CommitArguments = Parameters<
  MongoTransferItemCapture['commitLaterPeriodItemOwnershipWithinTransaction']
>;

async function setup(options?: Parameters<typeof publishedLaterPeriod>[1]) {
  const f = await publishedLaterPeriod('processing', options);
  const {
    models,
    urls,
    retainedScope,
    retainedProjection,
    store,
    commitSelection,
  } = f;
  const source = new MongoOwnershipArchiveSource(
    ...([
      models[3],
      models[7],
      models[6],
      models[5],
    ] as unknown as ConstructorParameters<typeof MongoOwnershipArchiveSource>),
  );
  const history = new MongoOwnershipArchiveHistory(
    ...([
      models[9],
      models[13],
      models[12],
      models[5],
      models[4],
      undefined,
      { now: f.now, controls: f.profiles, accreditationFor: () => null },
      models[15],
      models[14],
    ] as unknown as ConstructorParameters<typeof MongoOwnershipArchiveHistory>),
  );
  // The retained files were already reconciled. Supply that checked projection
  // at its boundary and exercise both real accreditation consumers and writers.
  const retainedFence = jest
    .spyOn(history, 'fencePublishedStableCutScopeWithinTransaction')
    .mockResolvedValue({
      projection: retainedProjection,
      scope: retainedScope,
    });
  const commitModels = {
    users: models[11],
    events: models[10],
    notices: models[16],
    outbox: models[17],
  } as unknown as CommitArguments[5];
  async function transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await f.connection.startSession();
    try {
      return (await session.withTransaction(
        () => work(session as unknown as ClientSession),
        {
          readConcern: { level: 'snapshot' },
          readPreference: 'primary',
          writeConcern: { w: 'majority' },
        },
      )) as T;
    } finally {
      await session.endSession();
    }
  }
  f.calls.length = 0;
  const commit = (pins = commitSelection) =>
    transaction((session) =>
      store.commitLaterPeriodItemOwnershipWithinTransaction(
        pins,
        session,
        urls,
        source,
        history,
        commitModels,
      ),
    );
  const read = (pins = commitSelection) =>
    transaction((session) =>
      store.readLaterPeriodItemOwnershipCommitWithinTransaction(pins, session),
    );
  return { ...f, commit, read, retainedFence };
}

describe('Internal second-transfer ownership commit, simulated persistence', () => {
  it('uses one original decision for two separately sealed later-period dossiers', async () => {
    const first = await setup({ bothLater: true });
    const second = await setup({ bothLater: true, selectedIndex: 1 });
    expect(second.state.db.requests[0].acceptanceStart).toEqual(
      first.state.db.requests[0].acceptanceStart,
    );
    expect(second.expectedReceipt.archiveId).not.toBe(
      first.expectedReceipt.archiveId,
    );
    expect(second.expectedReceipt.activePeriodId).not.toBe(
      first.expectedReceipt.activePeriodId,
    );
    await expect(first.commit()).resolves.toEqual(first.expectedReceipt);
    await expect(second.commit()).resolves.toEqual(second.expectedReceipt);
  });

  it('commits the new owner, both periods, publication and notifications in the caller session', async () => {
    const f = await setup();
    const pending = structuredClone(f.state.db);
    const reader = new PublishedOwnershipHistoryReader(f.store, f.keyFromUrl);
    await expect(f.read()).resolves.toBeNull();
    await expect(reader.read({ ...f.selection, limit: 2 })).rejects.toThrow(
      'Published ownership history not found',
    );
    f.calls.length = 0;

    const receipt = await f.commit();
    expect(receipt).toEqual(f.expectedReceipt);
    const session = f.calls[0].session;
    expect(f.calls.every((call) => call.session === session)).toBe(true);
    expect(f.retainedFence.mock.calls).toEqual([
      [f.commitSelection.retainedSelection, session, f.urls],
      [f.commitSelection.retainedSelection, session, f.urls],
    ]);

    const db = f.state.db;
    const {
      animalId,
      ownerId,
      previousOwnerId,
      effectiveAt,
      archiveId,
      itemId,
    } = receipt;
    expect(db.animals.find((row) => row.id === animalId)).toMatchObject({
      ownerId,
      profilePictureUrl: f.urls.urlForKey(f.live.media.final.target.key),
      nameHistory: f.live.animal.nameHistory,
    });
    expect(
      db.periods.filter(
        (row) => row.animalId === animalId && row.status === 'ACTIVE',
      ),
    ).toEqual([
      expect.objectContaining({
        id: receipt.activePeriodId,
        ownerId,
        ownershipVersion: 3,
        startedAt: effectiveAt,
        sourceTransferId: receipt.transferId,
      }),
    ]);
    expect(
      db.periods.find((row) => row.id === receipt.closedPeriodId),
    ).toMatchObject({
      status: 'CLOSED',
      endedAt: effectiveAt,
      ownerId: previousOwnerId,
      ownershipVersion: 2,
      archiveId,
    });
    const control = db.controls.find((row) => row.animalId === animalId);
    expect(control).toMatchObject({
      ownerId,
      ownershipVersion: 3,
      reservationEpoch: receipt.reservationEpoch,
    });
    expect(control).not.toHaveProperty('transferLock');
    expect(db.archives.find((row) => row.id === archiveId)).toMatchObject({
      ownershipCommitHash: receipt.commitHash,
      laterPeriodStableCutConsumption: {
        definitionHash: receipt.consumptionHash,
      },
      retainedReferencesReceipt: {
        definitionHash: receipt.retainedReferencesReceiptHash,
      },
      retainedReferencesPublication: {
        ownershipCommitHash: receipt.commitHash,
        activePeriodId: receipt.activePeriodId,
      },
    });
    expect(
      db.entries.find((row) => row.id === f.selection.entryId),
    ).toMatchObject({
      retainedReferences: { mode: 'RETAINED_READ_ONLY' },
    });
    expect(db.registrations).toEqual(pending.registrations);
    expect(db.items.find((row) => row._id === itemId)).toMatchObject({
      status: 'ACCEPTED',
      ownershipCommit: receipt,
    });
    expect(db.items.filter((row) => row._id !== itemId)).toEqual(
      pending.items.filter((row) => row._id !== itemId),
    );
    expect(db.requests[0]).toMatchObject({
      status: 'PROCESSING',
      acceptedItemCount: 1,
      version: receipt.requestVersion,
    });
    expect(db.claims).toEqual(
      pending.claims.filter((row) => row._id !== animalId),
    );
    const previousRevision = pending.users.find(
      (row) => row.id === ownerId,
    )?.transferRequestRevision;
    expect(db.users.find((row) => row.id === ownerId)).toMatchObject({
      transferRequestRevision: Number(previousRevision) + 1,
    });
    expect(db.events).toContainEqual(
      expect.objectContaining({
        _id: receipt.id,
        type: 'ITEM_ACCEPTED',
        itemId,
        createdAt: effectiveAt,
      }),
    );
    expect(db.notices.map((row) => row.userId)).toEqual([
      previousOwnerId,
      ownerId,
    ]);
    expect(db.outbox.map((row) => row.notificationId)).toEqual(
      db.notices.map((row) => row._id),
    );

    await expect(f.read()).resolves.toEqual(receipt);
    const published = await reader.read({ ...f.selection, limit: 2 });
    expect(published.entries.map((entry) => entry.entryId)).toContain(
      f.selection.entryId,
    );
  });

  it('reverts every write if the final publication write fails and can retry the original close', async () => {
    const f = await setup();
    const before = structuredClone(f.state.db);
    const archiveModel = f.models[9];
    const originalUpdate = archiveModel.updateOne;
    const failure = new Error('synthetic failure linking publication');
    let sawPublication = false;
    const update = jest
      .spyOn(archiveModel, 'updateOne')
      .mockImplementation((filter, change, options) => {
        const query = originalUpdate(filter, change, options);
        if (
          !(change.$set as Record<string, unknown>)
            ?.retainedReferencesPublication
        )
          return query;
        const exec = query.exec;
        query.exec = async () => {
          await exec();
          sawPublication = true;
          expect(options.session?.current.outbox).toHaveLength(2);
          expect(
            options.session?.current.archives.find(
              (row) => row.id === f.expectedReceipt.archiveId,
            ),
          ).toHaveProperty('retainedReferencesPublication');
          throw failure;
        };
        return query;
      });
    try {
      await expect(f.commit()).rejects.toBe(failure);
      expect(sawPublication).toBe(true);
      expect(f.calls[0].session?.abortTransaction).toHaveBeenCalledTimes(1);
      expect(f.state.db).toEqual(before);
      await expect(f.read()).resolves.toBeNull();
    } finally {
      update.mockRestore();
    }
    await expect(f.commit()).resolves.toEqual(f.expectedReceipt);
  });

  it('recovers the exact receipt after a lost response without repeating ownership writes', async () => {
    const f = await setup();
    f.state.loseReply = true;
    await expect(f.commit()).rejects.toThrow(
      'simulated lost application response after commit',
    );
    const committed = structuredClone(f.state.db);
    const writes = f.state.writes;
    await expect(f.read()).resolves.toEqual(f.expectedReceipt);
    await expect(f.commit()).resolves.toEqual(f.expectedReceipt);
    expect(f.state.writes).toBe(writes);
    expect(f.state.db).toEqual(committed);
    await expect(
      f.read({
        ...f.commitSelection,
        expectedAccreditationHash: archiveHash('different report'),
      }),
    ).rejects.toThrow('receipt differs');
    expect(f.retainedFence).toHaveBeenCalledTimes(2);
  });

  it('rejects a stale reservation without consuming any evidence', async () => {
    const f = await setup();
    const control = f.state.db.controls.find(
      (row) => row.animalId === f.expectedReceipt.animalId,
    )!;
    control.reservationEpoch = Number(control.reservationEpoch) + 1;
    const before = structuredClone(f.state.db);
    await expect(f.commit()).rejects.toThrow(
      'original matching drained transfer reservation',
    );
    expect(f.retainedFence).not.toHaveBeenCalled();
    expect(f.state.db).toEqual(before);
  });

  it('rolls back the fences if the live animal differs from the sealed dossier', async () => {
    const f = await setup();
    const animal = f.state.db.animals.find(
      (row) => row.id === f.expectedReceipt.animalId,
    )!;
    animal.name = 'Updated name';
    const before = structuredClone(f.state.db);
    await expect(f.commit()).rejects.toThrow(
      'A current resource differs from the sealed dossier',
    );
    expect(f.state.writes).toBeGreaterThan(0);
    expect(f.retainedFence).toHaveBeenCalledTimes(1);
    expect(f.state.db).toEqual(before);
  });
});
