import { createHash } from 'node:crypto';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import * as https from 'node:https';
import { Socket } from 'node:net';
import { Readable, Writable } from 'node:stream';
import { LaterPeriodLivePutDispatcher } from '../../../src/context/animal-transfer/application/later-period-live-put-dispatcher';
import {
  buildLaterPeriodLivePutArtifact,
  buildLaterPeriodLivePutPermission,
  buildLaterPeriodLivePutRecord,
} from '../../../src/context/animal-transfer/domain/later-period-live-put';
import type { ItemPutTransportRequest } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-transport';
import { AwsItemPutTransport } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';

const bytes = Buffer.from('prepared archive bytes');
const config = {
  region: 'us-east-1',
  bucket: 'archive-fixture',
  expectedBucketOwner: '123456789012',
  credentials: {
    accessKeyId: 'fixture-access-key',
    secretAccessKey: 'fixture-secret-key',
    sessionToken: 'fixture-token',
  },
  timeoutMs: 2000,
};
const request: ItemPutTransportRequest = {
  method: 'PUT',
  key: 'users/synthetic/annual résumé (final).pdf',
  bucket: config.bucket,
  expectedBucketOwner: config.expectedBucketOwner,
  ifNoneMatch: '*',
  cacheControl: 'private, no-store',
  contentLength: bytes.length,
  checksumSHA256: createHash('sha256').update(bytes).digest('base64'),
  contentType: 'application/pdf',
  contentLanguage: 'es',
  contentDisposition: 'attachment',
};

function fakeHttps(outcome: 200 | 307 | 503 | 'reset' = 200) {
  const chunks: Buffer[] = [];
  const replies: Readable[] = [];
  const native = jest.spyOn(https, 'request').mockImplementation(((
    options: RequestOptions,
    respond: (response: IncomingMessage) => void,
  ) => {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    });
    if (
      options.headers &&
      'expect' in options.headers &&
      options.headers.expect === '100-continue'
    )
      queueMicrotask(() => sink.emit('continue'));
    sink.once('finish', () => {
      if (outcome === 'reset') {
        sink.emit(
          'error',
          Object.assign(new Error('synthetic disconnect'), {
            code: 'ECONNRESET',
          }),
        );
        return;
      }
      const response = Object.assign(Readable.from([]), {
        statusCode: outcome,
        headers:
          outcome === 307
            ? { location: 'https://synthetic.invalid/other' }
            : {},
      });
      replies.push(response);
      respond(response as unknown as IncomingMessage);
    });
    return sink as unknown as ClientRequest;
  }) as typeof https.request);
  return { native, chunks, replies };
}

