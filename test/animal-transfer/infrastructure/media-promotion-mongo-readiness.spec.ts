import { mongo, Schema } from 'mongoose';
import {
  assessPromotionMongoRequirements,
  PROMOTION_MONGO_REQUIREMENTS,
  PROMOTION_MONGO_REQUIREMENTS_VERSION,
  PromotionMongoMetadata,
} from '../../../src/context/animal-media/domain/media-promotion-mongo-requirements';
import {
  MediaPromotionReadinessError,
  MongoMediaPromotionReadiness,
} from '../../../src/context/animal-media/infrastructure/mongo-media-promotion-readiness';
import { MediaPromotionRecordSchema } from '../../../src/context/animal-media/infrastructure/media-promotion-record.schema';
import { AnimalMediaUploadSchema } from '../../../src/context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import { AnimalWriteJournalSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';
import { AnimalOwnershipControlSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { MediaPromotionPersistenceModule } from '../../../src/app/animal-media/media-promotion-persistence.module';

const at = '2026-10-29T03:00:00.000Z';
const schemas: Array<[string, Schema]> = [
  ['animal_media_promotion_records', MediaPromotionRecordSchema],
  ['animal_media_uploads', AnimalMediaUploadSchema],
  ['animal_write_journals', AnimalWriteJournalSchema],
  ['animal_ownership_controls', AnimalOwnershipControlSchema],
];
function metadata(): PromotionMongoMetadata {
  return {
    hello: {
      setName: 'synthetic-rs',
      isWritablePrimary: true,
      logicalSessionTimeoutMinutes: 30,
    },
    collections: schemas.map(([name, schema]) => ({
      name,
      type: 'collection',
      options: {},
      indexes: [
        { name: '_id_', key: { _id: 1 } },
        ...schema.indexes().map(([key, options], i) => ({
          name: `arbitrary_${i}`,
          key: { ...key },
          ...structuredClone(options),
        })),
      ],
    })),
  };
}
function fixture(input = metadata()) {
  const hello = jest.fn().mockResolvedValue(input.hello);
  const collectionMetadata = () =>
    input.collections.map((c) => ({
      name: c.name,
      type: c.type,
      options: c.options,
    }));
  const catalog = jest.fn(() => Promise.resolve(collectionMetadata()));
  const readers = new Map(
    input.collections.map((c) => [
      c.name,
      jest.fn().mockResolvedValue(c.indexes),
    ]),
  );
  const listCollections = jest
    .fn()
    .mockReturnValue(Object.freeze({ toArray: catalog }));
  const collection = jest.fn().mockImplementation((name: string) =>
    Object.freeze({
      listIndexes: (options: unknown) => {
        expect(options).toEqual({ readPreference: 'primary', maxTimeMS: 5000 });
        const reader = readers.get(name);
        if (!reader) throw new Error('Unbound collection');
        return Object.freeze({ toArray: reader });
      },
    }),
  );
  // Only metadata capabilities; accidental connection/DDL/DML/session methods fail.
  const db = Object.freeze({
    databaseName: 'synthetic',
    admin: () => Object.freeze({ command: hello }),
    listCollections,
    collection,
  });
  const inspect = (expected = 'synthetic') =>
    new MongoMediaPromotionReadiness(
      db as unknown as mongo.Db,
      expected,
    ).inspect();
  return {
    input,
    db,
    hello,
    catalog,
    readers,
    listCollections,
    collection,
    inspect,
  };
}
const assess = (m: PromotionMongoMetadata) =>
  assessPromotionMongoRequirements(m, at);

describe('Versioned promotion Mongo prerequisites, no connections or index installation', () => {
  it('pins all 14 schema-declared indexes to the explicit manifest and freezes its nested values', () => {
    const expected = schemas.map(([name, schema]) => ({
      name,
      indexes: schema.indexes().map(([key, options]) => ({
        key,
        unique: options.unique === true,
        partial: options.partialFilterExpression,
      })),
    }));
    const required = PROMOTION_MONGO_REQUIREMENTS.map((c) => ({
      name: c.name,
      indexes: c.indexes.map((i) => ({
        key: i.key,
        unique: i.unique === true,
        partial: i.partialFilterExpression,
      })),
    }));
    expect(required).toEqual(expected);
    expect(required.reduce((n, c) => n + c.indexes.length, 0)).toBe(14);
    expect(Object.isFrozen(PROMOTION_MONGO_REQUIREMENTS)).toBe(true);
    for (const c of PROMOTION_MONGO_REQUIREMENTS) {
      expect(Object.isFrozen(c)).toBe(true);
      expect(Object.isFrozen(c.indexes)).toBe(true);
      for (const i of c.indexes) {
        expect(Object.isFrozen(i)).toBe(true);
        expect(Object.isFrozen(i.key)).toBe(true);
        if (i.partialFilterExpression)
          expect(Object.isFrozen(i.partialFilterExpression)).toBe(true);
      }
    }
  });
  it('observes compatible prerequisites without turning metadata into permission, data review or a transaction probe', () => {
    const m = metadata(),
      before = structuredClone(m),
      report = assess(m);
    expect(report).toEqual({
      version: PROMOTION_MONGO_REQUIREMENTS_VERSION,
      observedAt: at,
      status: 'SATISFIED',
      transactions: 'NOT_PROBED',
      data: 'NOT_ASSESSED',
      activation: 'DISABLED',
      issues: [],
    });
    expect(m).toEqual(before);
    m.hello.isWritablePrimary = false;
    expect(report.status).toBe('SATISFIED'); // Old observation stays old; no fence or authority.
    expect(assess(m).status).toBe('BLOCKED');
  });
  it.each([
    'standalone',
    'secondary',
    'mongos',
    'no-session',
    'zero-session',
    'invalid-session',
  ] as const)('does not validate topology %s', (mode) => {
    const m = metadata();
    if (mode === 'standalone' || mode === 'mongos') delete m.hello.setName;
    if (mode === 'secondary') m.hello.isWritablePrimary = false;
    if (mode === 'mongos') m.hello.msg = 'isdbgrid';
    if (mode === 'no-session') delete m.hello.logicalSessionTimeoutMinutes;
    if (mode === 'zero-session') m.hello.logicalSessionTimeoutMinutes = 0;
    if (mode === 'invalid-session') m.hello.logicalSessionTimeoutMinutes = NaN;
    expect(assess(m).issues).toContainEqual({ code: 'TOPOLOGY_NOT_VALIDATED' });
  });
  it.each([
    'view',
    'missing-type',
    'capped',
    'timeseries',
    'expires',
    'collation',
    'duplicate',
  ] as const)('blocks incompatible collection metadata %s', (mode) => {
    const m = metadata(),
      c = m.collections[0];
    if (mode === 'view') c.type = 'view';
    if (mode === 'missing-type') delete c.type;
    if (mode === 'capped') c.options = { capped: true };
    if (mode === 'timeseries') c.options = { timeseries: {} };
    if (mode === 'expires') c.options = { expireAfterSeconds: 3600 };
    if (mode === 'collation') c.options = { collation: { locale: 'es' } };
    if (mode === 'duplicate') m.collections.push(structuredClone(c));
    expect(assess(m).issues).toContainEqual({
      code: 'COLLECTION_OPTIONS',
      collection: c.name,
    });
  });
  it('reports a missing collection independently of missing indexes', () => {
    const m = metadata(),
      removed = m.collections.pop()!;
    expect(assess(m).issues).toEqual([
      { code: 'COLLECTION_MISSING', collection: removed.name },
    ]);
  });
  it.each([
    'missing',
    'order',
    'direction',
    'unique',
    'sparse',
    'hidden',
    'partial',
    'partial-equivalent',
    'collation',
    'building',
    'not-ready',
    'prepare-unique',
  ] as const)('blocks drift of required index %s', (mode) => {
    const m = metadata(),
      c = m.collections[0],
      index = c.indexes.find(
        (i) => (i.key as Record<string, unknown>).uploadId === 1,
      )!;
    if (mode === 'missing') c.indexes = c.indexes.filter((i) => i !== index);
    if (mode === 'order') index.key = { uploadId: 1, operationId: 1 };
    if (mode === 'direction') index.key = { operationId: -1, uploadId: 1 };
    if (mode === 'unique') index.unique = false;
    if (mode === 'sparse') index.sparse = true;
    if (mode === 'hidden') index.hidden = true;
    if (mode === 'partial') delete index.partialFilterExpression;
    if (mode === 'partial-equivalent')
      index.partialFilterExpression = { kind: { $eq: 'EFFECT' } };
    if (mode === 'collation') index.collation = { locale: 'en' };
    if (mode === 'building') index.buildUUID = 'in-progress';
    if (mode === 'not-ready') index.ready = false;
    if (mode === 'prepare-unique') index.prepareUnique = true;
    expect(assess(m).issues).toContainEqual({
      collection: c.name,
      requirementId: 'PROMOTION_UPLOAD',
      code: ['missing', 'order', 'direction'].includes(mode)
        ? 'INDEX_MISSING'
        : 'INDEX_OPTIONS',
    });
  });
  it.each(['required', 'extra', '_id'] as const)(
    'rejects TTL on %s index without proposing automatic removal',
    (mode) => {
      const m = metadata(),
        c = m.collections[0];
      if (mode === 'extra')
        c.indexes.push({ key: { createdAt: 1 }, expireAfterSeconds: 3600 });
      else c.indexes[mode === '_id' ? 0 : 1].expireAfterSeconds = 0;
      expect(assess(m).issues).toContainEqual({
        code: 'TTL_PRESENT',
        collection: c.name,
      });
    },
  );
  it.each(['extra-field', 'shadow-partial', 'stronger-page'] as const)(
    'does not accept unreviewed uniqueness constraints (%s)',
    (mode) => {
      const m = metadata(),
        c = m.collections[0];
      if (mode === 'extra-field')
        c.indexes.push({ key: { arbitrary: 1 }, unique: true });
      if (mode === 'shadow-partial')
        c.indexes.push({ key: { operationId: 1, uploadId: 1 }, unique: true });
      if (mode === 'stronger-page')
        c.indexes.find(
          (i) => (i.key as Record<string, unknown>).kind === 1,
        )!.unique = true;
      expect(assess(m).issues).toContainEqual({
        code: 'UNREVIEWED_UNIQUE_INDEX',
        collection: c.name,
      });
    },
  );
  it('accepts distinct index names, explicit simple collation/default booleans and extra nonunique indexes', () => {
    const m = metadata();
    for (const c of m.collections) {
      c.options = { collation: { locale: 'simple' }, capped: false };
      for (const i of c.indexes)
        Object.assign(i, {
          name: 'different',
          sparse: false,
          hidden: false,
          prepareUnique: false,
          collation: { locale: 'simple' },
        });
      c.indexes.push({
        name: 'extra_read',
        key: { arbitrary: -1 },
        sparse: true,
      });
    }
    expect(assess(m).status).toBe('SATISFIED');
  });
  it('requires a valid observation timestamp', () => {
    expect(() =>
      assessPromotionMongoRequirements(metadata(), 'invalid'),
    ).toThrow('valid observation timestamp');
  });
  it('only reads primary metadata through the supplied Db and returns no raw metadata', async () => {
    const f = fixture(),
      report = await f.inspect();
    expect(f.hello).toHaveBeenCalledWith(
      { hello: 1 },
      { readPreference: 'primary', maxTimeMS: 5000 },
    );
    expect(f.hello).toHaveBeenCalledTimes(1);
    expect(f.listCollections).toHaveBeenCalledWith(
      { name: { $in: schemas.map(([name]) => name) } },
      {
        readPreference: 'primary',
        maxTimeMS: 5000,
        nameOnly: false,
        authorizedCollections: false,
      },
    );
    expect(f.collection.mock.calls.map((args: unknown[]) => args[0])).toEqual(
      schemas.map(([name]) => name),
    );
    expect(report.status).toBe('SATISFIED');
    expect(Number.isFinite(Date.parse(report.observedAt))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('synthetic-rs');
  });
  it('never lists indexes of missing collections or views', async () => {
    const m = metadata();
    m.collections.pop();
    m.collections[0].type = 'view';
    const f = fixture(m),
      report = await f.inspect();
    expect(report.status).toBe('BLOCKED');
    expect(f.collection).toHaveBeenCalledTimes(2);
  });
  it.each(['', 'other'])(
    'rejects target %s before touching metadata',
    async (expected) => {
      const f = fixture();
      await expect(f.inspect(expected)).rejects.toMatchObject({
        stage: 'TARGET',
      });
      expect(f.hello).not.toHaveBeenCalled();
      expect(f.listCollections).not.toHaveBeenCalled();
    },
  );
  it.each(['hello', 'collections', 'indexes'] as const)(
    'redacts %s failure and never reports partial success or an empty catalog',
    async (stage) => {
      const f = fixture();
      const error = Object.assign(
        new Error('mongodb://secret credentials documents'),
        { code: 26 },
      );
      if (stage === 'hello') f.hello.mockRejectedValueOnce(error);
      if (stage === 'collections') f.catalog.mockRejectedValueOnce(error);
      if (stage === 'indexes')
        f.readers
          .get('animal_media_promotion_records')!
          .mockRejectedValueOnce(error);
      let failure: unknown;
      try {
        await f.inspect();
      } catch (caught) {
        failure = caught;
      }
      expect(failure).toBeInstanceOf(MediaPromotionReadinessError);
      expect(failure).toMatchObject({ stage: 'METADATA' });
      expect(String(failure)).not.toMatch(
        /mongodb|secret|credentials|documents/,
      );
      expect(Object.prototype.hasOwnProperty.call(failure, 'cause')).toBe(
        false,
      );
    },
  );
  it('remains outside providers and does not change automatic schema/index creation', () => {
    const providers = Reflect.getMetadata(
      'providers',
      MediaPromotionPersistenceModule,
    ) as unknown[];
    expect(providers).not.toContain(MongoMediaPromotionReadiness);
    expect(MediaPromotionRecordSchema.get('autoCreate')).toBe(false);
    expect(MediaPromotionRecordSchema.get('autoIndex')).toBe(false);
  });
});
