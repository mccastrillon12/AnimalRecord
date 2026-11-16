import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as mongoose from 'mongoose';
import { Readable } from 'node:stream';
import { HttpResponse } from '@smithy/protocol-http';
import { AwsMediaPromotionConfirmation } from '../../../src/context/animal-media/infrastructure/aws-media-promotion-confirmation';
import { promotionStoreFixture } from '../fixtures/media-promotion-store.fixture';
import { xmlResponse } from '../fixtures/s3-promotion-transport.fixture';
import {
  assertOwnedConfirmTestDatabase,
  CONFIRM_TEST_COLLECTIONS,
  createConfirmTestNamespace,
  readPromotionConfirmMongoSettings,
} from '../integration/support/media-promotion-confirm-mongo-safety';
import {
  PromotionConfirmMongoFixture,
  CONFIRM_BYTES,
  CONFIRM_REVISION,
  CONFIRM_SHA256,
  captureConfirmTestCall,
} from '../integration/support/media-promotion-confirm-mongo-fixture';
import { PromotionConfirmTransport } from '../integration/support/promotion-confirm-transport';
import {
  createPromotionTestNamespace,
  PROMOTION_TEST_COLLECTIONS,
} from '../integration/support/media-promotion-mongo-safety';
import { SEAL_TEST_COLLECTIONS } from '../integration/support/media-promotion-seal-mongo-safety';
import { DISPATCH_TEST_COLLECTIONS } from '../integration/support/media-promotion-dispatch-mongo-safety';
import { WRITE_TEST_MARKER } from '../integration/support/local-mongo-test-safety';

const uri =
  'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test&directConnection=true';
const settings = { uri, replicaSet: 'animalrecord_test' };
const env = {
  MEDIA_PROMOTION_CONFIRM_MONGO_TESTS: '1',
  MEDIA_PROMOTION_CONFIRM_MONGO_TEST_URI: uri,
};

