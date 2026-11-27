import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mongo } from 'mongoose';
import {
  MongoNotificationDevices,
  NotificationDeviceSchema,
  NotificationDeviceTokenSchema,
} from '../../../src/context/notification/infrastructure/mongo-notification-devices';
import { DeviceRecord } from '../../../src/context/notification/domain/notification-device';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';
import { otpActor } from '../fixtures/transfer-otp.fixture';

const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const current: DeviceRecord = {
  _id: id(10),
  keyHash: digest('key'),
  userId: otpActor,
  revision: 1,
  state: 'ACTIVE',
  provider: 'FCM',
  platform: 'ANDROID',
  token: 'synthetic-token',
  tokenHash: digest('synthetic-token'),
  updatedAt: '2026-10-29T12:00:00.000Z',
  lastOperationId: id(100),
  lastOperationHash: digest('operation'),
};
function fixture(row: DeviceRecord | null = null) {
  const flags = {
    missing: false,
    standalone: false,
    removed: 1,
    modified: 1,
    duplicate: false,
    uncertain: false,
  };
  const calls: Array<{
    action: string;
    input: unknown;
    options?: unknown;
    session?: unknown;
  }> = [];
  const session = {
    withTransaction: jest.fn(
      (work: () => Promise<DeviceRecord>, options: unknown) => {
        calls.push({ action: 'transaction', input: options });
        return work();
      },
    ),
    endSession: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
  const collections = new Map(
    ['notification_devices', 'notification_device_tokens'].map((name) => [
      name,
      { name, type: 'collection', options: {} },
    ]),
  );
  const indexes = new Map<string, Array<{ key: Record<string, number> }>>();
  const listCollections = jest.fn((filter: object) => ({
    toArray: () => {
      if (Object.keys(filter).length)
        return Promise.reject(
          new Error('Synthetic Atlas rejects namespace filters'),
        );
      return Promise.resolve(flags.missing ? [] : [...collections.values()]);
    },
  }));
  const createCollection = jest.fn((name: string) => {
    collections.set(name, { name, type: 'collection', options: {} });
    return Promise.resolve();
  });
  const createIndex = jest.fn(
    (
      name: string,
      key: Record<string, number>,
      options: mongo.CreateIndexesOptions,
    ) => {
      indexes.set(name, [...(indexes.get(name) ?? []), { key, ...options }]);
      return Promise.resolve();
    },
  );
  const connection = {
    readyState: 1,
    db: {
      admin: () => ({
        command: () =>
          Promise.resolve(
            flags.standalone
              ? {}
              : {
                  setName: 'synthetic-rs',
                  isWritablePrimary: true,
                  logicalSessionTimeoutMinutes: 30,
                },
          ),
      }),
      listCollections,
      createCollection,
      collection: (name: string) => ({
        listIndexes: () => ({
          toArray: () => Promise.resolve(indexes.get(name) ?? []),
        }),
        createIndex: (
          key: Record<string, number>,
          options: mongo.CreateIndexesOptions,
        ) => createIndex(name, key, options),
      }),
    },
    startSession: jest.fn().mockResolvedValue(session),
  };
  function query<T>(
    action: string,
    input: unknown,
    value: () => T,
    options?: unknown,
  ) {
    let active: unknown;
    const q = {
      select: (_value: string) => {
        void _value;
        return q;
      },
      read: () => q,
      readConcern: () => q,
      maxTimeMS: () => q,
      lean: () => q,
      session: (s: unknown) => {
        active = s;
        return q;
      },
      exec: () => {
        calls.push({ action, input, options, session: active });
        return Promise.resolve(value());
      },
    };
    return q;
  }
  const devices = {
    db: connection,
    findById: (key: string) => query('find', key, () => structuredClone(row)),
    create: jest.fn((rows: DeviceRecord[], options: unknown) => {
      calls.push({ action: 'create-device', input: rows, options });
      return Promise.resolve(rows);
    }),
    replaceOne: (filter: unknown, next: DeviceRecord, options: unknown) =>
      query(
        'replace-device',
        { filter, next },
        () => ({ matchedCount: 1, modifiedCount: flags.modified }),
        options,
      ),
  };
  const tokens = {
    db: connection,
    deleteOne: (filter: unknown, options: unknown) =>
      query(
        'delete-claim',
        filter,
        () => ({ deletedCount: flags.removed }),
        options,
      ),
    create: jest.fn((rows: unknown[], options: unknown) => {
      calls.push({ action: 'create-claim', input: rows, options });
      if (flags.duplicate)
        return Promise.reject(
          Object.assign(new Error('private token details'), { code: 11000 }),
        );
      if (flags.uncertain)
        return Promise.reject(new Error('raw credentials/session/token'));
      return Promise.resolve(rows);
    }),
  };
  const store = new MongoNotificationDevices(devices as never, tokens as never);
  return {
    store,
    devices,
    tokens,
    calls,
    flags,
    session,
    connection,
    collections,
    createCollection,
    createIndex,
  };
}
describe('Device Mongo transaction contract with a simulated driver', () => {
  it('prepares the four push collections and three indexes during the ordinary device module lifecycle', async () => {
    const f = fixture();
    f.collections.clear();
    f.collections.set('notifications', {
      name: 'notifications',
      type: 'collection',
      options: {},
    });
    const app = await Test.createTestingModule({
      providers: [{ provide: 'NotificationDeviceStore', useValue: f.store }],
    }).compile();
    try {
      expect(f.createCollection).not.toHaveBeenCalled();
      await app.init();
      expect(f.createCollection.mock.calls).toEqual([
        ['notification_devices', { timeoutMS: 15000 }],
        ['notification_device_tokens', { timeoutMS: 15000 }],
        ['notification_push_deliveries', { timeoutMS: 15000 }],
        ['notification_push_attempts', { timeoutMS: 15000 }],
      ]);
      expect(
        f.createIndex.mock.calls.map(([name, key, options]) => [
          name,
          key,
          options.unique,
        ]),
      ).toEqual([
        ['notification_devices', { userId: 1, state: 1 }, undefined],
        [
          'notification_push_deliveries',
          { state: 1, nextAttemptAt: 1, _id: 1 },
          undefined,
        ],
        ['notification_push_attempts', { deliveryId: 1, ordinal: 1 }, true],
      ]);
      expect(f.connection.startSession).not.toHaveBeenCalled();
      await f.store.onModuleInit();
      expect(f.createCollection).toHaveBeenCalledTimes(4);
      expect(f.createIndex).toHaveBeenCalledTimes(3);
      expect(f.collections.has('notifications')).toBe(true);
    } finally {
      await app.close();
    }
  });
  it('accepts a collection created concurrently after rechecking the namespace', async () => {
    const f = fixture();
    f.createCollection.mockImplementationOnce((name) => {
      f.collections.set(name, { name, type: 'collection', options: {} });
      return Promise.reject(
        new mongo.MongoServerError({ code: 48, errmsg: 'namespace exists' }),
      );
    });
    await f.store.onModuleInit();
    expect(f.createCollection).toHaveBeenCalledTimes(2);
    expect(f.createIndex).toHaveBeenCalledTimes(3);
  });
  it('logs a sanitized index preparation failure and resumes the missing work on the next startup', async () => {
    const f = fixture(current);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    f.createIndex.mockRejectedValueOnce(
      new mongo.MongoServerError({
        code: 13,
        errmsg: 'private connection details',
      }),
    );
    try {
      await expect(f.store.onModuleInit()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith({
        event: 'notification-push-storage-preparation-failed',
        phase: 'INDEXES',
        collection: 'notification_devices',
        mongoCode: 13,
      });
      await expect(f.store.find(current._id)).resolves.toEqual(current);
      await f.store.onModuleInit();
      expect(f.createCollection).toHaveBeenCalledTimes(2);
      expect(f.createIndex).toHaveBeenCalledTimes(4);
    } finally {
      warn.mockRestore();
    }
  });
  it('creates device and unique token claim in the same transaction with snapshot/primary/majority', async () => {
    const f = fixture();
    expect(await f.store.change(current._id, () => ({ ...current }))).toEqual(
      current,
    );
    expect(f.calls.map((c) => c.action)).toEqual([
      'transaction',
      'find',
      'create-device',
      'create-claim',
    ]);
    expect(f.calls[1].session).toBe(f.session);
    for (const c of f.calls.slice(2))
      expect(c.options).toEqual({ session: f.session });
    expect(f.calls[0].input).toMatchObject({
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
    expect(f.calls[3].input).toEqual([
      { _id: current.tokenHash, installationId: current._id, revision: 1 },
    ]);
    expect(f.session.endSession).toHaveBeenCalled();
  });
  it('rotates device with CAS and removes only the old generation claim before assigning the replacement', async () => {
    const f = fixture(current),
      next = {
        ...current,
        revision: 2,
        token: 'rotated',
        tokenHash: digest('rotated'),
      };
    await f.store.change(current._id, () => next);
    expect(f.calls.map((c) => c.action)).toEqual([
      'transaction',
      'find',
      'replace-device',
      'delete-claim',
      'create-claim',
    ]);
    expect(f.calls[2].input).toMatchObject({
      filter: { _id: current._id, revision: 1, keyHash: current.keyHash },
    });
    expect(f.calls[3].input).toEqual({
      _id: current.tokenHash,
      installationId: current._id,
      revision: 1,
    });
    for (const c of f.calls.slice(2))
      expect(c.options).toEqual({ session: f.session });
  });
  it('disables by replacing the row without the raw token and removing the exact prior claim', async () => {
    const f = fixture(current);
    const { token, tokenHash, ...retained } = current;
    void token;
    void tokenHash;
    await f.store.change(current._id, () => ({
      ...retained,
      revision: 2,
      state: 'DISABLED',
    }));
    expect(f.tokens.create).not.toHaveBeenCalled();
    expect((f.calls[2].input as { next: object }).next).not.toHaveProperty(
      'token',
    );
    expect(f.calls.at(-1)!.action).toBe('delete-claim');
  });
  it('replays an exact current receipt without rewriting or adopting a token assignment', async () => {
    const f = fixture(current);
    await f.store.change(current._id, (row) => row!);
    expect(f.calls.map((c) => c.action)).toEqual(['transaction', 'find']);
  });
  it.each(['no-modification', 'missing-claim'] as const)(
    'refuses %s rather than performing automatic repair',
    async (mode) => {
      const f = fixture(current);
      if (mode === 'no-modification') f.flags.modified = 0;
      else f.flags.removed = 0;
      await expect(
        f.store.change(current._id, () => ({ ...current, revision: 2 })),
      ).rejects.toThrow(
        mode === 'no-modification' ? 'revision changed' : 'inconsistent',
      );
      expect(f.tokens.create).not.toHaveBeenCalled();
      expect(f.session.endSession).toHaveBeenCalled();
    },
  );
  it.each(['duplicate', 'uncertain'] as const)(
    'sanitizes %s failure and closes the transaction session',
    async (kind) => {
      const f = fixture();
      f.flags[kind] = true;
      const error: unknown = await f.store
        .change(current._id, () => current)
        .catch((e: unknown) => e);
      expect(JSON.stringify(error)).not.toMatch(
        /private token|raw credentials|session\/token/,
      );
      if (kind === 'duplicate')
        expect(error).toMatchObject({ name: 'DeviceRegistrationCollision' });
      else expect(error).toMatchObject({ status: 503 });
      expect(f.session.endSession).toHaveBeenCalled();
    },
  );
  it.each(['missing', 'standalone', 'binding'] as const)(
    'refuses unprepared %s before starting a transaction',
    async (mode) => {
      const f = fixture();
      if (mode === 'binding') f.tokens.db = { ...f.connection };
      else f.flags[mode] = true;
      await expect(
        f.store.change(current._id, () => current),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.connection.startSession).not.toHaveBeenCalled();
    },
  );
  it('keeps schemas nonautomatic without TTL, uses _id uniqueness and hides token from generic queries', () => {
    for (const schema of [
      NotificationDeviceSchema,
      NotificationDeviceTokenSchema,
    ]) {
      expect(schema.get('autoCreate')).toBe(false);
      expect(schema.get('autoIndex')).toBe(false);
      expect(
        schema
          .indexes()
          .some(([, options]) => options.expireAfterSeconds !== undefined),
      ).toBe(false);
    }
    expect(NotificationDeviceSchema.path('token').options.select).toBe(false);
    expect(NotificationDeviceSchema.indexes()).toContainEqual([
      { userId: 1, state: 1 },
      expect.any(Object),
    ]);
  });
});
