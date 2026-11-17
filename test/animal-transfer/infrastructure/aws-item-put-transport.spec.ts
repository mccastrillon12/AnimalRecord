import type { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
  laterPeriodLivePutEffect,
  laterPeriodLivePutKey,
  type LaterPeriodLivePutPermission,
  type LaterPeriodLivePutRecord,
} from '../../../src/context/animal-transfer/domain/later-period-live-put';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import type { ItemPutTransportRequest } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-transport';
import {
  AwsItemPutTransport,
  ITEM_PUT_AUDIT_METADATA,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { AwsLaterPeriodLivePutAuditReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-later-period-live-put-audit-reader';
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
      'x-amz-sdk-checksum-algorithm': 'SHA256',
      'x-amz-content-sha256': createHash('sha256').update(bytes).digest('hex'),
      authorization: expect.stringMatching(/^AWS4-HMAC-SHA256 /) as unknown,
    });
    expect(Buffer.concat(f.chunks)).toEqual(bytes);
    expect(f.replies[0].destroyed).toBe(true);
  });

  it('signs explicit retention on the transfer PUT when the deployment provides a date', async () => {
    const f = fakeHttps();
    const retainUntil = new Date(Date.now() + 60_000).toISOString();
    const prepared = await new AwsItemPutTransport({
      ...config,
      complianceRetainUntil: retainUntil,
    }).prepare(request, { correlateAudit: true });
    expect(f.native).not.toHaveBeenCalled();
    await prepared.sendOnce(Readable.from([bytes]));
    const [options] = f.native.mock.calls[0] as unknown as [RequestOptions];
    expect(options.headers).toMatchObject({
      'x-amz-object-lock-mode': 'COMPLIANCE',
      'x-amz-object-lock-retain-until-date': retainUntil,
      'x-amz-sdk-checksum-algorithm': 'SHA256',
    });
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

  it.each([
    [true, 200, 'RETURNED'],
    [true, 'reset', 'THREW'],
    [false, 200, undefined],
  ] as const)(
    'checks audit correlation with a newly recorded permission = %s and response = %s',
    async (recorded, response, localReturn) => {
      const f = fakeHttps(response);
      const fixture = await publishedLaterPeriod('processing');
      const { declaration } = fixture.live.historicalPut.livePut;
      const { attempt, protection } = declaration;
      const seal = buildLaterPeriodLivePutArtifact(declaration, {
        id: 'sealed-photo',
        generation: '1',
      });
      const close = jest.fn();
      let persisted: LaterPeriodLivePutPermission | undefined;
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
          expect(selection.auditMarkerHash).toMatch(/^[a-f0-9]{64}$/);
          persisted = buildLaterPeriodLivePutPermission(
            selection,
            declaration,
            evidence,
            fixture.now().toISOString(),
          );
          return { recorded, permission: persisted };
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
      const pins = {
        fileId: fixture.live.file.id,
        expectedScopeHash: attempt.scopeHash,
        leg: 'HISTORICAL' as const,
        expectedAttemptHash: attempt.definitionHash,
        expectedProtectionHash: protection.protectionHash,
      };
      const result = await dispatcher.dispatch(
        fixture.commitSelection.selector,
        pins,
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
        ...(recorded ? { localReturn } : {}),
      });
      expect(f.native).toHaveBeenCalledTimes(recorded ? 1 : 0);
      expect(close).toHaveBeenCalledTimes(1);
      expect(readVersion).not.toHaveBeenCalled();
      if (!recorded) return;
      expect(f.replies).toHaveLength(response === 'reset' ? 0 : 1);
      const [options] = f.native.mock.calls[0] as unknown as [RequestOptions];
      const headers = options.headers as Record<string, string>;
      const markerHeader = `x-amz-meta-${ITEM_PUT_AUDIT_METADATA}`;
      const marker = headers[markerHeader];
      expect(
        headers.authorization
          .split('SignedHeaders=')[1]
          ?.split(',')[0]
          ?.split(';'),
      ).toContain(markerHeader);
      expect(marker).toMatch(/^[a-f0-9]{64}$/);
      expect(persisted?.selection.auditMarkerHash).toBe(archiveHash(marker));
      expect(JSON.stringify(persisted)).not.toContain(marker);

      const reloaded = JSON.parse(
        JSON.stringify(buildLaterPeriodLivePutRecord(declaration, persisted)),
      ) as LaterPeriodLivePutRecord;
      const effect = laterPeriodLivePutEffect(
        fixture.live.record.scope,
        laterPeriodLivePutKey(pins),
        reloaded,
      );
      const revision = {
        versionId: 'exact-sealed-version',
        etag: '"photo-etag"',
        size: fixture.live.bytes.length,
      };
      const event = {
        event: 'ObjectCreated:Put' as const,
        target: effect.target,
        requestId: 'S3-REQUEST-ID',
        occurredAt: fixture.now().toISOString(),
        revision,
      };
      const readCreatedPuts = jest
        .fn()
        .mockResolvedValue([event, { ...event }]);
      const send = jest.fn((command: HeadObjectCommand) => {
        expect(command.input).toEqual({
          Bucket: effect.target.bucket,
          Key: effect.target.key,
          ExpectedBucketOwner: effect.target.expectedBucketOwner,
          VersionId: revision.versionId,
          IfMatch: revision.etag,
        });
        return Promise.resolve({
          $metadata: { httpStatusCode: 200 },
          VersionId: revision.versionId,
          ETag: revision.etag,
          ContentLength: revision.size,
          Metadata: { [ITEM_PUT_AUDIT_METADATA]: marker },
        });
      });
      const reader = new AwsLaterPeriodLivePutAuditReader({ readCreatedPuts }, {
        send,
      } as unknown as Pick<S3Client, 'send'>);
      await expect(reader.readAppliedVersion(effect)).resolves.toMatchObject({
        operation: 'PUT_OBJECT',
        outcome: 'APPLIED',
        effectHash: archiveHash(effect),
        revision,
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(f.native).toHaveBeenCalledTimes(1);
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
