import type { mongo } from 'mongoose';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { matchActiveItemSourceProfile } from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import {
  ITEM_SOURCE_PROFILE_STATE_COLLECTION,
  ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
  ItemSourceProfileStateRow,
  MongoItemSourceProfileState,
  itemSourceControlsHash,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-item-source-profile-state';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';

const protocol = ITEM_SOURCE_PROFILE_STATE_PROTOCOL;
const request = { requestId: id(7), evidenceHash: 'e'.repeat(64) };
function controls(generationId: string) {
  const configurationHash = 'a'.repeat(64);
  return {
    _id: itemSourceControlsHash(generationId, configurationHash),
    protocol,
    row: 'CONTROLS',
    generationId,
    configurationHash,
    state: 'ACTIVE',
  } as const;
}
function profile(
  profileId: string,
  controlsHash: string,
  selectorHash: string,
) {
  const definition = {
    protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_V1',
    id: profileId,
    revision: 1,
    issuerId: id(6),
    selectorHash,
    signerContextHash: 'd'.repeat(64),
    controlsHash,
    validFrom: '2026-11-07T14:00:00.000Z',
    validUntil: '2026-11-07T16:00:00.000Z',
  } as const;
  return {
    _id: profileId,
    protocol,
    row: 'PROFILE',
    profile: {
      ...definition,
      definitionHash: archiveHash(definition),
      state: 'ACTIVE',
    },
  } as const;
}
function reference({
  profile: { id, revision, definitionHash },
}: ReturnType<typeof profile>) {
  return { id, revision, definitionHash };
}
function setup() {
  const shared = controls(id(1)),
    unrelated = controls(id(2));
  const first = profile(id(3), shared._id, 'b'.repeat(64)),
    second = profile(id(4), shared._id, 'c'.repeat(64)),
    other = profile(id(5), unrelated._id, 'd'.repeat(64));
  const rows = new Map<string, ItemSourceProfileStateRow>(
    [shared, unrelated, first, second, other].map((row) => [row._id, row]),
  );
  const transaction = { withTransaction: jest.fn() };
  let snapshot: typeof rows | undefined;
  let afterSnapshotRead: (() => Promise<void>) | undefined;
  let loseReply = false;
  transaction.withTransaction.mockImplementation(
    async (work: () => Promise<unknown>) => {
      snapshot = structuredClone(rows);
      try {
        return await work();
      } finally {
        snapshot = undefined;
      }
    },
  );
  const findOne = jest.fn(
    async (
      { _id }: { _id: string },
      options: { session?: typeof transaction },
    ) => {
      const row = structuredClone(
        (options.session ? snapshot! : rows).get(_id),
      );
      if (options.session && afterSnapshotRead) {
        const work = afterSnapshotRead;
        afterSnapshotRead = undefined;
        await work();
      }
      return row ?? null;
    },
  );
  const updateOne = jest.fn(
    (
      filter: {
        _id: string;
        protocol: string;
        row: 'PROFILE' | 'CONTROLS';
        state?: string;
        'profile.id'?: string;
        'profile.revision'?: number;
        'profile.definitionHash'?: string;
        'profile.state'?: string;
        invalidation: { $exists: false };
      },
      { $set }: { $set: { invalidation: typeof request } },
    ) => {
      const row = rows.get(filter._id);
      const exact =
        row?.row === 'PROFILE'
          ? row.profile.id === filter['profile.id'] &&
            row.profile.revision === filter['profile.revision'] &&
            row.profile.definitionHash === filter['profile.definitionHash'] &&
            row.profile.state === filter['profile.state']
          : row?.state === filter.state;
      if (
        !row ||
        row.protocol !== filter.protocol ||
        row.row !== filter.row ||
        !exact ||
        row.invalidation !== undefined ||
        filter.invalidation.$exists !== false
      )
        return Promise.resolve({
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
        });
      const invalidation = structuredClone($set.invalidation);
      rows.set(
        row._id,
        row.row === 'PROFILE'
          ? {
              ...row,
              profile: { ...row.profile, state: 'INVALIDATED' },
              invalidation,
            }
          : { ...row, state: 'INVALIDATED', invalidation },
      );
      if (loseReply) {
        loseReply = false;
        return Promise.reject(new Error('private simulated response loss'));
      }
      return Promise.resolve({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
      });
    },
  );
  const collection = jest.fn(() => ({ findOne, updateOne }));
  const db = {
    collection,
    client: {
      withSession: jest.fn(
        (work: (session: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    },
  };
  const store = new MongoItemSourceProfileState(db as unknown as mongo.Db);
  return {
    store,
    rows,
    first,
    second,
    other,
    shared,
    unrelated,
    db,
    transaction,
    findOne,
    updateOne,
    loseReply: () => {
      loseReply = true;
    },
    afterSnapshotRead: (work: () => Promise<void>) => {
      afterSnapshotRead = work;
    },
  };
}

describe('Source profile state with simulated Mongo', () => {
  it('reads the profile and shared generation in the same read-only snapshot', async () => {
    const t = setup();
    expect(t.db.collection).toHaveBeenCalledWith(
      ITEM_SOURCE_PROFILE_STATE_COLLECTION,
    );
    expect(await t.store.readCurrentSourceProfile(t.first._id)).toEqual(
      t.first.profile,
    );
    expect(t.findOne.mock.calls).toEqual([
      [{ _id: t.first._id }, { session: t.transaction }],
      [{ _id: t.shared._id }, { session: t.transaction }],
    ]);
    expect(t.transaction.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
        timeoutMS: 15000,
      },
    );
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('invalidates two selectors with one shared write and preserves an unrelated generation', async () => {
    const t = setup();
    expect(
      await t.store.invalidateSharedControls(t.shared._id, request),
    ).toMatchObject({
      state: 'INVALIDATED',
      replayed: false,
      copyDispatch: 'NOT_AUTHORIZED',
    });
    expect(t.updateOne).toHaveBeenCalledTimes(1);
    expect(t.updateOne.mock.calls[0][0]).toEqual({
      _id: t.shared._id,
      protocol,
      row: 'CONTROLS',
      state: 'ACTIVE',
      invalidation: { $exists: false },
    });
    for (const dependent of [t.first, t.second]) {
      const effective = await t.store.readCurrentSourceProfile(dependent._id);
      expect(effective).toEqual({ ...dependent.profile, state: 'INVALIDATED' });
      expect(() =>
        matchActiveItemSourceProfile(effective, reference(dependent)),
      ).toThrow();
      expect(t.rows.get(dependent._id)).toEqual(dependent);
    }
    expect(await t.store.readCurrentSourceProfile(t.other._id)).toEqual(
      t.other.profile,
    );
    expect(t.rows.get(t.unrelated._id)).toEqual(t.unrelated);
    expect(t.updateOne).toHaveBeenCalledTimes(1);
  });

  it('invalidates only the expected profile revision and preserves its definition hash', async () => {
    const t = setup();
    const ref = reference(t.first);
    await expect(
      t.store.invalidateProfile({ ...ref, revision: 0 }, request),
    ).rejects.toThrow();
    expect(t.updateOne).not.toHaveBeenCalled();
    await expect(
      t.store.invalidateProfile(ref, request),
    ).resolves.toMatchObject({ replayed: false });
    expect(t.updateOne).toHaveBeenCalledWith(
      {
        _id: ref.id,
        protocol,
        row: 'PROFILE',
        'profile.id': ref.id,
        'profile.revision': ref.revision,
        'profile.definitionHash': ref.definitionHash,
        'profile.state': 'ACTIVE',
        invalidation: { $exists: false },
      },
      { $set: { 'profile.state': 'INVALIDATED', invalidation: request } },
      { upsert: false, writeConcern: { w: 'majority' }, timeoutMS: 15000 },
    );
    expect(await t.store.readCurrentSourceProfile(t.first._id)).toEqual({
      ...t.first.profile,
      state: 'INVALIDATED',
    });
    expect(await t.store.readCurrentSourceProfile(t.second._id)).toEqual(
      t.second.profile,
    );
    expect(t.rows.get(t.shared._id)).toEqual(t.shared);
  });

  it('does not invalidate a newer profile revision installed between the read and the CAS', async () => {
    const t = setup();
    const { definitionHash, state, ...previous } = t.first.profile;
    const nextDefinition = { ...previous, revision: previous.revision + 1 };
    const next = {
      ...t.first,
      profile: {
        ...nextDefinition,
        definitionHash: archiveHash(nextDefinition),
        state,
      },
    };
    expect(next.profile.definitionHash).not.toBe(definitionHash);
    const update = t.updateOne.getMockImplementation()!;
    t.updateOne.mockImplementationOnce((filter, updateDoc) => {
      t.rows.set(next._id, next);
      return update(filter, updateDoc);
    });
    await expect(
      t.store.invalidateProfile(reference(t.first), request),
    ).rejects.toThrow('state changed or is invalid');
    expect(t.updateOne).toHaveBeenCalledTimes(1);
    expect(t.rows.get(next._id)).toEqual(next);
    expect(await t.store.readCurrentSourceProfile(next._id)).toEqual(
      next.profile,
    );
  });

  it.each(['same request', 'different request'] as const)(
    'allows one terminal write when two invalidations race with %s',
    async (kind) => {
      const t = setup();
      const competing =
        kind === 'same request' ? request : { ...request, requestId: id(8) };
      const results = await Promise.allSettled([
        t.store.invalidateSharedControls(t.shared._id, request),
        t.store.invalidateSharedControls(t.shared._id, competing),
      ]);
      expect(results[0]).toMatchObject({
        status: 'fulfilled',
        value: { replayed: false },
      });
      expect(results[1]).toMatchObject(
        kind === 'same request'
          ? { status: 'fulfilled', value: { replayed: true } }
          : { status: 'rejected' },
      );
      expect(t.rows.get(t.shared._id)).toMatchObject({
        state: 'INVALIDATED',
        invalidation: request,
      });
      expect(t.updateOne).toHaveBeenCalledTimes(2);
    },
  );

  it('reconciles only the exact request after losing the application response', async () => {
    const t = setup();
    t.loseReply();
    await expect(
      t.store.invalidateProfile(reference(t.first), request),
    ).rejects.toThrow('could not be acknowledged');
    await expect(
      t.store.invalidateProfile(reference(t.first), request),
    ).resolves.toMatchObject({ replayed: true });
    await expect(
      t.store.invalidateProfile(reference(t.first), {
        ...request,
        evidenceHash: 'f'.repeat(64),
      }),
    ).rejects.toThrow();
    expect(t.updateOne).toHaveBeenCalledTimes(1);
  });

  it('leaves an already open snapshot observational and rejects the old revision on the next read', async () => {
    const t = setup();
    t.afterSnapshotRead(async () => {
      await t.store.invalidateSharedControls(t.shared._id, request);
    });
    expect(await t.store.readCurrentSourceProfile(t.first._id)).toEqual(
      t.first.profile,
    );
    expect(await t.store.readCurrentSourceProfile(t.first._id)).toMatchObject({
      state: 'INVALIDATED',
    });
  });

  it('fails closed for absent or corrupt control generations and never creates them', async () => {
    const t = setup();
    t.rows.delete(t.shared._id);
    await expect(
      t.store.readCurrentSourceProfile(t.first._id),
    ).resolves.toBeNull();
    await expect(
      t.store.invalidateSharedControls(t.shared._id, request),
    ).rejects.toThrow();
    t.rows.set(t.shared._id, { ...t.shared, generationId: id(9) });
    await expect(
      t.store.readCurrentSourceProfile(t.second._id),
    ).rejects.toThrow();
    await expect(
      t.store.invalidateSharedControls(t.shared._id, request),
    ).rejects.toThrow();
    expect(t.updateOne).not.toHaveBeenCalled();
  });
});
