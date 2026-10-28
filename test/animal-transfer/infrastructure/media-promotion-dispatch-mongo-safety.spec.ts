import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as mongoose from 'mongoose';
import { MediaPromotionCopyDispatcher } from '../../../src/context/animal-media/infrastructure/media-promotion-copy-dispatcher';
import { promotionStoreFixture } from '../fixtures/media-promotion-store.fixture';
import { xmlResponse } from '../fixtures/s3-promotion-transport.fixture';
import { PromotionDispatchMongoFixture } from '../integration/support/media-promotion-dispatch-mongo-fixture';
import {
  assertOwnedDispatchTestDatabase,
  createDispatchTestNamespace,
  DISPATCH_TEST_COLLECTIONS,
  readPromotionDispatchMongoSettings,
} from '../integration/support/media-promotion-dispatch-mongo-safety';
import {
  createPromotionTestNamespace,
  PROMOTION_TEST_COLLECTIONS,
} from '../integration/support/media-promotion-mongo-safety';
import { WRITE_TEST_MARKER } from '../integration/support/local-mongo-test-safety';
import {
  assertDispatchSocketTarget,
  PromotionDispatchTransport,
} from '../integration/support/promotion-dispatch-transport';

const uri = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test';
const env = {
  MEDIA_PROMOTION_DISPATCH_MONGO_TESTS: '1',
  MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI: uri,
};
const settings = { uri, replicaSet: 'animalrecord_test' };

