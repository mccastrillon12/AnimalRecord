import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as mongoose from 'mongoose';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpResponse } from '@smithy/protocol-http';
import { MediaPromotionVerifier } from '../../../src/context/animal-media/application/media-promotion-verifier';
import { AwsMediaPromotionDestinationReader } from '../../../src/context/animal-media/infrastructure/aws-media-promotion-destination-reader';
import {
  PromotionTestRow,
  promotionStoreFixture,
} from '../fixtures/media-promotion-store.fixture';
import { xmlResponse } from '../fixtures/s3-promotion-transport.fixture';
import {
  assertOwnedSealTestDatabase,
  createSealTestNamespace,
  readPromotionSealMongoSettings,
  SEAL_TEST_COLLECTIONS,
} from '../integration/support/media-promotion-seal-mongo-safety';
import {
  PromotionSealMongoFixture,
  SEAL_BYTES,
  SEAL_SHA256,
  SEAL_REVISION,
} from '../integration/support/media-promotion-seal-mongo-fixture';
import {
  PROMOTION_TEST_COLLECTIONS,
  createPromotionTestNamespace,
} from '../integration/support/media-promotion-mongo-safety';
import { DISPATCH_TEST_COLLECTIONS } from '../integration/support/media-promotion-dispatch-mongo-safety';
import { WRITE_TEST_MARKER } from '../integration/support/local-mongo-test-safety';
import { PromotionSealTransport } from '../integration/support/promotion-seal-transport';

