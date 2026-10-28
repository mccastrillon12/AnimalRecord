import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpRequest, HttpResponse } from '@smithy/protocol-http';
import { Readable, Writable } from 'node:stream';
import { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { createHash } from 'node:crypto';
import { AwsAnimalMediaUploadStorage } from '../../../src/context/animal-media/infrastructure/aws-animal-media-upload-storage';
import { AwsS3StorageService } from '../../../src/context/shared/infrastructure/storage/aws-s3-storage.service';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { promotionFixture } from '../fixtures/media-promotion.fixture';
import {
  copyCommand,
  transportFixture,
  TransportStep,
  xmlResponse,
} from '../fixtures/s3-promotion-transport.fixture';
import { bounded, deferred } from '../integration/support/write-race-gate';

describe('S3 promotion SDK transport boundaries (no sockets or provider)', () => {
  const clients: S3Client[] = [];
  let socketGuard: jest.SpyInstance;
  const fixture = (...args: Parameters<typeof transportFixture>) => {
    const f = transportFixture(...args);
    clients.push(f.client);
    return f;
  };
  beforeEach(() => {
    socketGuard = jest
      .spyOn(net.Socket.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('Real socket forbidden in transport tests');
      });
  });
  afterEach(() => {
    try {
      for (const client of clients.splice(0)) client.destroy();
      if (socketGuard) expect(socketGuard).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('serializes an immutable source/destination condition at the handler boundary', async () => {
    const f = fixture([() => xmlResponse()], { maxAttempts: 1 });
    const output = await f.client.send(copyCommand());
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]).toMatchObject({
      method: 'PUT',
      path: '/synthetic/final',
      sourceMatch: '"source-etag"',
      destinationMatch: '*',
      attempt: 'attempt=1; max=1',
    });
    expect(f.sends[0].copySource).toContain('versionId=source-version');
    expect(output.$metadata.attempts).toBe(1);
  });

  it.each(['503', '200-error', 'reset', 'timeout'] as const)(
    'retries %s below client.send through the real middleware',
    async (failure) => {
      const f = fixture([
        () => {
          if (failure === 'reset')
            throw Object.assign(new Error('synthetic reset'), {
              code: 'ECONNRESET',
              name: 'TimeoutError',
            });
          if (failure === 'timeout')
            throw Object.assign(new Error('synthetic timeout'), {
              name: 'TimeoutError',
            });
          return xmlResponse(failure === '503' ? 503 : 200, 'SlowDown');
        },
        () => xmlResponse(),
      ]);
      expect((await f.client.send(copyCommand())).$metadata.attempts).toBe(2);
      expect(f.invocations).toHaveLength(2);
      expect(f.sends.map((s) => s.attempt)).toEqual([
        'attempt=1; max=3',
        'attempt=2; max=3',
      ]);
      expect(
        f.sends.every(
          (s) =>
            s.destinationMatch === '*' && s.sourceMatch === '"source-etag"',
        ),
      ).toBe(true);
    },
  );

  it('rejects an empty HTTP 200 CopyObject body without inferring rollback or retry', async () => {
    const f = fixture([
      () =>
        new HttpResponse({
          statusCode: 200,
          headers: {},
          body: Readable.from([]),
        }),
    ]);
    await expect(f.client.send(copyCommand())).rejects.toMatchObject({
      name: 'InternalError',
      $metadata: { attempts: 1 },
    });
    expect(f.sends).toHaveLength(1);
  });

  it.each([
    [412, 'PreconditionFailed'],
    [403, 'AccessDenied'],
  ] as const)('does not retry terminal HTTP %s', async (status, code) => {
    const f = fixture([() => xmlResponse(status, code)]);
    await expect(f.client.send(copyCommand())).rejects.toMatchObject({
      name: code,
      $metadata: { attempts: 1 },
    });
    expect(f.sends).toHaveLength(1);
  });

  it.each([1, 3])(
    'enforces an effective retry limit of %s within one retry loop',
    async (maxAttempts) => {
      const f = fixture(
        Array.from(
          { length: maxAttempts },
          () => () => xmlResponse(503, 'SlowDown'),
        ),
        { maxAttempts },
      );
      expect(await f.client.config.maxAttempts()).toBe(maxAttempts);
      await expect(f.client.send(copyCommand())).rejects.toMatchObject({
        $metadata: { attempts: maxAttempts },
      });
      expect(f.sends).toHaveLength(maxAttempts);
    },
  );

  it.each([false, true])(
    'observes region redirect follow=%s outside the retry loop',
    async (followRegionRedirects) => {
      const f = fixture(
        [
          () =>
            xmlResponse(301, 'PermanentRedirect', {
              'x-amz-bucket-region': 'us-west-2',
            }),
          () => xmlResponse(),
        ],
        { maxAttempts: 1, followRegionRedirects },
      );
      if (followRegionRedirects) {
        const output = await f.client.send(copyCommand());
        expect(output.$metadata.attempts).toBe(1); // Final retry loop only: two handler calls.
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].hostname).toContain('us-west-2');
        expect(await f.client.config.region()).toBe('us-east-1');
      } else {
        await expect(f.client.send(copyCommand())).rejects.toMatchObject({
          name: 'PermanentRedirect',
        });
        expect(f.sends).toHaveLength(1);
      }
    },
  );

  it('maxAttempts=1 still permits an upstream middleware to invoke the handler twice', async () => {
    const f = fixture([() => xmlResponse(), () => xmlResponse()], {
      maxAttempts: 1,
    });
    f.client.middlewareStack.add(
      (next) => async (args) => {
        await next(args);
        return next(args);
      },
      { step: 'initialize', name: 'syntheticReplay' },
    );
    const output = await f.client.send(copyCommand());
    expect(f.invocations).toHaveLength(2);
    expect(output.$metadata.attempts).toBe(1);
  });

  it('separate application sends each cross the handler even with the same command instance', async () => {
    const f = fixture([() => xmlResponse(), () => xmlResponse()], {
      maxAttempts: 1,
    });
    const command = copyCommand();
    await f.client.send(command);
    await f.client.send(command);
    expect(f.invocations).toHaveLength(2);
  });

  it('demonstrates why a replaying handler invalidates one-call-one-send coverage', async () => {
    const f = fixture([() => xmlResponse(), () => xmlResponse()], {
      maxAttempts: 1,
      duplicateInsideHandler: true,
    });
    await f.client.send(copyCommand());
    expect(f.invocations).toHaveLength(1);
    expect(f.sends).toHaveLength(2); // Synthetic lower sends, not real network traffic.
  });

  it.each(['denied', 'lost-grant-reply'] as const)(
    'a synthetic %s before delegation performs zero sends',
    async (reason) => {
      const syntheticGrants: number[] = [];
      const grant = jest
        .fn<Promise<void>, [number]>()
        .mockImplementation((invocation) => {
          if (reason === 'lost-grant-reply') syntheticGrants.push(invocation);
          return Promise.reject(new Error(reason));
        });
      const f = fixture([], { beforeSend: grant });
      await expect(f.client.send(copyCommand())).rejects.toThrow(reason);
      expect(grant).toHaveBeenCalledTimes(1);
      expect(syntheticGrants).toEqual(reason === 'lost-grant-reply' ? [1] : []);
      expect(f.sends).toHaveLength(0);
    },
  );

  it.each(['retry', 'redirect'] as const)(
    'checks a new synthetic permission on a %s and can deny it',
    async (route) => {
      const grants: number[] = [];
      const f = fixture(
        [
          () =>
            route === 'retry'
              ? xmlResponse(503, 'SlowDown')
              : xmlResponse(301, 'PermanentRedirect', {
                  'x-amz-bucket-region': 'us-west-2',
                }),
        ],
        {
          followRegionRedirects: true,
          beforeSend: (invocation) => {
            grants.push(invocation);
            return invocation === 1
              ? Promise.resolve()
              : Promise.reject(new Error('synthetic gate revoked'));
          },
        },
      );
      await expect(f.client.send(copyCommand())).rejects.toThrow(
        'synthetic gate revoked',
      );
      expect(grants).toEqual([1, 2]);
      expect(f.sends).toHaveLength(1);
    },
  );

  it('cannot retract an already granted permission while the dispatcher is paused', async () => {
    const entered = deferred(),
      resume = deferred();
    let revoked = false;
    const f = fixture([() => xmlResponse()], {
      beforeSend: async () => {
        if (revoked) throw new Error('synthetic gate revoked');
        entered.resolve();
        await resume.promise;
      },
    });
    const pending = f.client.send(copyCommand());
    try {
      await bounded(entered.promise, 'synthetic dispatch permission');
      revoked = true;
      expect(f.sends).toHaveLength(0);
    } finally {
      resume.resolve();
    }
    await pending;
    expect(f.sends).toHaveLength(1);
  });

  function adapter(steps: TransportStep[]) {
    const f = fixture(steps);
    const config = {
      getAwsS3BucketName: () => 'animalrecord-transport-test',
      getAwsS3Region: () => 'us-east-1',
    } as unknown as EnvironmentConfigService;
    const storage = new AwsAnimalMediaUploadStorage(
      config,
      {} as AwsS3StorageService,
    );
    // Test seam only. Real adapter methods/client.send/middleware remain intact.
    const original = (storage as unknown as { client: S3Client }).client;
    original.destroy();
    Object.defineProperty(storage, 'client', { value: f.client });
    const upload = promotionFixture().upload;
    const bytes = Buffer.from('synthetic file');
    upload.size = bytes.length;
    upload.pinned = {
      etag: '"source-etag"',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const head = () =>
      new HttpResponse({
        statusCode: 200,
        headers: {
          etag: '"final-etag"',
          'content-length': String(bytes.length),
          'content-type': upload.mimeType,
          'x-amz-meta-animal-upload-id': upload.id,
          'x-amz-meta-animal-upload-sha256': upload.pinned!.sha256,
        },
      });
    const get = () =>
      new HttpResponse({
        statusCode: 200,
        headers: { 'content-length': String(bytes.length) },
        body: Readable.from([bytes]),
      });
    return { ...f, storage, upload, head, get };
  }

  it('real promotion adapter crosses HEAD, two CopyObject attempts, HEAD and GET', async () => {
    const steps: TransportStep[] = [];
    const f = adapter(steps);
    steps.push(
      () => xmlResponse(404, 'NotFound'),
      () => xmlResponse(503, 'SlowDown'),
      () => xmlResponse(),
      f.head,
      f.get,
    );
    await expect(f.storage.promote(f.upload)).resolves.toMatchObject({
      etag: '"final-etag"',
      size: f.upload.size,
    });
    expect(f.sends.map((s) => s.method)).toEqual([
      'HEAD',
      'PUT',
      'PUT',
      'HEAD',
      'GET',
    ]);
    expect(
      f.sends
        .filter((s) => s.method === 'PUT')
        .every((s) => s.destinationMatch === '*'),
    ).toBe(true);
  });

  it('an existing destination is reconciled through reads without a mutating send', async () => {
    const steps: TransportStep[] = [],
      f = adapter(steps);
    steps.push(f.head, f.head, f.get);
    await f.storage.promote(f.upload);
    expect(f.sends.map((s) => s.method)).toEqual(['HEAD', 'HEAD', 'GET']);
  });

  it('unknown copy outcome preserves the pinned ticket and does not imply rollback', async () => {
    const steps: TransportStep[] = [],
      f = adapter(steps);
    steps.push(
      () => xmlResponse(404, 'NotFound'),
      ...Array.from({ length: 3 }, () => () => xmlResponse(503, 'SlowDown')),
    );
    const before = structuredClone(f.upload);
    await expect(f.storage.promote(f.upload)).rejects.toThrow(
      'retry the same confirmation',
    );
    expect(f.upload).toEqual(before);
    expect(f.sends.map((s) => s.method)).toEqual(['HEAD', 'PUT', 'PUT', 'PUT']);
  });

  it.each(['reset', '200-error'] as const)(
    'runs SDK retries through NodeHttpHandler to a native request fake on %s',
    async (failure) => {
      let nativeCalls = 0;
      const native = jest.spyOn(https, 'request').mockImplementation(((
        _options: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ) => {
        const call = ++nativeCalls;
        const request = new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        });
        request.on('finish', () => {
          if (failure === 'reset' && call === 1) {
            request.emit(
              'error',
              Object.assign(new Error('synthetic reset'), {
                code: 'ECONNRESET',
              }),
            );
          } else {
            const xml =
              call === 1
                ? '<Error><Code>SlowDown</Code><Message>Synthetic</Message></Error>'
                : '<CopyObjectResult><ETag>"final-etag"</ETag></CopyObjectResult>';
            callback(
              Object.assign(Readable.from([Buffer.from(xml)]), {
                statusCode: 200,
                headers: { 'content-type': 'application/xml' },
              }) as unknown as IncomingMessage,
            );
          }
        });
        return request as unknown as ClientRequest;
      }) as typeof https.request);
      const f = fixture([]);
      const handler = new NodeHttpHandler();
      const boundary = jest.spyOn(handler, 'handle'); // Call-through, no stub result.
      f.client.config.requestHandler = handler;
      const output = await f.client.send(copyCommand());
      expect(output.$metadata.attempts).toBe(2);
      expect(boundary).toHaveBeenCalledTimes(2);
      expect(native).toHaveBeenCalledTimes(2);
      expect(f.invocations).toHaveLength(0); // Bypassed only the synthetic handler.
    },
  );

  it.each(['success', 'reset', 'redirect'] as const)(
    'NodeHttpHandler makes one native request on %s, without internal replay',
    async (outcome) => {
      const native = jest.spyOn(https, 'request').mockImplementation(((
        _options: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ) => {
        const request = new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        });
        request.on('finish', () => {
          if (outcome === 'reset')
            request.emit(
              'error',
              Object.assign(new Error('synthetic reset'), {
                code: 'ECONNRESET',
              }),
            );
          else {
            const response = Object.assign(Readable.from([]), {
              statusCode: outcome === 'redirect' ? 301 : 200,
              headers: { location: 'https://synthetic.invalid/elsewhere' },
            });
            callback(response as unknown as IncomingMessage);
          }
        });
        return request as unknown as ClientRequest;
      }) as typeof https.request);
      const handler = new NodeHttpHandler();
      try {
        const pending = handler.handle(
          new HttpRequest({
            protocol: 'https:',
            hostname: 'synthetic.invalid',
            method: 'PUT',
            path: '/copy',
          }),
        );
        if (outcome === 'reset')
          await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
        else
          await expect(pending).resolves.toMatchObject({
            response: { statusCode: outcome === 'redirect' ? 301 : 200 },
          });
        expect(native).toHaveBeenCalledTimes(1);
      } finally {
        handler.destroy();
      }
    },
  );
});
