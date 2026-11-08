import type { mongo } from 'mongoose';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ItemSourceOperationalAccreditation,
  ItemSourceProfileReference,
  matchActiveItemSourceProfile,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
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
  const client = { withSession: jest.fn() };
  const transaction = {
    client,
    hasEnded: false,
    inTransaction: jest.fn(() => true),
    transaction: {
      options: {
        readConcern: { level: 'snapshot' },
        readPreference: { mode: 'primary' },
        writeConcern: { w: 'majority' },
      },
    },
    withTransaction: jest.fn<Promise<unknown>, [() => Promise<unknown>]>(),
  };
  let snapshot: typeof rows | undefined;
  let snapshotWritten = false;
  let afterSnapshotRead: (() => Promise<void>) | undefined;
  let loseReply = false;
  transaction.withTransaction.mockImplementation(
    async (work: () => Promise<unknown>) => {
      snapshot = structuredClone(rows);
      snapshotWritten = false;
      try {
        const result = await work();
        if (snapshotWritten) {
          rows.clear();
          for (const [key, value] of snapshot) rows.set(key, value);
        }
        return result;
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
        accreditation?: { $exists: false };
        fenceRevision?: number | { $exists: false };
      },
      {
        $set,
        $inc,
      }: {
        $set?: {
          invalidation?: typeof request;
          accreditation?: ItemSourceOperationalAccreditation;
        };
        $inc?: { fenceRevision: number };
      },
      options?: { session?: typeof transaction },
    ) => {
      const target = options?.session ? snapshot! : rows;
      const row = target.get(filter._id);
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
      if (options?.session) {
        if (
          $set?.accreditation &&
          row.row === 'PROFILE' &&
          row.accreditation === undefined
        ) {
          target.set(row._id, {
            ...row,
            accreditation: structuredClone($set.accreditation),
          });
        } else if ($inc?.fenceRevision === 1) {
          target.set(row._id, {
            ...row,
            fenceRevision: (row.fenceRevision ?? 0) + 1,
          });
        } else throw new Error('Unexpected simulated transactional write');
        snapshotWritten = true;
        return Promise.resolve({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
        });
      }
      const invalidation = structuredClone($set?.invalidation);
      if (!invalidation) throw new Error('Missing simulated invalidation');
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
  client.withSession.mockImplementation(
    (work: (session: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  );
  const db = { collection, client };
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
    fence: (
      ref: ItemSourceProfileReference = reference(first),
      validate?: Parameters<
        MongoItemSourceProfileState['fenceActiveSourceProfile']
      >[2],
    ) =>
      transaction.withTransaction(() =>
        store.fenceActiveSourceProfile(
          ref,
          transaction as unknown as mongo.ClientSession,
          validate,
        ),
      ),
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

describe('Source profile fence with simulated Mongo', () => {
  const saved = { acknowledged: true, matchedCount: 1, modifiedCount: 1 };

  it('runs the caller validation against the profile in the transaction before either write', async () => {
    const t = setup();
    const invalid = new Error('Caller rejected the profile window');
    const validate = jest.fn(() => {
      throw invalid;
    });
    await expect(t.fence(reference(t.first), validate)).rejects.toBe(invalid);
    expect(validate).toHaveBeenCalledWith(t.first.profile);
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('increments both exact active rows through the caller session, including legacy rows without a revision', async () => {
    const t = setup();
    t.rows.set(t.shared._id, { ...t.shared, fenceRevision: 4 });
    t.updateOne.mockResolvedValueOnce(saved).mockResolvedValueOnce(saved);

    await expect(t.fence()).resolves.toBeUndefined();
    expect(t.db.client.withSession).not.toHaveBeenCalled();
    expect(t.transaction.withTransaction).toHaveBeenCalledTimes(1);
    expect(t.findOne.mock.calls).toEqual([
      [{ _id: t.first._id }, { session: t.transaction }],
      [{ _id: t.shared._id }, { session: t.transaction }],
    ]);
    expect(t.updateOne.mock.calls).toEqual([
      [
        {
          _id: t.first._id,
          protocol,
          row: 'PROFILE',
          'profile.id': t.first._id,
          'profile.revision': t.first.profile.revision,
          'profile.definitionHash': t.first.profile.definitionHash,
          'profile.state': 'ACTIVE',
          invalidation: { $exists: false },
          fenceRevision: { $exists: false },
        },
        { $inc: { fenceRevision: 1 } },
        { session: t.transaction, upsert: false },
      ],
      [
        {
          _id: t.shared._id,
          protocol,
          row: 'CONTROLS',
          generationId: t.shared.generationId,
          configurationHash: t.shared.configurationHash,
          state: 'ACTIVE',
          invalidation: { $exists: false },
          fenceRevision: 4,
        },
        { $inc: { fenceRevision: 1 } },
        { session: t.transaction, upsert: false },
      ],
    ]);
  });

  it.each([
    'ended',
    'inactive',
    'foreign',
    'non-snapshot',
    'non-majority',
    'secondary',
  ])('rejects a %s session before reading', async (kind) => {
    const t = setup();
    const session = t.transaction;
    const options = session.transaction.options;
    if (kind === 'ended') session.hasEnded = true;
    if (kind === 'inactive') session.inTransaction.mockReturnValue(false);
    if (kind === 'foreign') session.client = { withSession: jest.fn() };
    if (kind === 'non-snapshot') options.readConcern.level = 'majority';
    if (kind === 'non-majority') options.writeConcern.w = '1';
    if (kind === 'secondary') options.readPreference.mode = 'secondary';
    await expect(t.fence()).rejects.toThrow();
    expect(t.findOne).not.toHaveBeenCalled();
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('rejects an old profile revision before looking up its controls', async () => {
    const t = setup();
    await expect(
      t.fence({ ...reference(t.first), revision: 0 }),
    ).rejects.toThrow();
    expect(t.findOne).toHaveBeenCalledTimes(1);
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it.each(['profile', 'controls'])(
    'rejects an already invalidated %s without writing either fence',
    async (target) => {
      const t = setup();
      if (target === 'profile')
        await t.store.invalidateProfile(reference(t.first), request);
      else await t.store.invalidateSharedControls(t.shared._id, request);
      t.updateOne.mockClear();

      await expect(t.fence()).rejects.toThrow();
      expect(t.updateOne).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing or inconsistent controls generation', async () => {
    const t = setup();
    t.rows.delete(t.shared._id);
    await expect(t.fence()).rejects.toThrow();
    t.rows.set(t.shared._id, { ...t.shared, generationId: id(9) });
    await expect(t.fence()).rejects.toThrow();
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects an invalid or exhausted revision %s',
    async (fenceRevision) => {
      const t = setup();
      t.rows.set(t.first._id, { ...t.first, fenceRevision });
      await expect(t.fence()).rejects.toThrow();
      expect(t.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2])(
    'propagates a conflict when write %i fails the CAS',
    async (write) => {
      const t = setup();
      if (write === 2) t.updateOne.mockResolvedValueOnce(saved);
      t.updateOne.mockResolvedValueOnce({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
      });
      await expect(t.fence()).rejects.toThrow();
      expect(t.updateOne).toHaveBeenCalledTimes(write);
    },
  );

  it('preserves the native write conflict for the caller transaction', async () => {
    const t = setup();
    const error = Object.assign(new Error('WriteConflict'), {
      errorLabels: ['TransientTransactionError'],
    });
    t.updateOne.mockResolvedValueOnce(saved).mockRejectedValueOnce(error);
    await expect(t.fence()).rejects.toBe(error);
  });
});

describe('Source operational accreditation with simulated Mongo', () => {
  function evidence(
    row: ReturnType<typeof profile>,
  ): ItemSourceOperationalAccreditation {
    return {
      profileDefinitionHash: row.profile.definitionHash,
      endpoint: 'DIRECT_S3',
      evidenceHash: 'b'.repeat(64),
      validFrom: '2026-11-07T14:15:00.000Z',
      validUntil: '2026-11-07T15:00:00.000Z',
    };
  }

  it('installs the first accreditation and fences the shared generation in the same session', async () => {
    const t = setup();
    const ref = reference(t.first);
    const accreditation = evidence(t.first);
    await expect(
      t.store.readActiveSourceAccreditation(ref),
    ).resolves.toBeNull();
    expect(t.updateOne).not.toHaveBeenCalled();
    await expect(
      t.store.provisionSourceAccreditation(ref, accreditation),
    ).resolves.toEqual({
      accreditation,
      replayed: false,
    });
    expect(t.updateOne.mock.calls).toEqual([
      [
        {
          _id: ref.id,
          protocol,
          row: 'PROFILE',
          'profile.id': ref.id,
          'profile.revision': ref.revision,
          'profile.definitionHash': ref.definitionHash,
          'profile.state': 'ACTIVE',
          invalidation: { $exists: false },
          accreditation: { $exists: false },
        },
        { $set: { accreditation } },
        { session: t.transaction, upsert: false },
      ],
      [
        {
          _id: t.shared._id,
          protocol,
          row: 'CONTROLS',
          generationId: t.shared.generationId,
          configurationHash: t.shared.configurationHash,
          state: 'ACTIVE',
          invalidation: { $exists: false },
          fenceRevision: { $exists: false },
        },
        { $inc: { fenceRevision: 1 } },
        { session: t.transaction, upsert: false },
      ],
    ]);
    expect(t.rows.get(ref.id)).toEqual({ ...t.first, accreditation });
    expect(t.rows.get(t.shared._id)).toEqual({ ...t.shared, fenceRevision: 1 });
    expect(t.rows.get(t.second._id)).toEqual(t.second);
    const reread = await t.store.readActiveSourceAccreditation(ref);
    expect(reread).toEqual({ profile: t.first.profile, accreditation });
    expect(Object.isFrozen(reread?.accreditation)).toBe(true);
    expect(t.updateOne).toHaveBeenCalledTimes(2);
  });

  it('replays an identical provisioning without writing and refuses replacement', async () => {
    const t = setup();
    const ref = reference(t.first);
    const accreditation = evidence(t.first);
    await t.store.provisionSourceAccreditation(ref, accreditation);
    await expect(
      t.store.provisionSourceAccreditation(ref, accreditation),
    ).resolves.toEqual({
      accreditation,
      replayed: true,
    });
    await expect(
      t.store.provisionSourceAccreditation(ref, {
        ...accreditation,
        validUntil: '2026-11-07T15:30:00.000Z',
      }),
    ).rejects.toThrow();
    expect(t.rows.get(ref.id)).toEqual({ ...t.first, accreditation });
    expect(t.updateOne).toHaveBeenCalledTimes(2);
  });

  it('reuses the caller session for both accreditation reads without opening another transaction', async () => {
    const t = setup();
    const ref = reference(t.first);
    const accreditation = evidence(t.first);
    await t.store.provisionSourceAccreditation(ref, accreditation);
    t.db.client.withSession.mockClear();
    t.findOne.mockClear();
    t.transaction.withTransaction.mockClear();
    await expect(
      t.transaction.withTransaction(() =>
        t.store.readActiveSourceAccreditation(
          ref,
          t.transaction as unknown as mongo.ClientSession,
        ),
      ),
    ).resolves.toEqual({ profile: t.first.profile, accreditation });
    expect(t.db.client.withSession).not.toHaveBeenCalled();
    expect(t.transaction.withTransaction).toHaveBeenCalledTimes(1);
    expect(t.findOne.mock.calls).toEqual([
      [{ _id: ref.id }, { session: t.transaction }],
      [{ _id: t.shared._id }, { session: t.transaction }],
    ]);
    expect(t.updateOne).toHaveBeenCalledTimes(2);
  });

  it('rejects a foreign session before reading either accreditation row', async () => {
    const t = setup();
    const foreign = { ...t.transaction, client: { withSession: jest.fn() } };
    await expect(
      t.store.readActiveSourceAccreditation(
        reference(t.first),
        foreign as unknown as mongo.ClientSession,
      ),
    ).rejects.toThrow();
    expect(t.findOne).not.toHaveBeenCalled();
    expect(t.db.client.withSession).not.toHaveBeenCalled();
  });

  it('rolls back the accreditation when the shared generation CAS fails', async () => {
    const t = setup();
    const update = t.updateOne.getMockImplementation()!;
    t.updateOne.mockImplementationOnce(update).mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    });
    await expect(
      t.store.provisionSourceAccreditation(
        reference(t.first),
        evidence(t.first),
      ),
    ).rejects.toThrow();
    expect(t.rows.get(t.first._id)).toEqual(t.first);
    expect(t.rows.get(t.shared._id)).toEqual(t.shared);
  });

  it.each(['profile', 'controls'] as const)(
    'blocks re-reading or provisioning when the %s is invalidated',
    async (target) => {
      const t = setup();
      const ref = reference(t.first);
      const accreditation = evidence(t.first);
      await t.store.provisionSourceAccreditation(ref, accreditation);
      if (target === 'profile') await t.store.invalidateProfile(ref, request);
      else await t.store.invalidateSharedControls(t.shared._id, request);
      const saved = structuredClone([...t.rows.values()]);
      t.updateOne.mockClear();
      await expect(
        t.store.readActiveSourceAccreditation(ref),
      ).rejects.toThrow();
      await expect(
        t.store.provisionSourceAccreditation(ref, accreditation),
      ).rejects.toThrow();
      expect([...t.rows.values()]).toEqual(saved);
      expect(t.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['bad evidence hash', { evidenceHash: 'unknown' }],
    ['another profile', { profileDefinitionHash: '0'.repeat(64) }],
    ['noncanonical date', { validFrom: '2026-11-07T14:15:00Z' }],
    ['empty interval', { validUntil: '2026-11-07T14:15:00.000Z' }],
    [
      'disjoint interval',
      {
        validFrom: '2026-11-07T13:15:00.000Z',
        validUntil: '2026-11-07T14:00:00.000Z',
      },
    ],
  ] as const)('rejects provisioning with %s', async (_, change) => {
    const t = setup();
    await expect(
      t.store.provisionSourceAccreditation(reference(t.first), {
        ...evidence(t.first),
        ...change,
      }),
    ).rejects.toThrow();
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a stale revision or a missing controls row without creating anything', async () => {
    const t = setup();
    const ref = reference(t.first);
    const accreditation = evidence(t.first);
    await expect(
      t.store.provisionSourceAccreditation(
        { ...ref, revision: 2 },
        accreditation,
      ),
    ).rejects.toThrow();
    t.rows.delete(t.shared._id);
    await expect(t.store.readActiveSourceAccreditation(ref)).rejects.toThrow();
    await expect(
      t.store.provisionSourceAccreditation(ref, accreditation),
    ).rejects.toThrow();
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('rejects corrupt persisted accreditation without changing observational profile reads', async () => {
    const t = setup();
    const ref = reference(t.first);
    t.rows.set(t.first._id, {
      ...t.first,
      accreditation: {
        ...evidence(t.first),
        profileDefinitionHash: '0'.repeat(64),
      },
    });
    await expect(t.store.readActiveSourceAccreditation(ref)).rejects.toThrow();
    await expect(t.store.readCurrentSourceProfile(ref.id)).resolves.toEqual(
      t.first.profile,
    );
    await expect(
      t.store.provisionSourceAccreditation(ref, evidence(t.first)),
    ).rejects.toThrow();
    expect(t.updateOne).not.toHaveBeenCalled();
  });
});