describe('Signed one-shot archive PUT, SDK and Node handler with no network', () => {
  let socketGuard: jest.SpyInstance;
  beforeEach(() => {
    socketGuard = jest
      .spyOn(Socket.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('Real socket forbidden in archive PUT tests');
      });
  });
  afterEach(() => {
    try {
      expect(socketGuard).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('prepares a signed request off-network and delegates those exact bytes once', async () => {
    const f = fakeHttps();
    const transport = new AwsItemPutTransport(config);
    const prepared = await transport.prepare(request);
    expect(prepared.serializedRequestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.request).toEqual(request);
    expect(f.native).not.toHaveBeenCalled();

    const sent = prepared.sendOnce(
      Readable.from([bytes.subarray(0, 8), bytes.subarray(8)]),
    );
    await expect(prepared.sendOnce(Readable.from([bytes]))).rejects.toThrow(
      'already been delegated',
    );
    await sent;
    expect(f.native).toHaveBeenCalledTimes(1);
    const [options] = f.native.mock.calls[0] as unknown as [RequestOptions];
    expect(options).toMatchObject({
      method: 'PUT',
      host: 's3.us-east-1.amazonaws.com',
      path: '/archive-fixture/users/synthetic/annual%20r%C3%A9sum%C3%A9%20%28final%29.pdf?x-id=PutObject',
    });
    expect(options.headers).toMatchObject({
      'content-length': String(bytes.length),
      'content-type': request.contentType,
      'content-language': request.contentLanguage,
      'content-disposition': request.contentDisposition,
      'cache-control': request.cacheControl,
      'if-none-match': '*',
      'x-amz-expected-bucket-owner': config.expectedBucketOwner,
      'x-amz-checksum-sha256': request.checksumSHA256,
      'x-amz-content-sha256': createHash('sha256').update(bytes).digest('hex'),
      authorization: expect.stringMatching(/^AWS4-HMAC-SHA256 /) as unknown,
    });
    expect(Buffer.concat(f.chunks)).toEqual(bytes);
    expect(f.replies[0].destroyed).toBe(true);
  });

  it.each([307, 503, 'reset'] as const)(
    'consumes the delegation on %s without following or retrying the request',
    async (outcome) => {
      const f = fakeHttps(outcome);
      const prepared = await new AwsItemPutTransport(config).prepare(request);
      await expect(prepared.sendOnce(Readable.from([bytes]))).rejects.toThrow(
        'did not return success',
      );
      await expect(prepared.sendOnce(Readable.from([bytes]))).rejects.toThrow(
        'already been delegated',
      );
      expect(f.native).toHaveBeenCalledTimes(1);
    },
  );

  it.each([true, false])(
    'keeps the remote effect unknown with a permission newly recorded = %s',
    async (recorded) => {
      const f = fakeHttps();
      const fixture = await publishedLaterPeriod('processing');
      const { declaration } = fixture.live.historicalPut.livePut;
      const { attempt, protection } = declaration;
      const seal = buildLaterPeriodLivePutArtifact(declaration, {
        id: 'sealed-photo',
        generation: '1',
      });
      const close = jest.fn();
      const observe = jest
        .fn()
        .mockResolvedValue(buildLaterPeriodLivePutRecord(declaration));
      const store: ConstructorParameters<
        typeof LaterPeriodLivePutDispatcher
      >[1] = {
        observe,
        permit: async (_item, selection, held) => {
          await Promise.resolve();
          expect(f.native).not.toHaveBeenCalled();
          const evidence = held();
          if (!evidence) throw new Error('Expected an open sealed artifact');
          expect(selection.transportRequestHash).toMatch(/^[a-f0-9]{64}$/);
          return {
            recorded,
            permission: buildLaterPeriodLivePutPermission(
              selection,
              declaration,
              evidence,
              fixture.now().toISOString(),
            ),
          };
        },
      };
      const readVersion = jest.fn();
      const dispatcher = new LaterPeriodLivePutDispatcher(
        attempt.dispatcherInstanceId,
        store,
        { readVersion },
        new AwsItemPutTransport({ ...config, bucket: attempt.request.bucket }),
        fixture.now,
      );
      const result = await dispatcher.dispatch(
        fixture.commitSelection.selector,
        {
          fileId: fixture.live.file.id,
          expectedScopeHash: attempt.scopeHash,
          leg: 'HISTORICAL',
          expectedAttemptHash: attempt.definitionHash,
          expectedProtectionHash: protection.protectionHash,
        },
        seal,
        {
          open: () =>
            Promise.resolve({
              seal,
              body: Readable.from([fixture.live.bytes]),
              close,
            }),
        },
      );
      expect(result).toEqual({
        permissionHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        delegated: recorded,
        remoteEffect: 'UNKNOWN',
        ...(recorded ? { localReturn: 'RETURNED' } : {}),
      });
      expect(f.native).toHaveBeenCalledTimes(recorded ? 1 : 0);
      expect(close).toHaveBeenCalledTimes(1);
      expect(readVersion).not.toHaveBeenCalled();
    },
  );

  it.each([
    bytes.subarray(0, -1),
    Buffer.concat([bytes, Buffer.of(1)]),
    Buffer.alloc(bytes.length, 1),
  ])(
    'aborts an invalid body without delivering the advertised length',
    async (body) => {
      const f = fakeHttps();
      const prepared = await new AwsItemPutTransport(config).prepare(request);
      await expect(prepared.sendOnce(Readable.from([body]))).rejects.toThrow(
        'did not return success',
      );
      expect(Buffer.concat(f.chunks).length).toBeLessThan(bytes.length);
      expect(f.replies).toHaveLength(0);
      expect(f.native).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { bucket: 'another-bucket' },
    { expectedBucketOwner: '222222222222' },
    { key: 'users/../different-key' },
    { checksumSHA256: 'invalid' },
  ])(
    'rejects an invalid or different request during preparation',
    async (patch) => {
      const f = fakeHttps();
      const transport = new AwsItemPutTransport(config);
      await expect(transport.prepare({ ...request, ...patch })).rejects.toThrow(
        'differs from the prepared request',
      );
      expect(f.native).not.toHaveBeenCalled();
    },
  );
});
