import {
  MongoTransferFlowReadiness,
  FlowInspectionDb,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-flow-readiness';
import { MongoTransferFlowIndexMaintenance } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-flow-index-maintenance';
import {
  completeFlowMetadata,
  flowTarget,
} from '../fixtures/transfer-flow-requirements.fixture';
import { FLOW_REQUIREMENTS } from '../../../src/context/animal-transfer/domain/transfer-flow-mongo-requirements';
import { mongo } from 'mongoose';
function fixture() {
  const metadata = completeFlowMetadata(),
    calls: Array<{
      action: string;
      collection?: string;
      input?: unknown;
      options?: unknown;
    }> = [];
  const flags = { failed: false, malformed: false };
  const db = {
    databaseName: flowTarget.databaseName,
    client: { options: { timeoutMS: undefined as number | undefined } },
    admin: () => ({
      command: (input: unknown, options: unknown) => {
        calls.push({ action: 'hello', input, options });
        return Promise.resolve(metadata.hello);
      },
    }),
    listCollections: (input: unknown, options: unknown) => ({
      toArray: () => {
        calls.push({ action: 'listCollections', input, options });
        return Promise.resolve(
          metadata.collections.map(({ name, type, options }) => ({
            name,
            type,
            options,
          })),
        );
      },
    }),
    collection: (name: string, options?: unknown) => ({
      listIndexes: (input: unknown) => ({
        toArray: () => {
          calls.push({ action: 'listIndexes', collection: name, input });
          if (flags.failed)
            return Promise.reject(new Error('private credentials / document'));
          return Promise.resolve(
            flags.malformed
              ? [42]
              : metadata.collections.find((c) => c.name === name)!.indexes,
          );
        },
      }),
      createIndex: (key: unknown, indexOptions: unknown) => {
        calls.push({
          action: 'createIndex',
          collection: name,
          input: { key, indexOptions },
          options,
        });
        return Promise.resolve('ack');
      },
    }),
    createCollection: (name: string, options: unknown) => {
      calls.push({ action: 'createCollection', collection: name, options });
      return Promise.resolve();
    },
  };
  const bound = db as unknown as FlowInspectionDb &
    Pick<mongo.Db, 'createCollection'>;
  return {
    db,
    metadata,
    calls,
    flags,
    inspector: new MongoTransferFlowReadiness(bound, flowTarget),
    maintenance: new MongoTransferFlowIndexMaintenance(bound, flowTarget),
  };
}
describe('Mongo metadata/DDL contracts on supplied Db, no connection', () => {
  it('reads only hello/listCollections/listIndexes for its closed manifest, projecting a safe bounded report', async () => {
    const f = fixture(),
      report = await f.inspector.inspect();
    expect(report.status).toBe('SATISFIED');
    expect(f.calls).toHaveLength(17);
    expect(f.calls[1]).toMatchObject({
      action: 'listCollections',
      input: { name: { $in: FLOW_REQUIREMENTS.map((c) => c.name) } },
      options: {
        nameOnly: false,
        authorizedCollections: false,
        readPreference: 'primary',
        maxTimeMS: 5000,
        timeoutMS: 5000,
      },
    });
    expect(
      f.calls
        .filter((c) => c.action === 'listIndexes')
        .map((c) => c.collection),
    ).toEqual(FLOW_REQUIREMENTS.map((c) => c.name));
    expect(JSON.stringify(report)).not.toMatch(
      /password|proof|token|uri|indexes/,
    );
    expect(
      f.calls.some((c) => /create|find|count|aggregate/i.test(c.action)),
    ).toBe(false);
  });
  it('refuses a changed database before issuing any command and captures the expected target', async () => {
    const f = fixture();
    f.db.databaseName = 'different';
    await expect(f.inspector.inspect()).rejects.toMatchObject({
      stage: 'TARGET',
    });
    expect(f.calls).toEqual([]);
  });
  it('does not inspect a view backing collection', async () => {
    const f = fixture();
    f.metadata.collections[4].type = 'view';
    expect((await f.inspector.inspect()).status).toBe('BLOCKED');
    expect(
      f.calls.filter(
        (c) =>
          c.action === 'listIndexes' && c.collection === 'animal_transfer_otp',
      ),
    ).toEqual([]);
  });
  it.each(['failed', 'malformed'] as const)(
    'sanitizes %s metadata rather than reporting ready',
    async (kind) => {
      const f = fixture();
      f.flags[kind] = true;
      const error: unknown = await f.inspector
        .inspect()
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ stage: 'METADATA' });
      expect(String(error)).not.toMatch(/private|credentials/);
    },
  );
  it('checks actual client timeout compatibility without serializing client settings', async () => {
    const f = fixture();
    f.db.client.options.timeoutMS = 15000;
    const report = await f.inspector.inspect();
    expect(report.issues).toContainEqual({ code: 'CLIENT_TIMEOUT' });
    const plan = await f.maintenance.operator().prepare();
    expect(plan.status).toBe('BLOCKED');
    expect(plan.actions).toEqual([]);
  });
  it('creates only manifest-owned ordinary collections or indexes with fixed options and bounded majority commands', async () => {
    const f = fixture();
    await f.maintenance.create({
      type: 'CREATE_COLLECTION',
      collection: 'notification_push_attempts',
      id: 'COLLECTION:notification_push_attempts',
    });
    await f.maintenance.create({
      type: 'CREATE_INDEX',
      collection: 'notification_push_attempts',
      id: 'ATTEMPT_ORDINAL',
    });
    expect(f.calls[0]).toMatchObject({
      action: 'createCollection',
      options: {
        collation: { locale: 'simple' },
        writeConcern: { w: 'majority' },
        maxTimeMS: 60000,
        timeoutMS: 65000,
      },
    });
    expect(f.calls[1]).toMatchObject({
      action: 'createIndex',
      input: {
        key: { deliveryId: 1, ordinal: 1 },
        indexOptions: {
          unique: true,
          name: 'ar_flow_v1_attempt_ordinal',
          collation: { locale: 'simple' },
          commitQuorum: 'majority',
          maxTimeMS: 60000,
        },
      },
    });
  });
  it.each(['shared', 'arbitrary', 'native-id', 'options'] as const)(
    'rejects %s DDL inputs without touching Mongo',
    async (kind) => {
      const f = fixture();
      const action =
        kind === 'shared'
          ? {
              type: 'CREATE_COLLECTION',
              collection: 'users',
              id: 'COLLECTION:users',
            }
          : kind === 'native-id'
            ? {
                type: 'CREATE_INDEX',
                collection: 'notification_devices',
                id: 'notification_devices:IDENTITY',
              }
            : kind === 'options'
              ? {
                  type: 'CREATE_INDEX',
                  collection: 'notification_push_attempts',
                  id: 'ATTEMPT_ORDINAL',
                  options: { unique: false },
                }
              : { type: 'DROP_COLLECTION', collection: 'foreign', id: 'x' };
      await expect(f.maintenance.create(action as never)).rejects.toThrow();
      expect(f.calls).toEqual([]);
    },
  );
});
