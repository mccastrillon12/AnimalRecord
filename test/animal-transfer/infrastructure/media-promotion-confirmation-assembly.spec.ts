import { Optional, Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as net from 'node:net';
import { AwsMediaPromotionConfirmation } from '../../../src/context/animal-media/infrastructure/aws-media-promotion-confirmation';
import { AwsMediaPromotionDestinationReader } from '../../../src/context/animal-media/infrastructure/aws-media-promotion-destination-reader';
import {
  MediaPromotionAssemblyError,
  prepareMediaPromotionConfirmation,
  PromotionMongoBinding,
} from '../../../src/context/animal-media/infrastructure/prepare-media-promotion-confirmation';
import {
  MEDIA_PROMOTION_MONGO_BINDING,
  preparePromotionConfirmationProvider,
  PromotionConfirmationSelection,
} from '../../../src/app/animal-media/media-promotion-confirmation.provider';
import {
  ANIMAL_MEDIA_PROMOTION_CONFIRMATION,
  AnimalMediaPromotionConfirmation,
} from '../../../src/context/animal-media/domain/media-promotion-confirmation-runner';
import { PROMOTION_MONGO_REQUIREMENTS } from '../../../src/context/animal-media/domain/media-promotion-mongo-requirements';
import { promotionStoreFixture } from '../fixtures/media-promotion-store.fixture';
import { bounded, deferred } from '../integration/support/write-race-gate';

@Injectable()
class Consumer {
  constructor(
    @Optional()
    @Inject(ANIMAL_MEDIA_PROMOTION_CONFIRMATION)
    readonly promotion?: AnimalMediaPromotionConfirmation,
  ) {}
}

function setup() {
  const store = promotionStoreFixture();
  const catalog = PROMOTION_MONGO_REQUIREMENTS.map((c) => ({
    name: c.name,
    type: 'collection',
    options: {},
    indexes: c.indexes.map((i) => ({
      key: { ...i.key },
      unique: i.unique,
      partialFilterExpression: i.partialFilterExpression,
    })),
  }));
  const hello = jest
    .fn<Promise<Record<string, unknown>>, []>()
    .mockResolvedValue({
      setName: 'synthetic-rs',
      isWritablePrimary: true,
      logicalSessionTimeoutMinutes: 30,
    });
  const listCollections = jest.fn(() => ({
    toArray: () =>
      Promise.resolve(
        catalog.map((c) => ({
          name: c.name,
          type: c.type,
          options: c.options,
        })),
      ),
  }));
  const listIndexes = jest.fn((name: string) => ({
    toArray: () =>
      Promise.resolve(catalog.find((c) => c.name === name)!.indexes),
  }));
  const db = {
    databaseName: 'synthetic',
    admin: () => ({ command: hello }),
    listCollections,
    collection: (name: string) => ({ listIndexes: () => listIndexes(name) }),
  };
  const client = {};
  const connection = Object.assign(store.models.records.db, {
    readyState: 1,
    db,
    getClient: jest.fn().mockReturnValue(client),
  });
  const models = Object.fromEntries(
    Object.entries(store.models).map(([key, model]) => [
      key,
      Object.assign(model, {
        collection: {
          name: (
            {
              records: 'animal_media_promotion_records',
              journals: 'animal_write_journals',
              controls: 'animal_ownership_controls',
              uploads: 'animal_media_uploads',
            } as const
          )[key as keyof typeof store.models],
          conn: connection,
          collection: {
            db,
            dbName: 'synthetic',
            collectionName: (
              {
                records: 'animal_media_promotion_records',
                journals: 'animal_write_journals',
                controls: 'animal_ownership_controls',
                uploads: 'animal_media_uploads',
              } as const
            )[key as keyof typeof store.models],
          },
        },
      }),
    ]),
  ) as unknown as Omit<PromotionMongoBinding, 'connection'>;
  const binding = { connection, ...models } as unknown as PromotionMongoBinding;
  const credentials = {
    accessKeyId: 'SYNTHETIC',
    secretAccessKey: 'synthetic-secret',
  };
  const aws = {
    bucket: 'animalrecord-test-media',
    region: 'us-east-1',
    credentials,
    maxAttempts: 1,
  };
  const selection = {
    mode: 'PROMOTION_ROWS_V1',
    expectedDatabaseName: 'synthetic',
    aws,
  } as const;
  const input = {
    scope: store.initial.scope,
    uploadId: store.upload.id,
    effectId: store.effectId,
    dispatcherInstanceId: store.id(30),
    observationId: store.id(40),
  };
  const prepare = () =>
    prepareMediaPromotionConfirmation(binding, 'synthetic', aws);
  return {
    ...store,
    models,
    binding,
    connection,
    db,
    client,
    catalog,
    hello,
    listCollections,
    listIndexes,
    aws,
    credentials,
    selection,
    input,
    prepare,
  };
}

describe('Explicit confirmation selection/assembly, simulated Mongo and no sockets', () => {
  let sockets: jest.SpyInstance;
  beforeEach(() => {
    sockets = jest
      .spyOn(net.Socket.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('Real sockets forbidden');
      });
  });
  afterEach(() => {
    try {
      expect(sockets).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });

  async function compile(
    f: ReturnType<typeof setup>,
    selection: PromotionConfirmationSelection = f.selection,
  ) {
    return Test.createTestingModule({
      providers: [
        Consumer,
        { provide: MEDIA_PROMOTION_MONGO_BINDING, useValue: f.binding },
        preparePromotionConfirmationProvider(selection),
      ],
    }).compile();
  }

  it('keeps CURRENT independent of all Mongo/configuration providers', async () => {
    const module = await Test.createTestingModule({
      providers: [
        Consumer,
        preparePromotionConfirmationProvider({ mode: 'CURRENT' }),
      ],
    }).compile();
    try {
      await module.init();
      expect(module.get(Consumer).promotion).toBeUndefined();
    } finally {
      await module.close();
    }
  });

  it('assembles a selected Nest port with metadata reads only and no credential resolution', async () => {
    const f = setup();
    const credentials = jest.fn().mockResolvedValue(f.credentials);
    const module = await compile(f, {
      ...f.selection,
      aws: { ...f.aws, credentials },
    });
    try {
      await module.init();
      expect(module.get(Consumer).promotion).toBeDefined();
      expect(f.hello).toHaveBeenCalledTimes(1);
      expect(f.listCollections).toHaveBeenCalledTimes(1);
      expect(f.listIndexes).toHaveBeenCalledTimes(4);
      expect(credentials).not.toHaveBeenCalled();
      expect(f.log).toEqual([]);
      expect(f.state().records).toEqual([]);
      expect(f.state().uploads[0]).not.toHaveProperty('sealed');
    } finally {
      await module.close();
    }
  });

  it.each(['records', 'journals', 'controls', 'uploads'] as const)(
    'rejects %s on another connection even with the same database name',
    async (key) => {
      const f = setup();
      Object.assign(f.models[key], { db: { ...f.connection } });
      await expect(f.prepare()).rejects.toMatchObject({ stage: 'BINDING' });
      expect(f.hello).not.toHaveBeenCalled();
      expect(f.log).toEqual([]);
    },
  );

  it.each(['records', 'journals', 'controls', 'uploads'] as const)(
    'rejects a wrongly bound %s collection before metadata',
    async (key) => {
      const f = setup();
      Object.assign(f.models[key].collection, { name: 'wrong-collection' });
      await expect(f.prepare()).rejects.toMatchObject({ stage: 'BINDING' });
      expect(f.hello).not.toHaveBeenCalled();
    },
  );

  it.each([
    'database',
    'state',
    'client',
    'collection-connection',
    'native-db',
    'native-collection',
    'native-missing',
  ] as const)('rejects invalid initial %s', async (change) => {
    const f = setup();
    if (change === 'database') f.db.databaseName = 'wrong';
    if (change === 'state') f.connection.readyState = 0;
    if (change === 'client') f.connection.getClient.mockReturnValue(undefined);
    if (change === 'collection-connection')
      Object.assign(f.models.uploads.collection, { conn: {} });
    if (change === 'native-db')
      Object.assign(f.models.uploads.collection, {
        collection: {
          db: { ...f.db },
          dbName: 'synthetic',
          collectionName: 'animal_media_uploads',
        },
      });
    if (change === 'native-collection')
      Object.assign(f.models.uploads.collection, {
        collection: { db: f.db, dbName: 'synthetic', collectionName: 'wrong' },
      });
    if (change === 'native-missing')
      Object.assign(f.models.uploads.collection, { collection: undefined });
    await expect(f.prepare()).rejects.toMatchObject({ stage: 'BINDING' });
    expect(f.hello).not.toHaveBeenCalled();
  });

  it.each([
    'missing-collection',
    'missing-index',
    'topology',
    'read-error',
  ] as const)(
    'aborts Nest preparation on %s instead of selecting CURRENT',
    async (change) => {
      const f = setup();
      if (change === 'missing-collection') f.catalog.pop();
      if (change === 'missing-index') f.catalog[0].indexes.pop();
      if (change === 'topology')
        f.hello.mockResolvedValue({ isWritablePrimary: true });
      if (change === 'read-error')
        f.hello.mockRejectedValue(new Error('secret URI credentials'));
      const error: unknown = await compile(f).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MediaPromotionAssemblyError);
      expect(error).toMatchObject({ stage: 'REQUIREMENTS' });
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toMatch(/secret|URI|credentials/);
      expect(f.log).toEqual([]);
    },
  );

  it.each([
    'client',
    'database',
    'state',
    'model',
    'collection',
    'native',
  ] as const)('rejects %s drift while metadata is pending', async (change) => {
    const f = setup(),
      entered = deferred(),
      release = deferred();
    const original = f.hello.getMockImplementation()!;
    f.hello.mockImplementationOnce(async () => {
      entered.resolve();
      await bounded(release.promise, 'metadata release');
      return original();
    });
    const result = f.prepare();
    await bounded(entered.promise, 'metadata entered');
    try {
      if (change === 'client') f.connection.getClient.mockReturnValue({});
      if (change === 'database') f.connection.db = { ...f.db };
      if (change === 'state') f.connection.readyState = 0;
      if (change === 'model')
        Object.assign(f.models.uploads, { db: { ...f.connection } });
      if (change === 'collection')
        Object.assign(f.models.uploads, {
          collection: { ...f.models.uploads.collection },
        });
      if (change === 'native')
        Object.assign(f.models.uploads.collection, {
          collection: {
            db: f.db,
            dbName: 'synthetic',
            collectionName: 'animal_media_uploads',
          },
        });
    } finally {
      release.resolve();
    }
    await expect(result).rejects.toMatchObject({ stage: 'BINDING' });
    expect(f.log).toEqual([]);
  });

  it('captures binding references before preparation awaits', async () => {
    const f = setup();
    const runtime = jest
      .spyOn(AwsMediaPromotionConfirmation.prototype, 'confirm')
      .mockResolvedValue(undefined);
    const provider = preparePromotionConfirmationProvider(f.selection);
    const prepared = provider.useFactory(
      f.binding,
    ) as Promise<AnimalMediaPromotionConfirmation>;
    const originalModel = f.binding.uploads;
    f.binding.uploads = {} as never;
    const port = await prepared;
    // Mutating the caller's container does not change the captured model.
    expect(originalModel).toBe(f.models.uploads);
    await port.confirm(f.input);
    expect(runtime).toHaveBeenCalledWith(f.input);
    expect(f.hello).toHaveBeenCalledTimes(1);
  });

  it('captures valid backend configuration before later caller mutation', async () => {
    const f = setup();
    const provider = preparePromotionConfirmationProvider(f.selection);
    f.aws.bucket = 'changed-bucket';
    f.aws.region = '';
    f.credentials.secretAccessKey = '';
    const port = (await provider.useFactory(
      f.binding,
    )) as AnimalMediaPromotionConfirmation;
    const head = jest
      .spyOn(AwsMediaPromotionDestinationReader.prototype, 'head')
      .mockRejectedValue(new Error('Synthetic read failure'));
    await expect(port.confirm(f.input)).rejects.toMatchObject({
      stage: 'INSPECT',
      reason: 'UNAVAILABLE',
    });
    expect(head).toHaveBeenCalledTimes(1);
    expect(head.mock.calls[0][0].bucket).toBe('animalrecord-test-media');
    expect(
      f.state().records.filter((row) => row.kind === 'EFFECT'),
    ).toMatchObject([{ bucket: 'animalrecord-test-media' }]);
  });

  it('does not treat satisfied metadata as permission to adopt an unmarked journal', async () => {
    const f = setup();
    f.change('journals', (rows) => {
      delete rows[0].mediaPromotionProtocol;
    });
    const port = await f.prepare();
    const head = jest.spyOn(
      AwsMediaPromotionDestinationReader.prototype,
      'head',
    );
    await expect(port.confirm(f.input)).rejects.toMatchObject({
      stage: 'OPEN',
      reason: 'CONFLICT',
    });
    expect(head).not.toHaveBeenCalled();
    expect(f.state().records).toEqual([]);
  });

  it.each(['client', 'database', 'state', 'model', 'native'] as const)(
    'blocks a confirm after %s rebinding without invoking runtime',
    async (change) => {
      const f = setup();
      const port = await f.prepare();
      const runtime = jest
        .spyOn(AwsMediaPromotionConfirmation.prototype, 'confirm')
        .mockResolvedValue(undefined);
      if (change === 'client') f.connection.getClient.mockReturnValue({});
      if (change === 'database') f.connection.db = { ...f.db };
      if (change === 'state') f.connection.readyState = 0;
      if (change === 'model')
        Object.assign(f.models.records, { db: { ...f.connection } });
      if (change === 'native')
        Object.assign(f.models.uploads.collection, {
          collection: {
            db: f.db,
            dbName: 'synthetic',
            collectionName: 'animal_media_uploads',
          },
        });
      await expect(port.confirm(f.input)).rejects.toMatchObject({
        stage: 'INPUT',
        reason: 'UNAVAILABLE',
      });
      expect(runtime).not.toHaveBeenCalled();
      expect(f.log).toEqual([]);
    },
  );

  it('uses the selected runtime per call without replay/fallback and preserves failures', async () => {
    const f = setup(),
      port = await f.prepare();
    const failure = new Error('synthetic runtime failure');
    const runtime = jest
      .spyOn(AwsMediaPromotionConfirmation.prototype, 'confirm')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    await expect(port.confirm(f.input)).rejects.toBe(failure);
    const second = {
      ...f.input,
      scope: { ...f.input.scope, operationId: f.id(90) },
    };
    await port.confirm(second);
    expect(runtime.mock.calls).toEqual([[f.input], [second]]);
    expect(f.hello).toHaveBeenCalledTimes(1);
    expect(f.log).toEqual([]);
  });

  it.each([
    undefined,
    { mode: 'enabled' },
    { mode: 'CURRENT', aws: {} },
    { mode: 'PROMOTION_ROWS_V1' },
  ])('rejects invalid selection %j without implicit mode', (selection) => {
    expect(() =>
      preparePromotionConfirmationProvider(
        selection as PromotionConfirmationSelection,
      ),
    ).toThrow(MediaPromotionAssemblyError);
  });

  it.each([
    { region: '' },
    { bucket: '' },
    { credentials: {} },
    { endpoint: 'https://secret.invalid' },
  ])(
    'rejects invalid AWS config %j before metadata or credentials',
    async (change) => {
      const f = setup();
      await expect(
        compile(f, {
          ...f.selection,
          aws: { ...f.aws, ...change } as typeof f.aws,
        }),
      ).rejects.toMatchObject({ stage: 'CONFIGURATION' });
      expect(f.hello).not.toHaveBeenCalled();
    },
  );
});
