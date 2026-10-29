import { mongo } from 'mongoose';
import {
  MediaPromotionIndexMaintenance,
  PromotionIndexAction,
  PromotionIndexMaintenanceError,
  PromotionIndexMaintenancePort,
} from '../../../src/context/animal-media/application/media-promotion-index-maintenance';
import {
  assessPromotionMongoRequirements,
  PROMOTION_MONGO_REQUIREMENTS,
  PromotionMongoMetadata,
} from '../../../src/context/animal-media/domain/media-promotion-mongo-requirements';
import { MongoMediaPromotionIndexMaintenance } from '../../../src/context/animal-media/infrastructure/mongo-media-promotion-index-maintenance';

const at = '2026-10-29T03:00:00.000Z';
function fixture(missing = true) {
  const metadata: PromotionMongoMetadata = {
    hello: {
      setName: 'test',
      isWritablePrimary: true,
      logicalSessionTimeoutMinutes: 30,
    },
    collections: missing
      ? []
      : PROMOTION_MONGO_REQUIREMENTS.map((c) => ({
          name: c.name,
          type: 'collection',
          options: {},
          indexes: c.indexes.map((i) => ({
            key: { ...i.key },
            unique: i.unique,
            partialFilterExpression: i.partialFilterExpression,
          })),
        })),
  };
  const inspect = jest.fn(() =>
    Promise.resolve(assessPromotionMongoRequirements(metadata, at)),
  );
  const create = jest.fn<Promise<void>, [PromotionIndexAction]>((action) => {
    if (action.type === 'CREATE_COLLECTION')
      metadata.collections.push({
        name: action.collection,
        type: 'collection',
        options: {},
        indexes: [],
      });
    else
      metadata.collections
        .find((c) => c.name === action.collection)!
        .indexes.push({ key: { ...action.key }, ...action.options });
    return Promise.resolve();
  });
  const port = { inspect, create } satisfies PromotionIndexMaintenancePort;
  const operator = () => new MediaPromotionIndexMaintenance(port, 'synthetic');
  return { metadata, inspect, create, port, operator };
}
function removeOne(f: ReturnType<typeof fixture>) {
  f.metadata.collections[0].indexes.shift();
}