describe('Dispatcher Mongo opt-in and native transport guards without connections', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {},
    { MONGO_URI: uri },
    { ANIMAL_WRITE_MONGO_TESTS: '1', ANIMAL_WRITE_MONGO_TEST_URI: uri },
    { MEDIA_PROMOTION_MONGO_TESTS: '1', MEDIA_PROMOTION_MONGO_TEST_URI: uri },
    { ARCHIVE_EVIDENCE_MONGO_TESTS: '1', ARCHIVE_EVIDENCE_MONGO_TEST_URI: uri },
    {
      ARCHIVE_PROJECTION_MONGO_TESTS: '1',
      ARCHIVE_PROJECTION_MONGO_TEST_URI: uri,
    },
    { ...env, MEDIA_PROMOTION_DISPATCH_MONGO_TESTS: '0' },
    { MEDIA_PROMOTION_DISPATCH_MONGO_TESTS: '1' },
    {
      MEDIA_PROMOTION_DISPATCH_MONGO_TESTS: '1',
      MEDIA_PROMOTION_MONGO_TEST_URI: uri,
      MONGO_URI: uri,
    },
  ])(
    'requires its own opt-in and URI, without environment fallback',
    (input) => {
      expect(() => readPromotionDispatchMongoSettings(input)).toThrow();
    },
  );

  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'accepts explicit local %s through the existing strict parser',
    (host) => {
      const local = `mongodb://${host}:27018/?replicaSet=animalrecord_test&directConnection=true`;
      expect(
        readPromotionDispatchMongoSettings({
          ...env,
          MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI: local,
        }),
      ).toEqual({ uri: local, replicaSet: 'animalrecord_test' });
    },
  );

  it.each([
    'mongodb://remote.invalid:27018/?replicaSet=rs0',
    'mongodb+srv://remote.invalid/?replicaSet=rs0',
    'mongodb://user:secret@127.0.0.1:27018/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/animalrecord?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&replicaSet=other',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=false',
    'mongodb://127.0.0.1:27018/?replicaSet=rs0&tls=true',
    'mongodb://127.0.0.1:27018,localhost:27019/?replicaSet=rs0',
    'mongodb://127.0.0.1/?replicaSet=rs0',
    `${uri}\n`,
  ])(
    'rejects unsafe URI with a fixed message, without leaking credentials',
    (invalid) => {
      expect(() =>
        readPromotionDispatchMongoSettings({
          ...env,
          MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI: invalid,
        }),
      ).toThrow('Integration URI');
      try {
        readPromotionDispatchMongoSettings({
          ...env,
          MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI: invalid,
        });
      } catch (error) {
        expect((error as Error).message).not.toContain('secret');
      }
    },
  );

  it('generates an independent frozen namespace under 64 bytes and accepts owned partial cleanup', () => {
    const first = createDispatchTestNamespace(),
      second = createDispatchTestNamespace();
    expect(first.databaseName).toMatch(
      /^animalrecord_dispatch_test_[a-f0-9]{32}$/,
    );
    expect(first.databaseName).not.toBe(second.databaseName);
    expect(Buffer.byteLength(first.databaseName)).toBeLessThan(64);
    expect(Object.isFrozen(first)).toBe(true);
    for (const collections of [
      [...DISPATCH_TEST_COLLECTIONS],
      [WRITE_TEST_MARKER],
    ])
      expect(() =>
        assertOwnedDispatchTestDatabase(
          first,
          first.databaseName,
          first.runId,
          collections,
        ),
      ).not.toThrow();
  });

  it.each([
    'name',
    'marker',
    'missing-marker',
    'extra',
    'namespace',
    'uuid',
    'other-promotion',
  ])('rejects mismatching %s cleanup', (field) => {
    const n = createDispatchTestNamespace();
    const namespace =
      field === 'other-promotion'
        ? createPromotionTestNamespace()
        : field === 'namespace'
          ? { ...n, databaseName: 'animalrecord' }
          : field === 'uuid'
            ? { ...n, runId: 'invalid' }
            : n;
    expect(() =>
      assertOwnedDispatchTestDatabase(
        namespace,
        field === 'name' ? 'animalrecord' : n.databaseName,
        field === 'marker' ? 'other' : n.runId,
        field === 'missing-marker'
          ? []
          : field === 'extra'
            ? [...DISPATCH_TEST_COLLECTIONS, 'animals']
            : [...DISPATCH_TEST_COLLECTIONS],
      ),
    ).toThrow('cleanup refused');
  });

  it('keeps a separate allowlist without adding collections to existing harnesses', () => {
    expect(DISPATCH_TEST_COLLECTIONS).toEqual(PROMOTION_TEST_COLLECTIONS);
    expect(DISPATCH_TEST_COLLECTIONS).not.toBe(PROMOTION_TEST_COLLECTIONS);
    expect(DISPATCH_TEST_COLLECTIONS).toHaveLength(5);
    const n = createDispatchTestNamespace();
    for (const name of [
      'animals',
      'medical_documents',
      'animal_ownership_periods',
      '_synthetic_joint_writes',
    ])
      expect(() =>
        assertOwnedDispatchTestDatabase(n, n.databaseName, n.runId, [
          WRITE_TEST_MARKER,
          name,
        ]),
      ).toThrow('cleanup refused');
  });

  it.each([
    {
      uri: 'mongodb://remote.invalid:27018/?replicaSet=rs0',
      replicaSet: 'rs0',
    },
    { uri, replicaSet: 'different' },
  ])(
    'rejects direct invalid fixture settings before any connection or transport patch',
    async (invalid) => {
      const create = jest
        .spyOn(mongoose, 'createConnection')
        .mockImplementation(() => {
          throw new Error('Unexpected connection');
        });
      const native = https.request,
        f = new PromotionDispatchMongoFixture();
      try {
        await expect(f.open(invalid)).rejects.toThrow();
        expect(create).not.toHaveBeenCalled();
        expect(https.request).toBe(native);
      } finally {
        await f.close();
      }
    },
  );

  it('discovers five separate suites and excludes them all from ordinary npm test', () => {
    const configs = [
      'media-promotion-dispatch',
      'media-promotion',
      'animal-write',
      'archive-evidence',
      'archive-projection',
    ];
    const suites = [
      'media-promotion-dispatch',
      'media-promotion-persistence',
      'animal-write-protocol',
      'archive-evidence-consumption',
      'archive-projection-read',
    ];
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { jest: { testRegex: string }; scripts: Record<string, string> };
    for (const [i, name] of configs.entries()) {
      const config = JSON.parse(
        readFileSync(
          resolve(__dirname, `../../jest-${name}-mongo.json`),
          'utf8',
        ),
      ) as { testRegex: string; globalSetup: string };
      expect(
        suites.map((s) =>
          new RegExp(config.testRegex).test(`${s}.mongo.integration.ts`),
        ),
      ).toEqual(suites.map((_, j) => i === j));
      if (i === 0)
        expect(config.globalSetup).toContain(
          'require-media-promotion-dispatch-mongo.ts',
        );
    }
    for (const name of suites)
      expect(
        new RegExp(pkg.jest.testRegex).test(`${name}.mongo.integration.ts`),
      ).toBe(false);
    expect(pkg.scripts['test:integration:media-promotion-dispatch']).toContain(
      'jest-media-promotion-dispatch-mongo.json',
    );
    expect(
      pkg.scripts['test:integration:media-promotion-dispatch:check'],
    ).toContain('tsc --project');
  });

  it.each([
    [{ port: 27018, host: '127.0.0.1' }],
    [{ port: '27018', host: 'localhost' }],
    [{ port: 27018, host: '::1' }],
    [[{ port: 27018, host: '127.0.0.1' }, () => undefined]],
    [27018, '127.0.0.1'],
    [27018],
  ])('allows only configured loopback socket forms: %j', (...args) => {
    expect(() => assertDispatchSocketTarget(args, 27018)).not.toThrow();
  });

  it.each([
    [{ port: 443, host: 's3.amazonaws.com' }],
    [{ port: 27018, host: 'remote.invalid' }],
    [{ port: 27017, host: '127.0.0.1' }],
    [{ path: 'socket', port: 27018, host: '127.0.0.1' }],
    ['27018'],
    ['socket'],
    [443, '127.0.0.1'],
    [[{ port: 27018, host: 'remote.invalid' }, () => undefined]],
    [{ port: null }],
    [{ port: '27018junk' }],
    [],
  ])('rejects a non-Mongo socket form: %j', (...args) => {
    expect(() => assertDispatchSocketTarget(args, 27018)).toThrow(
      'Non-Mongo native sockets forbidden',
    );
  });

  it('blocks real HTTP, unexpected HTTPS and native remote socket calls synchronously and restores hooks', () => {
    const original = {
      http: http.request,
      https: https.request,
      connect: Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect'),
    };
    const transport = new PromotionDispatchTransport(settings),
      socket = new net.Socket();
    try {
      expect(() => http.request('http://remote.invalid')).toThrow(
        'Plain HTTP forbidden',
      );
      expect(() =>
        https.request({ hostname: 'remote.invalid', method: 'PUT' }),
      ).toThrow('Unexpected native HTTPS target');
      expect(() => socket.connect(443, 'remote.invalid')).toThrow(
        'Non-Mongo native sockets forbidden',
      );
      expect(() => socket.connect(27017, '127.0.0.1')).toThrow(
        'Non-Mongo native sockets forbidden',
      );
      expect(transport.requests).toHaveLength(0);
    } finally {
      socket.destroy();
      transport.restore();
    }
    expect(http.request).toBe(original.http);
    expect(https.request).toBe(original.https);
    expect(
      Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect'),
    ).toEqual(original.connect);
  });

  it('restores transport guards after partial fixture setup failure', async () => {
    jest.spyOn(mongoose, 'createConnection').mockImplementation(() => {
      throw new Error('Synthetic setup failure');
    });
    const original = https.request,
      f = new PromotionDispatchMongoFixture();
    try {
      await expect(f.open(settings)).rejects.toThrow('Synthetic setup failure');
    } finally {
      await f.close();
    }
    expect(https.request).toBe(original);
  });

  it('forwards an allowed Mongo connect to the original method with the same Socket receiver, without networking', () => {
    const original = Object.getOwnPropertyDescriptor(
      net.Socket.prototype,
      'connect',
    )!;
    const calls: Array<{ socket: net.Socket; args: unknown[] }> = [];
    function delegate(this: net.Socket, ...args: unknown[]) {
      calls.push({ socket: this, args });
      return this;
    }
    Object.defineProperty(net.Socket.prototype, 'connect', {
      ...original,
      value: delegate,
    });
    let transport: PromotionDispatchTransport | undefined;
    const socket = new net.Socket();
    try {
      transport = new PromotionDispatchTransport(settings);
      const options = { port: 27018, host: '127.0.0.1' };
      expect(socket.connect(options)).toBe(socket);
      expect(calls).toHaveLength(1);
      expect(calls[0].socket).toBe(socket);
      expect(calls[0].args).toEqual([options]);
      expect(() => socket.connect(443, 'remote.invalid')).toThrow(
        'Non-Mongo native sockets forbidden',
      );
      expect(calls).toHaveLength(1);
    } finally {
      socket.destroy();
      transport?.restore();
      // Clear Jest's saved delegate descriptor before restoring the native method.
      // A later restoreAllMocks must not reinstall the synthetic connect function.
      jest.restoreAllMocks();
      Object.defineProperty(net.Socket.prototype, 'connect', original);
    }
    jest.restoreAllMocks(); // Also verify a later suite-level restoration is safe.
    expect(
      Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect'),
    ).toEqual(original);
  });

  it.each(['success', 'retry', 'pause'] as const)(
    'exercises the new native transport helper with a real SDK dispatcher (%s), no Mongo or sockets',
    async (mode) => {
      const store = promotionStoreFixture();
      await store.repository.open(store.selection);
      await store.repository.apply(store.selection, 0, store.declare);
      const transport = new PromotionDispatchTransport(settings);
      const dispatcher = await MediaPromotionCopyDispatcher.create(
        store.repository,
        {
          selection: store.selection,
          scope: store.initial.scope,
          effectId: store.effectId,
          dispatcherInstanceId: store.id(30),
          regions: ['us-east-1'],
          credentials: {
            accessKeyId: 'SYNTHETIC',
            secretAccessKey: 'synthetic-secret',
          },
          maxAttempts: 2,
        },
      );
      const random = jest.spyOn(Math, 'random').mockReturnValue(0);
      let observed: Promise<unknown> | undefined;
      try {
        if (mode === 'retry')
          transport.steps.push(() => xmlResponse(503, 'SlowDown'));
        const pause =
          mode === 'pause'
            ? transport.pauseNextResponse(xmlResponse())
            : undefined;
        if (!pause) transport.steps.push(() => xmlResponse());
        const pending = dispatcher.send();
        observed = pending.catch(() => undefined);
        if (pause) {
          await Promise.race([
            pause.entered(),
            pending.then(() => {
              throw new Error('Send finished before the response pause');
            }),
          ]);
          transport.releaseAll();
        }
        await pending;
        expect(transport.requests).toHaveLength(mode === 'retry' ? 2 : 1);
        expect(
          store
            .state()
            .records.filter((r) => r.kind === 'ATTEMPT')
            .every((r) => r.authorizationId),
        ).toBe(true);
        expect(transport.requests.every((r) => !('Authorization' in r))).toBe(
          true,
        );
      } finally {
        transport.releaseAll();
        await observed;
        dispatcher.destroy();
        random.mockRestore();
        transport.restore();
      }
    },
  );
});