describe('Full-cycle Mongo harness guards and native transport, without connecting Mongo', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    {},
    { ...env, MEDIA_PROMOTION_CONFIRM_MONGO_TESTS: '0' },
    { MEDIA_PROMOTION_CONFIRM_MONGO_TESTS: '1' },
    {
      MEDIA_PROMOTION_SEAL_MONGO_TESTS: '1',
      MEDIA_PROMOTION_SEAL_MONGO_TEST_URI: uri,
    },
    { MEDIA_PROMOTION_CONFIRM_MONGO_TESTS: '1', MONGO_URI: uri },
  ])('requires its own opt-in and URI: %j', (input) => {
    expect(() => readPromotionConfirmMongoSettings(input)).toThrow();
  });
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts only strict local settings (%s)',
    (host) => {
      const local = uri.replace('127.0.0.1', host);
      expect(
        readPromotionConfirmMongoSettings({
          ...env,
          MEDIA_PROMOTION_CONFIRM_MONGO_TEST_URI: local,
        }),
      ).toEqual({ uri: local, replicaSet: 'animalrecord_test' });
    },
  );
  it.each([
    'mongodb+srv://remote.invalid/?replicaSet=rs0',
    'mongodb://remote.invalid:27018/?replicaSet=rs0',
    'mongodb://user:secret@127.0.0.1:27018/?replicaSet=rs0',
    'mongodb://127.0.0.1:27018/animalrecord?replicaSet=rs0',
    uri + '&tls=true',
    uri + '&replicaSet=other',
    uri.replace('true', 'false'),
    uri + '\n',
  ])('rejects an unsafe URI with the strict parser', (invalid) => {
    expect(() =>
      readPromotionConfirmMongoSettings({
        ...env,
        MEDIA_PROMOTION_CONFIRM_MONGO_TEST_URI: invalid,
      }),
    ).toThrow('Integration URI');
  });
  it('creates a frozen fresh namespace and an independent closed collection allowlist', () => {
    const n = createConfirmTestNamespace();
    expect(n.databaseName).toMatch(/^animalrecord_confirm_test_[a-f0-9]{32}$/);
    expect(Buffer.byteLength(n.databaseName)).toBeLessThan(64);
    expect(Object.isFrozen(n)).toBe(true);
    expect(n.databaseName).not.toBe(createConfirmTestNamespace().databaseName);
    expect(CONFIRM_TEST_COLLECTIONS).toHaveLength(5);
    for (const prior of [
      PROMOTION_TEST_COLLECTIONS,
      SEAL_TEST_COLLECTIONS,
      DISPATCH_TEST_COLLECTIONS,
    ]) {
      expect(CONFIRM_TEST_COLLECTIONS).toEqual(prior);
      expect(CONFIRM_TEST_COLLECTIONS).not.toBe(prior);
    }
    expect(() =>
      assertOwnedConfirmTestDatabase(n, n.databaseName, n.runId, [
        ...CONFIRM_TEST_COLLECTIONS,
      ]),
    ).not.toThrow();
  });
  it.each([
    'database',
    'marker',
    'missing-marker',
    'extra',
    'prior',
    'invalid-uuid',
  ] as const)(
    'refuses %s cleanup outside its exact owned namespace',
    (mode) => {
      const n = createConfirmTestNamespace();
      expect(() =>
        assertOwnedConfirmTestDatabase(
          mode === 'prior'
            ? createPromotionTestNamespace()
            : mode === 'invalid-uuid'
              ? { ...n, runId: 'invalid' }
              : n,
          mode === 'database' ? 'animalrecord' : n.databaseName,
          mode === 'marker' ? 'other' : n.runId,
          mode === 'missing-marker'
            ? []
            : mode === 'extra'
              ? [...CONFIRM_TEST_COLLECTIONS, 'animals']
              : [...CONFIRM_TEST_COLLECTIONS],
        ),
      ).toThrow('cleanup refused');
    },
  );
  it.each([
    'animals',
    'medical_documents',
    'animal_ownership_periods',
    '_synthetic_joint_writes',
  ])(
    'refuses an extra collection %s even with the correct marker',
    (collection) => {
      const n = createConfirmTestNamespace();
      expect(() =>
        assertOwnedConfirmTestDatabase(n, n.databaseName, n.runId, [
          WRITE_TEST_MARKER,
          collection,
        ]),
      ).toThrow('cleanup refused');
    },
  );
  it('rejects direct invalid fixture settings before installing hooks or connecting', async () => {
    const create = jest
      .spyOn(mongoose, 'createConnection')
      .mockImplementation(() => {
        throw new Error('Connection forbidden');
      });
    const original = https.request,
      f = new PromotionConfirmMongoFixture();
    try {
      await expect(f.open({ uri, replicaSet: 'wrong' })).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
      expect(https.request).toBe(original);
    } finally {
      await f.close();
    }
  });
  it('restores hooks after a partial setup failure without connecting', async () => {
    jest.spyOn(mongoose, 'createConnection').mockImplementation(() => {
      throw new Error('Synthetic setup failure');
    });
    const original = https.request,
      f = new PromotionConfirmMongoFixture();
    try {
      await expect(f.open(settings)).rejects.toThrow('Synthetic setup failure');
    } finally {
      await f.close();
    }
    expect(https.request).toBe(original);
  });
  it('discovers seven distinct Mongo suites and excludes them from ordinary npm test', () => {
    const configs = [
      'media-promotion-confirm',
      'media-promotion-seal',
      'media-promotion-dispatch',
      'media-promotion',
      'animal-write',
      'archive-evidence',
      'archive-projection',
    ];
    const suites = [
      'media-promotion-confirm',
      'media-promotion-seal',
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
          'require-media-promotion-confirm-mongo.ts',
        );
    }
    for (const suite of suites)
      expect(
        new RegExp(pkg.jest.testRegex).test(`${suite}.mongo.integration.ts`),
      ).toBe(false);
    expect(pkg.scripts['test:integration:media-promotion-confirm']).toContain(
      'jest-media-promotion-confirm-mongo.json',
    );
    expect(
      pkg.scripts['test:integration:media-promotion-confirm:check'],
    ).toContain('tsc --project');
  });

  function backendCall() {
    const f = promotionStoreFixture();
    const expected = {
      scope: f.initial.scope,
      uploadId: f.upload.id,
      effectId: f.effectId,
      dispatcherInstanceId: f.id(30),
      observationId: f.id(40),
    };
    const call = {
      ...expected,
      scope: { ...expected.scope },
      effectId: f.id(50),
      dispatcherInstanceId: f.id(51),
      observationId: f.id(52),
    };
    return { ...f, expected, call };
  }
  it('captures backend-generated call IDs without granting permission or retaining mutable scope', () => {
    const f = backendCall(),
      before = f.state();
    const captured = captureConfirmTestCall(f.call, f.expected);
    f.call.effectId = f.id(90);
    f.call.scope.operationId = f.id(91);
    expect(captured.effectId).toBe(f.id(50));
    expect(captured.scope.operationId).toBe(f.expected.scope.operationId);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.scope)).toBe(true);
    expect(f.state()).toEqual(before);
    expect(f.log).toEqual([]);
  });
  it.each([
    'operationId',
    'instanceId',
    'animalId',
    'ownerId',
    'ownershipVersion',
    'kind',
  ] as const)(
    'rejects observed backend call with different %s before permission checks',
    (field) => {
      const f = backendCall();
      Object.assign(f.call.scope, {
        [field]:
          field === 'ownershipVersion'
            ? 99
            : field === 'kind'
              ? 'ATTACHMENT_CONFIRM'
              : f.id(90),
      });
      expect(() => captureConfirmTestCall(f.call, f.expected)).toThrow();
      expect(f.log).toEqual([]);
    },
  );
  it.each([
    'upload',
    'invalid-effect',
    'aliased-identity',
    'extra-payload',
  ] as const)(
    'refuses observed %s instead of weakening fixture correlation',
    (change) => {
      const f = backendCall();
      if (change === 'upload') f.call.uploadId = f.id(90);
      if (change === 'invalid-effect') f.call.effectId = 'invalid';
      if (change === 'aliased-identity')
        f.call.effectId = f.call.dispatcherInstanceId;
      if (change === 'extra-payload')
        Object.assign(f.call, { payload: 'private' });
      expect(() => captureConfirmTestCall(f.call, f.expected)).toThrow();
      expect(f.log).toEqual([]);
    },
  );

  function binding() {
    const f = promotionStoreFixture();
    f.upload.pinned!.sha256 = CONFIRM_SHA256;
    f.upload.pinned!.versionId = 'source/version 1';
    const transport = new PromotionConfirmTransport(settings);
    transport.bind(f.initial.scope, f.upload, CONFIRM_REVISION);
    return { ...f, transport };
  }
  it('denies unbound HTTPS, HTTP and remote/wrong-port sockets, and restores the native hooks', () => {
    const original = https.request,
      transport = new PromotionConfirmTransport(settings),
      socket = new net.Socket();
    try {
      expect(() =>
        https.request({
          host: 'animalrecord-test-media.s3.us-east-1.amazonaws.com',
          path: '/other',
          method: 'HEAD',
        }),
      ).toThrow();
      expect(() => http.request('http://remote.invalid')).toThrow(
        'Plain HTTP forbidden',
      );
      expect(() => socket.connect(443, 'remote.invalid')).toThrow(
        'Non-Mongo native sockets forbidden',
      );
      expect(() => socket.connect(27017, '127.0.0.1')).toThrow(
        'Non-Mongo native sockets forbidden',
      );
    } finally {
      socket.destroy();
      transport.restore();
    }
    expect(https.request).toBe(original);
  });
  it.each([
    'DELETE',
    'POST',
    'host',
    'key',
    'query',
    'version-on-head',
    'duplicate-version',
    'GET-no-condition',
    'PUT-source',
    'PUT-condition',
    'PUT-metadata',
    'protocol',
    'port',
    'absolute-path',
  ] as const)(
    'blocks forbidden request %s before any native delegation',
    (mode) => {
      const f = binding();
      const options: http.RequestOptions = {
        host: 'animalrecord-test-media.s3.us-east-1.amazonaws.com',
        path: '/' + f.upload.finalKey,
        method: 'HEAD',
        headers: {},
      };
      if (mode === 'DELETE' || mode === 'POST') options.method = mode;
      if (mode === 'host') options.host = 'remote.invalid';
      if (mode === 'key') options.path = '/foreign';
      if (mode === 'query') options.path += '?arbitrary=1';
      if (mode === 'version-on-head') options.path += '?versionId=one';
      if (mode === 'duplicate-version') {
        options.method = 'GET';
        options.path += '?versionId=one&versionId=two';
      }
      if (mode === 'GET-no-condition') options.method = 'GET';
      if (mode.startsWith('PUT-')) {
        options.method = 'PUT';
        const headers = {
          'x-amz-copy-source':
            ['animalrecord-test-media', ...f.upload.stagingKey.split('/')]
              .map(encodeURIComponent)
              .join('/') + '?versionId=source%2Fversion%201',
          'x-amz-copy-source-if-match': f.upload.pinned!.etag,
          'if-none-match': '*',
          'x-amz-metadata-directive': 'REPLACE',
          'content-type': f.upload.mimeType,
          'x-amz-meta-animal-upload-id': f.upload.id,
          'x-amz-meta-animal-upload-sha256': CONFIRM_SHA256,
        };
        if (mode === 'PUT-source') headers['x-amz-copy-source'] = 'other';
        if (mode === 'PUT-condition') headers['if-none-match'] = '';
        if (mode === 'PUT-metadata')
          headers['x-amz-meta-animal-upload-id'] = 'other';
        options.headers = headers;
      }
      if (mode === 'protocol') options.protocol = 'http:';
      if (mode === 'port') options.port = 444;
      if (mode === 'absolute-path')
        options.path = 'https://remote.invalid/other';
      try {
        expect(() => https.request(options)).toThrow();
        expect(f.transport.requests).toHaveLength(0);
      } finally {
        f.transport.restore();
      }
    },
  );
  it('captures one binding and rejects a second binding', () => {
    const f = binding();
    try {
      expect(() =>
        f.transport.bind(f.initial.scope, f.upload, CONFIRM_REVISION),
      ).toThrow('already bound');
    } finally {
      f.transport.restore();
    }
  });

  it.each([
    'success',
    'existing',
    'copy-retry',
    'get-retry',
    'bad-bytes',
    'pause',
  ] as const)(
    'exercises the real runtime/new native boundary on a simulated store (%s)',
    async (mode) => {
      const f = binding();
      f.change('uploads', (rows) => {
        rows[0].pinned = { ...f.upload.pinned };
      }); // Simulated store only, no existing Mongo pin rewritten.
      const head = () =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            etag: CONFIRM_REVISION.etag,
            'content-length': '32',
            'x-amz-version-id': CONFIRM_REVISION.versionId,
            'content-type': f.upload.mimeType,
            'x-amz-meta-animal-upload-id': f.upload.id,
            'x-amz-meta-animal-upload-sha256': CONFIRM_SHA256,
          },
          body: Readable.from([]),
        });
      const get = () =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            etag: CONFIRM_REVISION.etag,
            'content-length': '32',
            'x-amz-version-id': CONFIRM_REVISION.versionId,
          },
          body: Readable.from([
            mode === 'bad-bytes' ? Buffer.alloc(32, 'b') : CONFIRM_BYTES,
          ]),
        });
      const seen = new Set<string>();
      f.transport.beforePut = () => {
        const grants = f
          .state()
          .records.filter((r) => r.kind === 'ATTEMPT' && r.authorizationId);
        expect(grants).toHaveLength(seen.size + 1);
        const last = grants.at(-1)!.authorizationId as string;
        expect(seen.has(last)).toBe(false);
        seen.add(last);
        return Promise.resolve();
      };
      f.transport.steps.push({
        method: 'HEAD',
        respond:
          mode === 'existing'
            ? head
            : () =>
                new HttpResponse({ statusCode: 404, body: Readable.from([]) }),
      });
      if (mode === 'copy-retry')
        f.transport.steps.push({
          method: 'PUT',
          respond: () => xmlResponse(503, 'SlowDown'),
        });
      if (mode !== 'existing')
        f.transport.steps.push({ method: 'PUT', respond: () => xmlResponse() });
      f.transport.steps.push({ method: 'HEAD', respond: head });
      if (mode === 'get-retry')
        f.transport.steps.push({
          method: 'GET',
          respond: () => {
            throw Object.assign(new Error('synthetic reset'), {
              code: 'ECONNRESET',
            });
          },
        });
      const pause =
        mode === 'pause' ? f.transport.pause('GET', get()) : undefined;
      if (!pause) f.transport.steps.push({ method: 'GET', respond: get });
      if (mode !== 'bad-bytes')
        f.transport.steps.push({ method: 'HEAD', respond: head });
      jest.spyOn(Math, 'random').mockReturnValue(0);
      let observed: Promise<unknown> | undefined;
      try {
        const runtime = new AwsMediaPromotionConfirmation(f.repository, {
          bucket: 'animalrecord-test-media',
          region: 'us-east-1',
          credentials: {
            accessKeyId: 'SYNTHETIC',
            secretAccessKey: 'synthetic-secret',
          },
          maxAttempts: 2,
        });
        observed = runtime
          .confirm({
            scope: f.initial.scope,
            uploadId: f.upload.id,
            effectId: f.effectId,
            dispatcherInstanceId: f.id(30),
            observationId: f.id(40),
          })
          .then(
            () => ({ ok: true }),
            (error: unknown) => ({ error }),
          );
        if (pause) {
          await pause.entered();
          pause.release();
        }
        if (mode === 'bad-bytes')
          expect(await observed).toMatchObject({
            error: { stage: 'VERIFY', reason: 'CONFLICT' },
          });
        else {
          expect(await observed).toEqual({ ok: true });
          expect(f.state().uploads[0].sealed).toEqual(CONFIRM_REVISION);
        }
        expect(seen.size).toBe(
          mode === 'existing' ? 0 : mode === 'copy-retry' ? 2 : 1,
        );
        expect(f.transport.steps).toHaveLength(0);
      } finally {
        f.transport.releaseAll();
        await observed;
        await f.transport.drain();
        f.transport.restore();
      }
    },
  );
});