describe('Explicit versioned promotion index prepare/apply, simulated metadata/DDL', () => {
  it('prepares all four collections and 14 indexes without invoking DDL', async () => {
    const f = fixture(),
      plan = await f.operator().prepare();
    expect(plan).toMatchObject({
      databaseName: 'synthetic',
      version: 'MEDIA_PROMOTION_INDEX_PLAN_V1',
      status: 'READY',
    });
    expect(plan.actions).toHaveLength(18);
    expect(plan.planId).toMatch(/^[a-f0-9]{64}$/);
    expect(f.create).not.toHaveBeenCalled();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.actions)).toBe(true);
    for (const action of plan.actions) {
      expect(Object.isFrozen(action)).toBe(true);
      if (action.key) expect(Object.isFrozen(action.key)).toBe(true);
    }
  });
  it('applies only the reviewed additions in order, reobserves each step, and keeps activation disabled', async () => {
    const f = fixture(),
      op = f.operator(),
      plan = await op.prepare();
    const result = await op.apply({
      databaseName: 'synthetic',
      reviewedPlanId: plan.planId,
    });
    expect(f.create.mock.calls.map(([a]) => a)).toEqual(plan.actions);
    expect(result.acknowledgedActionIds).toEqual(plan.actions.map((a) => a.id));
    expect(f.inspect).toHaveBeenCalledTimes(20);
    expect(result.report).toMatchObject({
      status: 'SATISFIED',
      transactions: 'NOT_PROBED',
      data: 'NOT_ASSESSED',
      activation: 'DISABLED',
    });
  });
  it('an explicit later plan is idempotent and performs no DDL', async () => {
    const f = fixture(),
      op = f.operator(),
      plan = await op.prepare();
    await op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId });
    f.create.mockClear();
    const later = f.operator(),
      observed = await later.prepare();
    expect(observed.status).toBe('NO_CHANGES');
    expect(
      (
        await later.apply({
          databaseName: 'synthetic',
          reviewedPlanId: observed.planId,
        })
      ).acknowledgedActionIds,
    ).toEqual([]);
    expect(f.create).not.toHaveBeenCalled();
  });
  it('plans only a missing index on existing data, without claiming uniqueness or probing documents', async () => {
    const f = fixture(false);
    removeOne(f);
    const op = f.operator(),
      plan = await op.prepare();
    expect(plan.actions.map((a) => a.id)).toEqual(['PROMOTION_ID']);
    await op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId });
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('hash ignores observation time and issue order but binds database and actual planned changes', async () => {
    const f = fixture(false);
    removeOne(f);
    const first = await f.operator().prepare();
    const base = await f.inspect();
    f.inspect.mockResolvedValue({
      ...base,
      observedAt: '2026-10-29T04:00:00.000Z',
      issues: [...base.issues].reverse(),
    });
    expect((await f.operator().prepare()).planId).toBe(first.planId);
    expect(
      (await new MediaPromotionIndexMaintenance(f.port, 'other').prepare())
        .planId,
    ).not.toBe(first.planId);
    f.inspect.mockRestore();
  });
  it.each([
    'TOPOLOGY_NOT_VALIDATED',
    'COLLECTION_OPTIONS',
    'INDEX_OPTIONS',
    'TTL_PRESENT',
    'UNREVIEWED_UNIQUE_INDEX',
  ] as const)(
    'blocks the entire plan on %s, including otherwise missing indexes',
    async (code) => {
      const f = fixture(false);
      removeOne(f);
      const report = await f.inspect();
      f.inspect.mockResolvedValue({
        ...report,
        issues: [
          ...report.issues,
          { code, collection: 'animal_media_uploads' },
        ],
      });
      const op = f.operator(),
        plan = await op.prepare();
      expect(plan.status).toBe('BLOCKED');
      expect(plan.actions).toHaveLength(0);
      await expect(
        op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
      ).rejects.toMatchObject({
        stage: 'REVIEW',
        reason: 'BLOCKED',
        acknowledgedActionIds: [],
      });
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it.each(['unknown-collection', 'unknown-index', 'unknown-code'] as const)(
    'blocks malformed requirement references: %s',
    async (mode) => {
      const f = fixture(false),
        report = await f.inspect();
      f.inspect.mockResolvedValue({
        ...report,
        status: 'BLOCKED',
        issues: [
          {
            code:
              mode === 'unknown-code' ? ('OTHER' as never) : 'INDEX_MISSING',
            collection:
              mode === 'unknown-collection' ? 'users' : 'animal_media_uploads',
            requirementId: 'UNKNOWN',
          },
        ],
      });
      expect((await f.operator().prepare()).status).toBe('BLOCKED');
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it.each(['target', 'digest', 'format'] as const)(
    'denies unreviewed input %s before DDL',
    async (mode) => {
      const f = fixture(),
        op = f.operator(),
        plan = await op.prepare();
      await expect(
        op.apply({
          databaseName: mode === 'target' ? 'other' : 'synthetic',
          reviewedPlanId:
            mode === 'format'
              ? 'invalid'
              : mode === 'digest'
                ? 'a'.repeat(64)
                : plan.planId,
        }),
      ).rejects.toBeInstanceOf(PromotionIndexMaintenanceError);
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it('rejects pre-apply catalog drift instead of silently using another plan', async () => {
    const f = fixture(false);
    removeOne(f);
    const op = f.operator(),
      plan = await op.prepare();
    f.metadata.collections.pop();
    await expect(
      op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({ stage: 'REVIEW', reason: 'CHANGED' });
    expect(f.create).not.toHaveBeenCalled();
  });
  it('stops after partial DDL if a concurrent change alters the remaining actions', async () => {
    const f = fixture(),
      op = f.operator(),
      plan = await op.prepare(),
      create = f.create.getMockImplementation()!;
    f.create.mockImplementation(async (action) => {
      await create(action);
      f.metadata.collections[0].indexes.push({
        key: { arbitrary: 1 },
        unique: true,
      });
    });
    await expect(
      op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({
      stage: 'REVIEW',
      reason: 'CHANGED',
      acknowledgedActionIds: ['COLLECTION:animal_media_promotion_records'],
    });
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    'a DDL error (changed catalog=%s) stays uncertain, does not retry or infer rollback',
    async (changed) => {
      const f = fixture(false);
      removeOne(f);
      const op = f.operator(),
        plan = await op.prepare(),
        create = f.create.getMockImplementation()!;
      f.create.mockImplementation(async (action) => {
        if (changed) await create(action);
        throw Object.assign(new Error('mongodb://secret duplicate data'), {
          code: 11000,
        });
      });
      let failure: unknown;
      try {
        await op.apply({
          databaseName: 'synthetic',
          reviewedPlanId: plan.planId,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        stage: 'APPLY',
        reason: 'UNCERTAIN',
        actionId: 'PROMOTION_ID',
        acknowledgedActionIds: [],
      });
      expect(String(failure)).not.toMatch(/secret|mongodb|duplicate/);
      expect(Object.prototype.hasOwnProperty.call(failure, 'cause')).toBe(
        false,
      );
      expect(f.create).toHaveBeenCalledTimes(1);
      await expect(
        op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
      ).rejects.toMatchObject({ stage: 'LIFECYCLE' });
      expect(f.create).toHaveBeenCalledTimes(1);
    },
  );
  it('returns acknowledged steps when the next DDL result is uncertain', async () => {
    const f = fixture(),
      op = f.operator(),
      plan = await op.prepare();
    f.create
      .mockImplementationOnce(f.create.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('secret'));
    await expect(
      op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({
      stage: 'APPLY',
      reason: 'UNCERTAIN',
      acknowledgedActionIds: ['COLLECTION:animal_media_promotion_records'],
      actionId: 'PROMOTION_ID',
    });
  });
  it('does not return success if final observation fails after all additions were acknowledged', async () => {
    const f = fixture(false);
    removeOne(f);
    const op = f.operator(),
      plan = await op.prepare();
    const inspect = f.inspect.getMockImplementation()!;
    f.inspect
      .mockImplementationOnce(inspect)
      .mockRejectedValueOnce(new Error('secret'));
    await expect(
      op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({
      stage: 'INSPECT',
      reason: 'UNAVAILABLE',
      acknowledgedActionIds: ['PROMOTION_ID'],
    });
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('denies concurrent/repeated applies while an operation is pending', async () => {
    const f = fixture(false);
    removeOne(f);
    const op = f.operator(),
      plan = await op.prepare();
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inspect = f.inspect.getMockImplementation()!;
    f.inspect.mockImplementationOnce(async () => {
      await pause;
      return inspect();
    });
    const pending = op.apply({
      databaseName: 'synthetic',
      reviewedPlanId: plan.planId,
    });
    try {
      await expect(
        op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
      ).rejects.toMatchObject({ stage: 'LIFECYCLE' });
    } finally {
      release();
      await pending;
    }
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('captures reviewed input before the first await', async () => {
    const f = fixture(false);
    removeOne(f);
    const op = f.operator(),
      plan = await op.prepare();
    const raw = { databaseName: 'synthetic', reviewedPlanId: plan.planId };
    const pending = op.apply(raw);
    raw.databaseName = 'other';
    raw.reviewedPlanId = 'b'.repeat(64);
    expect((await pending).planId).toBe(plan.planId);
  });
  it('redacts invalid metadata or inspector failures instead of returning executable plans', async () => {
    const f = fixture();
    f.inspect.mockRejectedValueOnce(new Error('secret'));
    await expect(f.operator().prepare()).rejects.toMatchObject({
      stage: 'INSPECT',
      reason: 'UNAVAILABLE',
    });
    f.inspect.mockResolvedValueOnce({
      ...(await f.inspect()),
      version: 'FUTURE' as never,
    });
    await expect(f.operator().prepare()).rejects.toMatchObject({
      stage: 'INSPECT',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it('rejects an absent target before inspecting', async () => {
    const f = fixture();
    await expect(
      new MediaPromotionIndexMaintenance(f.port, '').prepare(),
    ).rejects.toMatchObject({ stage: 'INPUT' });
    expect(f.inspect).not.toHaveBeenCalled();
  });

  it('does not adopt an index installed concurrently after its first acknowledged step', async () => {
    const f = fixture(),
      op = f.operator(),
      plan = await op.prepare();
    const create = f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(async (action) => {
      await create(action);
      const next = plan.actions[1];
      f.metadata.collections[0].indexes.push({
        key: { ...next.key },
        ...next.options,
      });
    });
    await expect(
      op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({
      stage: 'REVIEW',
      reason: 'CHANGED',
      acknowledgedActionIds: ['COLLECTION:animal_media_promotion_records'],
    });
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('does not treat a DDL acknowledgement as a substitute for final metadata verification', async () => {
    const f = fixture(false);
    removeOne(f);
    const op = f.operator(),
      plan = await op.prepare();
    f.create.mockResolvedValueOnce(undefined);
    await expect(
      op.apply({ databaseName: 'synthetic', reviewedPlanId: plan.planId }),
    ).rejects.toMatchObject({
      stage: 'REVIEW',
      reason: 'CHANGED',
      acknowledgedActionIds: ['PROMOTION_ID'],
    });
  });

  function ddlFixture() {
    const createIndex = jest.fn().mockResolvedValue('index');
    const collection = jest.fn().mockReturnValue({ createIndex });
    const createCollection = jest.fn().mockResolvedValue({});
    const db = {
      databaseName: 'synthetic',
      collection,
      createCollection,
    } as unknown as mongo.Db;
    const port = new MongoMediaPromotionIndexMaintenance(db, 'synthetic');
    return { db, port, createIndex, collection, createCollection };
  }
  it('Mongo DDL adapter uses only manifest options and majority, with no passthrough of hostile index settings', async () => {
    const f = fixture(),
      plan = await f.operator().prepare(),
      ddl = ddlFixture();
    const action = plan.actions.find((a) => a.id === 'PROMOTION_UPLOAD')!;
    await ddl.port.create({
      ...action,
      key: { secret: -1 },
      options: { name: 'hostile' },
    });
    expect(ddl.collection).toHaveBeenCalledWith(
      'animal_media_promotion_records',
      { writeConcern: { w: 'majority', wtimeoutMS: 10000 } },
    );
    expect(ddl.createIndex).toHaveBeenCalledWith(
      { operationId: 1, uploadId: 1 },
      {
        name: 'ar_promotion_v1_promotion_upload',
        unique: true,
        partialFilterExpression: { kind: 'EFFECT' },
        collation: { locale: 'simple' },
        commitQuorum: 'majority',
        maxTimeMS: 60000,
      },
    );
    expect(ddl.createCollection).not.toHaveBeenCalled();
  });
  it('Mongo DDL adapter creates only a plain manifest collection with explicit simple collation/majority', async () => {
    const ddl = ddlFixture();
    await ddl.port.create({
      id: 'COLLECTION:animal_media_promotion_records',
      collection: 'animal_media_promotion_records',
      type: 'CREATE_COLLECTION',
    });
    expect(ddl.createCollection).toHaveBeenCalledWith(
      'animal_media_promotion_records',
      {
        collation: { locale: 'simple' },
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
        maxTimeMS: 60000,
      },
    );
    expect(ddl.collection).not.toHaveBeenCalled();
  });
  it.each(['foreign', 'id', 'wrong-kind', 'target'] as const)(
    'Mongo DDL adapter rejects invalid %s action before DDL',
    async (mode) => {
      const ddl = ddlFixture();
      const port =
        mode === 'target'
          ? new MongoMediaPromotionIndexMaintenance(ddl.db, 'other')
          : ddl.port;
      await expect(
        port.create({
          id: mode === 'id' ? 'UNKNOWN' : 'PROMOTION_ID',
          collection:
            mode === 'foreign' ? 'users' : 'animal_media_promotion_records',
          type: mode === 'wrong-kind' ? ('DROP' as never) : 'CREATE_INDEX',
        }),
      ).rejects.toThrow();
      expect(ddl.createCollection).not.toHaveBeenCalled();
      expect(ddl.collection).not.toHaveBeenCalled();
    },
  );
});
