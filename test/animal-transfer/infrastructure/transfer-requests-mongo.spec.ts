import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mongo } from 'mongoose';
import { MongoTransferRequests } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-requests';
import { MongoTransferOtp } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-otp';
import { TRANSFER_REQUEST_MODELS } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  TransferRequestRecord,
  TransferRequestItem,
} from '../../../src/context/animal-transfer/domain/transfer-request';
import { transferRecordId } from '../../../src/context/animal-transfer/application/transfer-requests';
import { AnimalTransferReasonCode } from '../../../src/context/catalogs/domain/animal-transfer-reason';
import { AnimalSchema } from '../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';
import { UserSchema } from '../../../src/context/user/infrastructure/persistence/mongo/user.schema';
import { AnimalOwnershipControlSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { AnimalTransferReasonSchema } from '../../../src/context/catalogs/infrastructure/persistence/mongo/catalogs.schema';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';

type Role =
  | 'requests'
  | 'items'
  | 'claims'
  | 'notices'
  | 'outbox'
  | 'events'
  | 'users'
  | 'reasons'
  | 'animals'
  | 'controls'
  | 'otp';
type Call = {
  role: Role;
  method: string;
  filter: unknown;
  options?: { session?: unknown; ordered?: boolean };
  querySession?: unknown;
};
const requestModels = TRANSFER_REQUEST_MODELS.map(({ schema }) => ({
  name: schema.get('collection') as string,
  indexKeys: schema.indexes().map(([key]) => key),
}));

function fixture() {
  const data = {
    request: null as TransferRequestRecord | null,
    items: [] as TransferRequestItem[],
    claims: [] as Array<{ _id: string; transferId: string }>,
  };
  const calls: Call[] = [],
    client = {},
    flags = {
      zeroFence: false,
      noOpFence: false,
      missingCollection: false,
      standalone: false,
    };
  const endSession = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const withTransaction = jest.fn(
    (work: () => Promise<unknown>, options: unknown) => {
      void options;
      return work();
    },
  );
  const session = {
    client,
    inTransaction: () => true,
    endSession,
    withTransaction,
  };
  const collections = new Set(requestModels.map(({ name }) => name));
  const indexes = new Map<string, Array<{ key: Record<string, unknown> }>>();
  const metadata = jest.fn(() =>
    Promise.resolve(
      Array.from(collections, (name) => ({
        name,
        type: 'collection',
        options: {},
      })).slice(flags.missingCollection ? 1 : 0),
    ),
  );
  const createCollection = jest.fn((name: string) => {
    collections.add(name);
    return Promise.resolve();
  });
  const createIndex = jest.fn((name: string, key: Record<string, unknown>) => {
    indexes.set(name, [...(indexes.get(name) ?? []), { key }]);
    return Promise.resolve();
  });
  const connection = {
    readyState: 1,
    getClient: () => client,
    startSession: jest.fn().mockResolvedValue(session),
    db: {
      admin: () => ({
        command: () =>
          Promise.resolve(
            flags.standalone
              ? {}
              : {
                  setName: 'simulated-rs',
                  isWritablePrimary: true,
                  logicalSessionTimeoutMinutes: 30,
                },
          ),
      }),
      listCollections: jest
        .fn<
          { toArray: () => ReturnType<typeof metadata> },
          [Record<string, unknown>, object]
        >()
        .mockReturnValue({ toArray: metadata }),
      createCollection,
      collection: (name: string) => ({
        listIndexes: () => ({
          toArray: () => Promise.resolve(indexes.get(name) ?? []),
        }),
        createIndex: (key: Record<string, unknown>) => createIndex(name, key),
      }),
    },
  };
  function model(role: Role) {
    const q = (
      method: string,
      filter: unknown,
      value: unknown,
      options?: Call['options'],
    ) => {
      const call: Call = { role, method, filter, options };
      const query = {
        session: (s: unknown) => {
          call.querySession = s;
          return query;
        },
        select: () => query,
        lean: () => query,
        read: () => query,
        readConcern: () => query,
        maxTimeMS: () => query,
        sort: () => query,
        limit: () => query,
        exec: () => {
          calls.push(call);
          return Promise.resolve(value);
        },
      };
      return query;
    };
    return {
      db: connection,
      findById: (key: string) =>
        q('findById', key, role === 'requests' ? data.request : null),
      find: (filter: unknown) =>
        q(
          'find',
          filter,
          role === 'animals'
            ? [
                {
                  id: id(100),
                  ownerId: otpActor,
                  isActive: undefined,
                  name: 'Animal',
                  code: 'AR-1',
                },
              ]
            : role === 'controls'
              ? [{ animalId: id(100), ownerId: otpActor, ownershipVersion: 2 }]
              : role === 'items'
                ? data.items
                : role === 'claims'
                  ? data.claims
                  : [],
        ),
      findOneAndUpdate: (
        filter: { id?: string; code?: string },
        update: unknown,
        options: Call['options'],
      ) =>
        q(
          'findOneAndUpdate',
          { filter, update },
          role === 'users'
            ? { id: filter.id, name: 'User', transferRequestRevision: 1 }
            : { code: filter.code, name: 'Otro', transferRequestRevision: 1 },
          options,
        ),
      updateOne: (filter: unknown, update: unknown, options: Call['options']) =>
        q(
          'updateOne',
          { filter, update },
          {
            matchedCount: flags.zeroFence ? 0 : 1,
            modifiedCount: flags.noOpFence ? 0 : 1,
          },
          options,
        ),
      updateMany: (
        filter: unknown,
        update: unknown,
        options: Call['options'],
      ) =>
        q(
          'updateMany',
          { filter, update },
          {
            matchedCount: data.items.length,
            modifiedCount: flags.noOpFence ? 0 : data.items.length,
          },
          options,
        ),
      deleteMany: (filter: unknown, options: Call['options']) =>
        q(
          'deleteMany',
          filter,
          { deletedCount: flags.zeroFence ? 0 : data.claims.length },
          options,
        ),
      bulkWrite: (ops: unknown[], options: Call['options']) => {
        calls.push({ role, method: 'bulkWrite', filter: ops, options });
        return Promise.resolve({
          matchedCount: flags.zeroFence ? 0 : ops.length,
          modifiedCount: flags.zeroFence || flags.noOpFence ? 0 : ops.length,
        });
      },
      create: (rows: unknown[], options: Call['options']) => {
        if (rows.length > 1)
          throw new Error('Parallel create inside a transaction is forbidden');
        calls.push({ role, method: 'create', filter: rows, options });
        return Promise.resolve(rows);
      },
      insertMany: (rows: unknown[], options: Call['options']) => {
        calls.push({ role, method: 'insertMany', filter: rows, options });
        return Promise.resolve(rows);
      },
    };
  }
  const models = Object.fromEntries(
    (
      [
        'requests',
        'items',
        'claims',
        'notices',
        'outbox',
        'events',
        'users',
        'reasons',
        'animals',
        'controls',
        'otp',
      ] as const
    ).map((role) => [role, model(role)]),
  ) as Record<Role, ReturnType<typeof model>>;
  const store = new MongoTransferRequests(
    models.requests as never,
    models.items as never,
    models.claims as never,
    models.notices as never,
    models.outbox as never,
    models.events as never,
    models.users as never,
    models.reasons as never,
    models.animals as never,
    models.controls as never,
  );
  const otp = new MongoTransferOtp(models.otp as never);
  return {
    calls,
    data,
    models,
    store,
    otp,
    session,
    connection,
    flags,
    withTransaction,
    endSession,
    metadata,
    collections,
    indexes,
    createCollection,
    createIndex,
  };
}
const record: TransferRequestRecord = {
  _id: id(1),
  senderId: otpActor,
  senderName: 'Ana',
  recipientId: otpOther,
  recipientName: 'Luis',
  reasonCode: AnimalTransferReasonCode.Other,
  reasonName: 'Otro',
  status: 'PENDING',
  version: 1,
  createdAt: '2026-10-29T12:00:00.000Z',
  animalCount: 1,
  bodyHash: 'a'.repeat(64),
  authorizationChallengeId: id(2),
};

describe('Request/OTP Mongo protocol with a simulated driver, no connections', () => {
  it('prepares only the request collections and their schema indexes on startup', async () => {
    const f = fixture();
    f.collections.clear();
    const app = await Test.createTestingModule({
      providers: [{ provide: 'TransferRequestStore', useValue: f.store }],
    }).compile();
    try {
      expect(f.createCollection).not.toHaveBeenCalled();
      await app.init();
      expect(f.createCollection).toHaveBeenCalledTimes(requestModels.length);
    } finally {
      await app.close();
    }
    await f.store.onModuleInit();

    expect(f.createCollection.mock.calls.map(([name]) => name)).toEqual(
      requestModels.map(({ name }) => name),
    );
    expect(f.createIndex.mock.calls).toEqual(
      requestModels.flatMap(({ name, indexKeys }) =>
        indexKeys.map((key) => [name, key]),
      ),
    );
    expect(f.connection.startSession).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
    await expect(
      f.store.transaction(() => Promise.resolve('checked')),
    ).resolves.toBe('checked');
  });

  it('verifies the namespace when another instance creates it first', async () => {
    const f = fixture();
    const [{ name, indexKeys }] = requestModels;
    f.collections.delete(name);
    f.indexes.set(
      name,
      indexKeys.map((key) => ({ key })),
    );
    f.createCollection.mockImplementationOnce((created) => {
      f.collections.add(created);
      return Promise.reject(
        new mongo.MongoServerError({ code: 48, errmsg: 'namespace exists' }),
      );
    });

    await f.store.onModuleInit();

    expect(f.createCollection).toHaveBeenCalledTimes(1);
    expect(f.metadata).toHaveBeenCalledTimes(2);
    expect(
      f.createIndex.mock.calls.map(([collection]) => collection),
    ).not.toContain(name);
    expect(f.createIndex).toHaveBeenCalledTimes(5);
  });

  it('keeps the app bootable if collection preparation fails and guards the transaction', async () => {
    const f = fixture();
    const [{ name }] = requestModels;
    f.collections.delete(name);
    f.createCollection.mockRejectedValueOnce(
      new mongo.MongoServerError({
        code: 13,
        errmsg: 'private server message',
      }),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    try {
      await expect(f.store.onModuleInit()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith({
        event: 'transfer-request-storage-preparation-failed',
        phase: 'CREATE_COLLECTION',
        collection: name,
        mongoCode: 13,
      });
      expect(f.createIndex).not.toHaveBeenCalled();
      await expect(
        f.store.transaction(() => Promise.resolve()),
      ).rejects.toMatchObject({
        status: 503,
        message: 'Transfer request collections must be prepared before use',
      });
      expect(f.connection.startSession).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  function rejectionFixture() {
    const f = fixture();
    f.data.request = { ...record };
    f.data.items = [
      {
        _id: transferRecordId('item', record._id, id(100)),
        transferId: record._id,
        animalId: id(100),
        animalName: 'Animal',
        animalCode: 'AR-1',
        expectedOwnerId: otpActor,
        expectedOwnershipVersion: 2,
        status: 'PENDING',
      },
    ];
    f.data.claims = [{ _id: id(100), transferId: record._id }];
    return f;
  }
  it('fences the request version and changes/releases exactly its stored set before persisting decision notices/outbox/event in one session', async () => {
    const f = rejectionFixture();
    const result = await f.store.transaction((tx) =>
      tx.rejectAll(record, id(50), '2026-10-29T13:00:00.000Z'),
    );
    expect(result).toMatchObject({
      status: 'REJECTED',
      version: 2,
      decisionOperationId: id(50),
      decisionExpectedVersion: 1,
    });
    const writes = f.calls.filter((c) =>
      [
        'updateOne',
        'updateMany',
        'deleteMany',
        'insertMany',
        'create',
      ].includes(c.method),
    );
    expect(writes.map((c) => [c.role, c.method])).toEqual([
      ['requests', 'updateOne'],
      ['items', 'updateMany'],
      ['claims', 'deleteMany'],
      ['notices', 'insertMany'],
      ['outbox', 'insertMany'],
      ['events', 'create'],
    ]);
    expect(writes[0].filter).toMatchObject({
      filter: {
        _id: record._id,
        recipientId: otpOther,
        version: 1,
        status: 'PENDING',
      },
    });
    expect(writes[2].filter).toEqual({
      _id: { $in: [id(100)] },
      transferId: record._id,
    });
    expect(writes.every((c) => c.options?.session === f.session)).toBe(true);
    expect(
      f.calls.every(
        (c) =>
          !['animals', 'controls', 'otp', 'users', 'reasons'].includes(c.role),
      ),
    ).toBe(true);
    expect(writes.find((c) => c.role === 'notices')?.filter).toEqual([
      expect.objectContaining({
        userId: otpActor,
        type: 'TRANSFER_REQUEST_REJECTED',
      }),
      expect.objectContaining({
        userId: otpOther,
        type: 'TRANSFER_REQUEST_REJECTED',
      }),
    ]);
    expect(writes.find((c) => c.role === 'outbox')?.filter).toEqual([
      expect.objectContaining({
        pushProtocol: 'DEVICE_REVISION_V1',
        revision: 0,
      }),
      expect.objectContaining({
        pushProtocol: 'DEVICE_REVISION_V1',
        revision: 0,
      }),
    ]);
    expect(writes.find((c) => c.role === 'events')?.filter).toEqual([
      expect.objectContaining({
        actorId: otpOther,
        type: 'REQUEST_REJECTED',
        version: 2,
        operationId: id(50),
      }),
    ]);
  });
  it.each([
    'count',
    'identity',
    'state',
    'claim',
    'extra-claim',
    'no-op',
    'zero-fence',
  ] as const)(
    'fails closed for an inconsistent rejection %s before freeing claims or emitting notices',
    async (kind) => {
      const f = rejectionFixture();
      if (kind === 'count') f.data.items = [];
      if (kind === 'identity') f.data.items[0]._id = id(999);
      if (kind === 'state') f.data.items[0].status = 'REJECTED';
      if (kind === 'claim') f.data.claims = [];
      if (kind === 'extra-claim')
        f.data.claims.push({ _id: id(999), transferId: record._id });
      if (kind === 'no-op') f.flags.noOpFence = true;
      if (kind === 'zero-fence') f.flags.zeroFence = true;
      await expect(
        f.store.transaction((tx) =>
          tx.rejectAll(record, id(50), '2026-10-29T13:00:00.000Z'),
        ),
      ).rejects.toThrow();
      expect(
        f.calls.some(
          (c) => c.method === 'deleteMany' || c.method === 'insertMany',
        ),
      ).toBe(false);
    },
  );
  it('reads request and its item page with the same snapshot session, without granting a write fence', async () => {
    const f = rejectionFixture();
    await f.store.transaction(async (tx) => {
      await tx.find(record._id);
      await tx.items(record._id, 21);
    });
    expect(f.calls.every((c) => c.querySession === f.session)).toBe(true);
    expect(f.calls.map((c) => c.method)).toEqual(['findById', 'find']);
  });
  it('passes status filtering into the participant-scoped list without changing unfiltered reads', async () => {
    const f = fixture();
    await f.store.list(otpOther, 'INCOMING', 20, undefined, 'PENDING');
    expect(f.calls[0].filter).toEqual({
      recipientId: otpOther,
      status: 'PENDING',
    });
  });
  it('uses one transaction/session for fences, proof consumption and all six record collections, with ordered bulk writes', async () => {
    const f = fixture();
    await f.store.transaction(async (tx) => {
      expect(await tx.find(record._id)).toBeNull();
      await f.otp.consume(
        otpActor,
        id(2),
        'hashed-proof',
        new Date(),
        tx.session,
      );
      await tx.profile(otpActor);
      await tx.profile(otpOther);
      await tx.reason(AnimalTransferReasonCode.Other);
      const animals = await tx.animals([id(100)], otpActor);
      await tx.save(
        record,
        animals.map((a) => ({
          ...a,
          _id: id(3),
          transferId: record._id,
          expectedOwnerId: otpActor,
          status: 'PENDING',
        })),
      );
    });
    expect(
      f.calls.every(
        (c) => c.options?.session === f.session || c.querySession === f.session,
      ),
    ).toBe(true);
    const saved = f.calls.filter(
      (c) => c.method === 'create' || c.method === 'insertMany',
    );
    expect(saved.map((c) => c.role)).toEqual([
      'requests',
      'items',
      'claims',
      'notices',
      'outbox',
      'events',
    ]);
    expect(saved.find((c) => c.role === 'outbox')?.filter).toEqual([
      expect.objectContaining({
        pushProtocol: 'DEVICE_REVISION_V1',
        revision: 0,
        status: 'PENDING',
      }),
      expect.objectContaining({
        pushProtocol: 'DEVICE_REVISION_V1',
        revision: 0,
        status: 'PENDING',
      }),
    ]);
    expect(
      saved
        .filter((c) => c.method === 'insertMany')
        .every((c) => c.options?.ordered === true),
    ).toBe(true);
    expect(
      f.calls.filter((c) => c.method === 'bulkWrite').map((c) => c.role),
    ).toEqual(['animals', 'controls']);
    expect(f.withTransaction.mock.calls[0][1]).toMatchObject({
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
      timeoutMS: 15000,
    });
    expect(f.endSession).toHaveBeenCalledTimes(1);
    const controlWrites = f.calls.filter(
      (c) => c.role === 'controls' && c.method === 'bulkWrite',
    );
    expect(JSON.stringify(controlWrites)).not.toMatch(
      /transferLock|activeWrites|reservationEpoch/,
    );
  });
  it('rejects zero matching source fences instead of treating a snapshot as commit authorization', async () => {
    const f = fixture();
    f.flags.zeroFence = true;
    await expect(
      f.store.transaction((tx) => tx.animals([id(100)], otpActor)),
    ).rejects.toThrow('changed');
    expect(
      f.calls.some((c) => c.method === 'create' || c.method === 'insertMany'),
    ).toBe(false);
    expect(f.endSession).toHaveBeenCalled();
  });
  it('rejects matching but unchanged source writes as fences', async () => {
    const f = fixture();
    f.flags.noOpFence = true;
    await expect(
      f.store.transaction((tx) => tx.animals([id(100)], otpActor)),
    ).rejects.toThrow('changed');
    expect(
      f.calls.some((c) => c.method === 'create' || c.method === 'insertMany'),
    ).toBe(false);
  });
  it.each(['collection', 'topology', 'binding'] as const)(
    'refuses unprepared %s before opening a transaction or consuming evidence',
    async (change) => {
      const f = fixture();
      if (change === 'collection') f.flags.missingCollection = true;
      if (change === 'topology') f.flags.standalone = true;
      if (change === 'binding') f.models.users.db = { ...f.connection };
      await expect(
        f.store.transaction(() => Promise.resolve('never')),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.connection.startSession).not.toHaveBeenCalled();
      expect(f.calls).toEqual([]);
    },
  );
  it('checks the required collections when the metadata endpoint rejects filters', async () => {
    const f = fixture();
    const available = await f.metadata();
    f.metadata.mockResolvedValueOnce([
      { name: 'unrelated_view', type: 'view', options: {} },
      ...available,
    ]);
    f.connection.db.listCollections.mockImplementationOnce((filter) => ({
      toArray: () =>
        Object.keys(filter).length === 0
          ? f.metadata()
          : Promise.reject(
              new mongo.MongoServerError({
                code: 8000,
                errmsg: 'unsupported filter',
              }),
            ),
    }));

    await expect(
      f.store.transaction(() => Promise.resolve('checked')),
    ).resolves.toBe('checked');
    expect(f.connection.db.listCollections).toHaveBeenCalledWith(
      {},
      {
        nameOnly: false,
        readPreference: 'primary',
        maxTimeMS: 5000,
      },
    );
    expect(f.connection.startSession).toHaveBeenCalledTimes(1);
  });
  it.each([
    { type: 'view', options: {} },
    { type: 'collection', options: { capped: true } },
    { type: 'timeseries', options: { timeseries: { timeField: 'createdAt' } } },
  ])(
    'rejects incompatible required collection metadata %j',
    async (invalid) => {
      const f = fixture();
      const [required, ...rest] = await f.metadata();
      f.metadata.mockResolvedValueOnce([{ ...required, ...invalid }, ...rest]);
      const work = jest.fn(() => Promise.resolve());

      await expect(f.store.transaction(work)).rejects.toMatchObject({
        status: 503,
        message: 'Transfer request collections must be prepared before use',
      });
      expect(f.connection.startSession).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
    },
  );
  it('keeps an uncertain transaction error uncertain, sanitizes its cause and closes the session', async () => {
    const f = fixture();
    f.withTransaction.mockRejectedValueOnce(
      new Error('raw credentials and provider query'),
    );
    const error: unknown = await f.store
      .transaction(() => Promise.resolve())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 503,
      message: expect.stringContaining('same Idempotency-Key') as unknown,
    });
    expect(JSON.stringify(error)).not.toMatch(/raw credentials|provider query/);
    expect(f.endSession).toHaveBeenCalled();
  });
  it.each([
    'COLLECTIONS',
    'TRANSACTION_WORK',
    'TRANSACTION_CONFIRMATION',
  ] as const)('logs only safe error metadata during %s', async (phase) => {
    const f = fixture();
    const logger = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const failure = new mongo.MongoServerError({
      code: 13,
      errmsg: 'raw credentials and provider query',
    });
    const confirmation = phase === 'TRANSACTION_CONFIRMATION';
    if (confirmation) failure.addErrorLabel('UnknownTransactionCommitResult');
    if (phase === 'COLLECTIONS') f.metadata.mockRejectedValueOnce(failure);
    if (confirmation)
      f.withTransaction.mockImplementationOnce(async (work) => {
        await work();
        throw failure;
      });

    try {
      await expect(
        f.store.transaction(() =>
          phase === 'TRANSACTION_WORK'
            ? Promise.reject(failure)
            : Promise.resolve(),
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(logger).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledWith({
        event: 'transfer-request-outcome-unconfirmed',
        phase,
        kind: 'MONGO',
        mongoCode: 13,
        unknownCommitResult: confirmation,
        transientTransaction: false,
      });
    } finally {
      logger.mockRestore();
    }
  });
  it('does not install indexes or TTL; source fence fields have no defaults or public domain adoption', () => {
    for (const m of TRANSFER_REQUEST_MODELS) {
      expect(m.schema.get('autoCreate')).toBe(false);
      expect(m.schema.get('autoIndex')).toBe(false);
      expect(
        m.schema
          .indexes()
          .every(([, options]) => options.expireAfterSeconds === undefined),
      ).toBe(true);
    }
    for (const path of [
      AnimalSchema.path('transferRequestRevision'),
      UserSchema.path('transferRequestRevision'),
      AnimalOwnershipControlSchema.path('transferRequestRevision'),
      AnimalTransferReasonSchema.path('transferRequestRevision'),
    ])
      expect(path.options.default).toBeUndefined();
  });
});