const uri = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test';
const settings = { uri, replicaSet: 'animalrecord_test' };
const env = {
  MEDIA_PROMOTION_SEAL_MONGO_TESTS: '1',
  MEDIA_PROMOTION_SEAL_MONGO_TEST_URI: uri,
};
describe('Verified seal harness isolation and native read transport without Mongo', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    {},
    { MONGO_URI: uri },
    { MEDIA_PROMOTION_MONGO_TESTS: '1', MEDIA_PROMOTION_MONGO_TEST_URI: uri },
    {
      MEDIA_PROMOTION_DISPATCH_MONGO_TESTS: '1',
      MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI: uri,
    },
    { ANIMAL_WRITE_MONGO_TESTS: '1', ANIMAL_WRITE_MONGO_TEST_URI: uri },
    { ...env, MEDIA_PROMOTION_SEAL_MONGO_TESTS: '0' },
    { MEDIA_PROMOTION_SEAL_MONGO_TESTS: '1' },
    {
      MEDIA_PROMOTION_SEAL_MONGO_TESTS: '1',
      MONGO_URI: uri,
      MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI: uri,
    },
  ])(
    'requires its own opt-in and URI with no app/previous harness fallback',
    (input) => {
      expect(() => readPromotionSealMongoSettings(input)).toThrow();
    },
  );
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts strict local host %s',
    (host) => {
      const local = `mongodb://${host}:27018/?replicaSet=animalrecord_test&directConnection=true`;
      expect(
        readPromotionSealMongoSettings({
          ...env,
          MEDIA_PROMOTION_SEAL_MONGO_TEST_URI: local,
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
    'mongodb://127.0.0.1/?replicaSet=rs0',
    `${uri}\n`,
  ])('rejects unsafe URI with a fixed non-secret message', (invalid) => {
    expect(() =>
      readPromotionSealMongoSettings({
        ...env,
        MEDIA_PROMOTION_SEAL_MONGO_TEST_URI: invalid,
      }),
    ).toThrow('Integration URI');
  });
  it('generates its own frozen namespace under the database-name byte limit and permits only owned cleanup', () => {
    const a = createSealTestNamespace(),
      b = createSealTestNamespace();
    expect(a.databaseName).toMatch(/^animalrecord_seal_test_[a-f0-9]{32}$/);
    expect(a.databaseName).not.toBe(b.databaseName);
    expect(Buffer.byteLength(a.databaseName)).toBeLessThan(64);
    expect(Object.isFrozen(a)).toBe(true);
    for (const collections of [[...SEAL_TEST_COLLECTIONS], [WRITE_TEST_MARKER]])
      expect(() =>
        assertOwnedSealTestDatabase(a, a.databaseName, a.runId, collections),
      ).not.toThrow();
  });
  it.each([
    'database',
    'marker',
    'missing-marker',
    'extra',
    'namespace',
    'uuid',
    'previous',
  ])('refuses %s mismatched cleanup', (field) => {
    const n = createSealTestNamespace();
    const namespace =
      field === 'previous'
        ? createPromotionTestNamespace()
        : field === 'namespace'
          ? { ...n, databaseName: 'animalrecord' }
          : field === 'uuid'
            ? { ...n, runId: 'invalid' }
            : n;
    expect(() =>
      assertOwnedSealTestDatabase(
        namespace,
        field === 'database' ? 'animalrecord' : n.databaseName,
        field === 'marker' ? 'other' : n.runId,
        field === 'missing-marker'
          ? []
          : field === 'extra'
            ? [...SEAL_TEST_COLLECTIONS, 'animals']
            : [...SEAL_TEST_COLLECTIONS],
      ),
    ).toThrow('cleanup refused');
  });
  it('keeps collection allowlists separate without expanding previous harnesses', () => {
    expect(SEAL_TEST_COLLECTIONS).toEqual(PROMOTION_TEST_COLLECTIONS);
    expect(SEAL_TEST_COLLECTIONS).not.toBe(PROMOTION_TEST_COLLECTIONS);
    expect(PROMOTION_TEST_COLLECTIONS).toHaveLength(5);
    expect(DISPATCH_TEST_COLLECTIONS).toHaveLength(5);
    const n = createSealTestNamespace();
    for (const name of [
      'animals',
      'medical_documents',
      'animal_ownership_periods',
      '_synthetic_joint_writes',
    ])
      expect(() =>
        assertOwnedSealTestDatabase(n, n.databaseName, n.runId, [
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
    'rejects invalid direct fixture settings before patching transport or creating connections',
    async (invalid) => {
      const create = jest
        .spyOn(mongoose, 'createConnection')
        .mockImplementation(() => {
          throw new Error('Unexpected connection');
        });
      const original = https.request,
        f = new PromotionSealMongoFixture();
      try {
        await expect(f.open(invalid)).rejects.toThrow();
        expect(create).not.toHaveBeenCalled();
        expect(https.request).toBe(original);
      } finally {
        await f.close();
      }
    },
  );
  it('restores transport after partial fixture setup failure', async () => {
    jest.spyOn(mongoose, 'createConnection').mockImplementation(() => {
      throw new Error('Synthetic setup failure');
    });
    const original = https.request,
      f = new PromotionSealMongoFixture();
    try {
      await expect(f.open(settings)).rejects.toThrow('Synthetic setup failure');
    } finally {
      await f.close();
    }
    expect(https.request).toBe(original);
  });
  it('discovers six separate suites, none included by ordinary npm test', () => {
    const configs = [
      'media-promotion-seal',
      'media-promotion-dispatch',
      'media-promotion',
      'animal-write',
      'archive-evidence',
      'archive-projection',
    ];
    const suites = [
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
          'require-media-promotion-seal-mongo.ts',
        );
    }
    for (const name of suites)
      expect(
        new RegExp(pkg.jest.testRegex).test(`${name}.mongo.integration.ts`),
      ).toBe(false);
    expect(pkg.scripts['test:integration:media-promotion-seal']).toContain(
      'jest-media-promotion-seal-mongo.json',
    );
    expect(
      pkg.scripts['test:integration:media-promotion-seal:check'],
    ).toContain('tsc --project');
  });
  it('denies all HTTPS until one ordinary key is bound, rejects rebinding, HTTP and remote sockets, and restores hooks', () => {
    const original = https.request,
      transport = new PromotionSealTransport(settings),
      socket = new net.Socket();
    const key =
      'users/10000000-0000-4000-8000-000000000002/animals/10000000-0000-4000-8000-000000000001/profile_123.jpeg';
    try {
      expect(() =>
        https.request({
          host: 'animalrecord-test-media.s3.us-east-1.amazonaws.com',
          method: 'HEAD',
          path: '/' + key,
        }),
      ).toThrow('Unexpected native HTTPS target');
      expect(() => transport.bindDestination('foreign/key')).toThrow();
      transport.bindDestination(key);
      expect(() => transport.bindDestination(key)).toThrow();
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
    'PUT',
    'DELETE',
    'POST',
    'foreign-host',
    'foreign-key',
    'query',
    'version-on-head',
    'no-condition',
    'duplicate-version',
    'protocol',
    'absolute-path',
  ] as const)(
    'rejects forbidden native request %s before any real send',
    (mode) => {
      const transport = new PromotionSealTransport(settings),
        key =
          'users/10000000-0000-4000-8000-000000000002/animals/10000000-0000-4000-8000-000000000001/profile_123.jpeg';
      transport.bindDestination(key);
      const options: http.RequestOptions = {
        host: 'animalrecord-test-media.s3.us-east-1.amazonaws.com',
        method: 'HEAD',
        path: '/' + key,
        headers: {},
      };
      if (['PUT', 'DELETE', 'POST'].includes(mode)) options.method = mode;
      if (mode === 'foreign-host') options.host = 'remote.invalid';
      if (mode === 'foreign-key') options.path = '/other';
      if (mode === 'query') options.path += '?arbitrary=1';
      if (mode === 'version-on-head') options.path += '?versionId=1';
      if (mode === 'no-condition') options.method = 'GET';
      if (mode === 'duplicate-version') {
        options.method = 'GET';
        options.headers = { 'if-match': '"final"' };
        options.path += '?versionId=1&versionId=2';
      }
      if (mode === 'protocol') options.protocol = 'http:';
      if (mode === 'absolute-path')
        options.path = 'https://remote.invalid/' + key;
      try {
        expect(() => https.request(options)).toThrow();
        expect(transport.requests).toHaveLength(0);
      } finally {
        transport.restore();
      }
    },
  );

  it.each([
    'success',
    'head-retry',
    'get-retry',
    'pause',
    'bad-bytes',
  ] as const)(
    'runs real SDK/Node handler/verifier through the new native read boundary (%s), without Mongo',
    async (mode) => {
      const f = promotionStoreFixture();
      f.change('uploads', (rows) => {
        (rows[0].pinned as PromotionTestRow).sha256 = SEAL_SHA256;
      });
      await f.prepare();
      await f.repository.apply(f.selection, 2, f.authorize);
      const transport = new PromotionSealTransport(settings);
      transport.bindDestination(f.upload.finalKey);
      const client = new S3Client({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'SYNTHETIC',
          secretAccessKey: 'synthetic-secret',
        },
        requestHandler: new NodeHttpHandler(),
        maxAttempts: 3,
        retryMode: 'standard',
        defaultsMode: 'standard',
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      const verifier = new MediaPromotionVerifier(
        f.repository,
        new AwsMediaPromotionDestinationReader(client),
      );
      const head = () =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            etag: SEAL_REVISION.etag,
            'content-length': '32',
            'content-type': f.upload.mimeType,
            'x-amz-version-id': SEAL_REVISION.versionId,
            'x-amz-meta-animal-upload-id': f.upload.id,
            'x-amz-meta-animal-upload-sha256': SEAL_SHA256,
          },
          body: Readable.from([]),
        });
      const get = () =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            etag: SEAL_REVISION.etag,
            'content-length': '32',
            'x-amz-version-id': SEAL_REVISION.versionId,
          },
          body: Readable.from([
            mode === 'bad-bytes' ? Buffer.alloc(32, 'b') : SEAL_BYTES,
          ]),
        });
      jest.spyOn(Math, 'random').mockReturnValue(0);
      let observed: Promise<unknown> | undefined;
      try {
        if (mode === 'head-retry')
          transport.steps.push({
            method: 'HEAD',
            respond: () => xmlResponse(503, 'SlowDown'),
          });
        transport.steps.push({ method: 'HEAD', respond: head });
        if (mode === 'get-retry')
          transport.steps.push({
            method: 'GET',
            respond: () => {
              throw Object.assign(new Error('synthetic reset'), {
                code: 'ECONNRESET',
              });
            },
          });
        const pause =
          mode === 'pause' ? transport.pause('GET', get()) : undefined;
        if (!pause) transport.steps.push({ method: 'GET', respond: get });
        if (mode !== 'bad-bytes')
          transport.steps.push({ method: 'HEAD', respond: head });
        const pending = verifier.verifyAndSeal({
          selection: f.selection,
          scope: f.initial.scope,
          effectId: f.effectId,
          observationId: f.id(40),
        });
        observed = pending.catch(() => undefined);
        if (pause) {
          await Promise.race([
            pause.entered(),
            pending.then(() => {
              throw new Error('Verification completed before pause');
            }),
          ]);
          transport.releaseAll();
        }
        if (mode === 'bad-bytes')
          await expect(pending).rejects.toMatchObject({
            stage: 'VERIFY',
            reason: 'CONFLICT',
          });
        else await pending;
        expect(transport.requests).toHaveLength(
          mode === 'head-retry' || mode === 'get-retry'
            ? 4
            : mode === 'bad-bytes'
              ? 2
              : 3,
        );
        expect(
          transport.requests
            .filter((r) => r.method === 'GET')
            .every(
              (r) =>
                r.ifMatch === SEAL_REVISION.etag &&
                r.versionId === SEAL_REVISION.versionId,
            ),
        ).toBe(true);
        expect(f.state().uploads[0].sealed).toEqual(
          mode === 'bad-bytes' ? undefined : SEAL_REVISION,
        );
        expect(transport.steps).toHaveLength(0);
      } finally {
        transport.releaseAll();
        await observed;
        client.destroy();
        transport.restore();
      }
    },
  );
});
