import * as https from 'node:https';
import * as net from 'node:net';
import { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { HttpRequest, HttpResponse } from '@smithy/protocol-http';
import { S3Client } from '@aws-sdk/client-s3';
import {
  MediaPromotionCopyDispatcher,
  PromotionDispatchInput,
} from '../../../src/context/animal-media/infrastructure/media-promotion-copy-dispatcher';
import { promotionStoreFixture } from '../fixtures/media-promotion-store.fixture';
import { xmlResponse } from '../fixtures/s3-promotion-transport.fixture';
import { bounded, deferred } from '../integration/support/write-race-gate';

describe('One-effect promotion dispatcher with simulated persistence and native transport', () => {
  const owned: MediaPromotionCopyDispatcher[] = [];
  let socketGuard: jest.SpyInstance;
  const requests: Array<{ method: string; path: string; source?: string }> = [];
  let steps: Array<() => HttpResponse | Promise<HttpResponse>>;
  beforeEach(() => {
    steps = [];
    requests.length = 0;
    socketGuard = jest
      .spyOn(net.Socket.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('Real sockets forbidden');
      });
    jest.spyOn(Math, 'random').mockReturnValue(0); // Actual standard retry, zero jitter delay.
    jest.spyOn(https, 'request').mockImplementation(((
      opts: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) => {
      const headers = opts.headers as Record<string, string>;
      requests.push({
        method: opts.method!,
        path: opts.path!,
        source: headers['x-amz-copy-source'],
      });
      const request = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
      request.on('finish', () => {
        const step = steps.shift();
        void Promise.resolve()
          .then(() => {
            if (!step) throw new Error('Unexpected native send');
            return step();
          })
          .then(
            (response) => {
              const body: unknown = response.body;
              const stream =
                body instanceof Readable ? body : Readable.from([]);
              callback(
                Object.assign(stream, {
                  statusCode: response.statusCode,
                  headers: response.headers,
                }) as unknown as IncomingMessage,
              );
            },
            (error: unknown) => request.emit('error', error),
          );
      });
      return request as unknown as ClientRequest;
    }) as typeof https.request);
  });
  afterEach(() => {
    try {
      for (const dispatcher of owned.splice(0)) dispatcher.destroy();
      expect(socketGuard).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });

  async function setup(
    kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
    versionId?: string,
  ) {
    const f = promotionStoreFixture(kind);
    if (versionId)
      f.change('uploads', (rows) => {
        (rows[0].pinned as Record<string, unknown>).versionId = versionId;
      });
    const gate = await f.repository.open(f.selection);
    await f.repository.apply(f.selection, gate.gateRevision, f.declare);
    const input: PromotionDispatchInput = {
      selection: { ...f.selection },
      scope: { ...f.initial.scope },
      effectId: f.effectId,
      dispatcherInstanceId: f.id(30),
      regions: ['us-east-1'],
      credentials: {
        accessKeyId: 'SYNTHETIC',
        secretAccessKey: 'synthetic-secret',
      },
      maxAttempts: 3,
    };
    const create = async (override: Partial<PromotionDispatchInput> = {}) => {
      const dispatcher = await MediaPromotionCopyDispatcher.create(
        f.repository,
        { ...input, ...override },
      );
      owned.push(dispatcher);
      return dispatcher;
    };
    const attempts = () =>
      f.state().records.filter((r) => r.kind === 'ATTEMPT');
    const responses = () =>
      f.state().records.filter((r) => r.kind === 'RESPONSE');
    const revoke = async () => {
      const read = await f.repository.read(f.selection);
      return f.repository.revoke(f.selection, read.gate!.gateRevision, f.audit);
    };
    return { ...f, input, create, attempts, responses, revoke };
  }

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'authorizes %s once before the native send and keeps UNKNOWN evidence',
    async (kind) => {
      const f = await setup(kind),
        dispatcher = await f.create();
      steps.push(() => {
        expect(f.attempts()).toHaveLength(1);
        expect(f.attempts()[0].authorizationId).toEqual(expect.any(String));
        return xmlResponse();
      });
      await expect(dispatcher.send()).resolves.toMatchObject({
        CopyObjectResult: { ETag: '"final-etag"' },
      });
      expect(requests).toHaveLength(1);
      expect(f.responses()).toHaveLength(1);
      expect(f.responses()[0].data).toMatchObject({ outcome: 'UNKNOWN' });
      expect(f.state().controls[0].activeWrites).toHaveLength(1);
      await expect(dispatcher.send()).rejects.toMatchObject({
        stage: 'LIFECYCLE',
      });
      await expect(f.create()).rejects.toMatchObject({ stage: 'SETUP' });
    },
  );

  it.each(['503', 'reset', '200-error'] as const)(
    'obtains a fresh grant for SDK retry after %s',
    async (failure) => {
      const f = await setup(),
        dispatcher = await f.create();
      steps.push(
        () => {
          if (failure === 'reset')
            throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
          return xmlResponse(failure === '503' ? 503 : 200, 'SlowDown');
        },
        () => xmlResponse(),
      );
      await dispatcher.send();
      expect(requests).toHaveLength(2);
      const attempts = f.attempts();
      expect(attempts.map((a) => a.ordinal)).toEqual([1, 2]);
      expect(new Set(attempts.map((a) => a.authorizationId)).size).toBe(2);
      expect(attempts[1].data).toMatchObject({
        origin: 'SDK_RETRY',
        previousAttemptId: attempts[0].id,
        dispatcherInstanceId: f.input.dispatcherInstanceId,
      });
      expect(f.responses()).toHaveLength(2);
    },
  );

  it.each([false, true])(
    'validates a regional redirect against the configured allowlist (%s)',
    async (allowed) => {
      const f = await setup();
      const dispatcher = await f.create({
        followRegionRedirects: true,
        regions: allowed ? ['us-east-1', 'us-west-2'] : ['us-east-1'],
      });
      steps.push(
        () =>
          xmlResponse(301, 'PermanentRedirect', {
            'x-amz-bucket-region': 'us-west-2',
          }),
        () => xmlResponse(),
      );
      if (allowed) {
        await dispatcher.send();
        expect(f.attempts()).toHaveLength(2);
        expect(requests).toHaveLength(2);
      } else {
        await expect(dispatcher.send()).rejects.toMatchObject({
          stage: 'REQUEST',
        });
        expect(f.attempts()).toHaveLength(1);
        expect(requests).toHaveLength(1);
      }
    },
  );

  it.each(['INTEND_ATTEMPT', 'AUTHORIZE_ATTEMPT'] as const)(
    'a lost %s acknowledgement never becomes a send or automatic retry',
    async (phase) => {
      const f = await setup(),
        dispatcher = await f.create();
      const apply = f.repository.apply.bind(f.repository);
      jest.spyOn(f.repository, 'apply').mockImplementation(async (...args) => {
        const result = await apply(...args);
        if (args[2].type === phase)
          throw Object.assign(new Error('private persistence timeout'), {
            name: 'TimeoutError',
            $metadata: { httpStatusCode: 503 },
          });
        return result;
      });
      await expect(dispatcher.send()).rejects.toMatchObject({
        name: 'MediaPromotionDispatchError',
        stage: 'PERMISSION',
        $metadata: { attempts: 1 },
      });
      expect(requests).toHaveLength(0);
      expect(f.attempts()).toHaveLength(1);
      expect(!!f.attempts()[0].authorizationId).toBe(
        phase === 'AUTHORIZE_ATTEMPT',
      );
      await expect(f.create()).rejects.toMatchObject({ stage: 'SETUP' });
    },
  );

  it('revocation before authorization denies delegation and leaves only intention', async () => {
    const f = await setup(),
      dispatcher = await f.create();
    const apply = f.repository.apply.bind(f.repository);
    jest.spyOn(f.repository, 'apply').mockImplementation(async (...args) => {
      const result = await apply(...args);
      if (args[2].type === 'INTEND_ATTEMPT') await f.revoke();
      return result;
    });
    await expect(dispatcher.send()).rejects.toMatchObject({
      stage: 'PERMISSION',
    });
    expect(f.attempts()[0]).not.toHaveProperty('authorizationId');
    expect(requests).toHaveLength(0);
  });

  it('an acknowledged grant can still delegate after revocation while its reply was paused', async () => {
    const f = await setup(),
      dispatcher = await f.create();
    const entered = deferred(),
      resume = deferred(),
      apply = f.repository.apply.bind(f.repository);
    jest.spyOn(f.repository, 'apply').mockImplementation(async (...args) => {
      const result = await apply(...args);
      if (args[2].type === 'AUTHORIZE_ATTEMPT') {
        entered.resolve();
        await bounded(resume.promise, 'grant reply');
      }
      return result;
    });
    steps.push(() => xmlResponse());
    const pending = dispatcher.send();
    try {
      await bounded(entered.promise, 'grant committed');
      expect(requests).toHaveLength(0);
      await f.revoke();
    } finally {
      resume.resolve();
    }
    await pending;
    expect(requests).toHaveLength(1);
    expect(f.responses()).toHaveLength(1);
    expect(f.attempts()[0].authorizationId).toEqual(expect.any(String));
  });

  it('revocation after the first failed send prevents its SDK retry', async () => {
    const f = await setup(),
      dispatcher = await f.create();
    steps.push(async () => {
      await f.revoke();
      return xmlResponse(503, 'SlowDown');
    });
    await expect(dispatcher.send()).rejects.toMatchObject({
      stage: 'PERMISSION',
    });
    expect(f.attempts()).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(f.responses()).toHaveLength(1);
  });

  it.each([false, true])(
    'response persistence failure (committed=%s) stops SDK retry without removing a grant',
    async (committed) => {
      const f = await setup(),
        dispatcher = await f.create(),
        apply = f.repository.apply.bind(f.repository);
      jest.spyOn(f.repository, 'apply').mockImplementation(async (...args) => {
        if (args[2].type !== 'RECORD_RESPONSE') return apply(...args);
        if (committed) await apply(...args);
        throw Object.assign(new Error('secret Mongo URI error'), {
          name: 'TimeoutError',
          $metadata: { httpStatusCode: 503 },
        });
      });
      steps.push(() => xmlResponse(503, 'SlowDown'));
      await expect(dispatcher.send()).rejects.toMatchObject({
        stage: 'RESPONSE',
        message: 'Media promotion dispatch stopped at RESPONSE',
        $metadata: { attempts: 1 },
      });
      expect(requests).toHaveLength(1);
      expect(f.attempts()).toHaveLength(1);
      expect(f.responses()).toHaveLength(committed ? 1 : 0);
      expect(f.attempts()[0].authorizationId).toEqual(expect.any(String));
    },
  );

  it('two dispatchers created from the same snapshot cannot adopt each others attempts', async () => {
    const f = await setup(),
      first = await f.create(),
      second = await f.create({ dispatcherInstanceId: f.id(31) });
    steps.push(() => xmlResponse());
    await first.send();
    await expect(second.send()).rejects.toMatchObject({ stage: 'PERMISSION' });
    expect(requests).toHaveLength(1);
    expect(f.attempts()).toHaveLength(1);
  });

  it('a journal locally settled after factory read is fenced before dispatch', async () => {
    const f = await setup(),
      dispatcher = await f.create();
    await f.journal.settleCallback(
      { id: f.selection.operationId, instanceId: f.selection.instanceId },
      'THREW',
      f.upload.createdAt,
    );
    await expect(dispatcher.send()).rejects.toMatchObject({
      stage: 'PERMISSION',
    });
    expect(requests).toHaveLength(0);
    expect(f.attempts()).toHaveLength(0);
  });

  it.each([
    [
      'mime',
      (r: HttpRequest) => {
        r.headers['content-type'] = 'application/pdf';
      },
    ],
    [
      'upload identity',
      (r: HttpRequest) => {
        r.headers['x-amz-meta-animal-upload-id'] = 'other';
      },
    ],
    [
      'source condition',
      (r: HttpRequest) => {
        r.headers['x-amz-copy-source-if-match'] = 'other';
      },
    ],
    [
      'duplicate header',
      (r: HttpRequest) => {
        r.headers['If-None-Match'] = '*';
      },
    ],
    [
      'extra metadata',
      (r: HttpRequest) => {
        r.headers['x-amz-meta-extra'] = 'payload';
      },
    ],
    [
      'method',
      (r: HttpRequest) => {
        r.method = 'DELETE';
      },
    ],
    [
      'destination',
      (r: HttpRequest) => {
        r.path += '/other';
      },
    ],
    [
      'host',
      (r: HttpRequest) => {
        r.hostname = 'foreign.invalid';
      },
    ],
    [
      'protocol',
      (r: HttpRequest) => {
        r.protocol = 'http:';
      },
    ],
    [
      'query',
      (r: HttpRequest) => {
        r.query.versionId = 'other';
      },
    ],
    [
      'source',
      (r: HttpRequest) => {
        r.headers['x-amz-copy-source'] = 'other';
      },
    ],
    [
      'condition',
      (r: HttpRequest) => {
        delete r.headers['if-none-match'];
      },
    ],
    [
      'digest',
      (r: HttpRequest) => {
        r.headers['x-amz-meta-animal-upload-sha256'] = 'b'.repeat(64);
      },
    ],
    [
      'acl',
      (r: HttpRequest) => {
        r.headers['x-amz-acl'] = 'public-read';
      },
    ],
    [
      'body',
      (r: HttpRequest) => {
        r.body = 'payload';
      },
    ],
  ] as const)(
    'rejects a modified %s before intention, permission or native send',
    async (_name, mutate) => {
      const f = await setup(),
        dispatcher = await f.create();
      // Deliberate test-only access: production exposes no custom middleware/client.
      const client = (dispatcher as unknown as { client: S3Client }).client;
      client.middlewareStack.add(
        (next) => async (args) => {
          mutate(args.request as HttpRequest);
          return next(args);
        },
        { step: 'deserialize', priority: 'high', name: 'syntheticRetarget' },
      );
      await expect(dispatcher.send()).rejects.toMatchObject({
        stage: 'REQUEST',
      });
      expect(f.attempts()).toHaveLength(0);
      expect(requests).toHaveLength(0);
    },
  );

  it('factory copies caller inputs before an asynchronous read', async () => {
    const f = await setup(),
      input = {
        ...f.input,
        scope: { ...f.input.scope },
        selection: { ...f.input.selection },
        regions: [...f.input.regions],
      };
    const pending = MediaPromotionCopyDispatcher.create(f.repository, input);
    input.scope.ownerId = f.id(99);
    input.selection.operationId = f.id(98);
    input.regions[0] = 'us-west-2';
    const dispatcher = await pending;
    owned.push(dispatcher);
    steps.push(() => xmlResponse());
    await dispatcher.send();
    expect(requests).toHaveLength(1);
  });

  it('preserves the pinned source version in the request sent after authorization', async () => {
    const f = await setup('PROFILE_CONFIRM', 'source/version 2'),
      dispatcher = await f.create();
    steps.push(() => xmlResponse());
    await dispatcher.send();
    expect(requests[0].source).toContain('?versionId=source%2Fversion%202');
  });

  it('does not send a request retargeted while authorization is awaiting its reply', async () => {
    const f = await setup(),
      dispatcher = await f.create();
    let original: HttpRequest | undefined;
    (dispatcher as unknown as { client: S3Client }).client.middlewareStack.add(
      (next) => (args) => {
        original = args.request as HttpRequest;
        return next(args);
      },
      { step: 'deserialize', priority: 'high', name: 'captureOriginal' },
    );
    const entered = deferred(),
      resume = deferred(),
      apply = f.repository.apply.bind(f.repository);
    jest.spyOn(f.repository, 'apply').mockImplementation(async (...args) => {
      const result = await apply(...args);
      if (args[2].type === 'AUTHORIZE_ATTEMPT') {
        entered.resolve();
        await bounded(resume.promise, 'request copy grant');
      }
      return result;
    });
    steps.push(() => xmlResponse());
    const pending = dispatcher.send();
    try {
      await bounded(entered.promise, 'request copy');
      original!.path = '/retargeted';
      original!.headers['x-amz-copy-source'] = 'retargeted';
    } finally {
      resume.resolve();
    }
    await pending;
    expect(requests[0].path).toContain(f.upload.finalKey);
    expect(requests[0].source).toContain(f.upload.stagingKey);
  });

  it('a late response CAS conflict retains the permission and stops further retries', async () => {
    const f = await setup(),
      dispatcher = await f.create(),
      apply = f.repository.apply.bind(f.repository);
    jest.spyOn(f.repository, 'apply').mockImplementation(async (...args) => {
      if (args[2].type === 'RECORD_RESPONSE') await f.revoke();
      return apply(...args);
    });
    steps.push(() => xmlResponse(503, 'SlowDown'));
    await expect(dispatcher.send()).rejects.toMatchObject({
      stage: 'RESPONSE',
    });
    expect(f.responses()).toHaveLength(0);
    expect(requests).toHaveLength(1);
    expect(f.attempts()[0].authorizationId).toEqual(expect.any(String));
  });

  it('read failures cannot become empty evidence or a permission', async () => {
    const f = await setup(),
      dispatcher = await f.create();
    jest
      .spyOn(f.repository, 'read')
      .mockRejectedValue(new Error('private read failure'));
    await expect(dispatcher.send()).rejects.toMatchObject({
      stage: 'PERMISSION',
    });
    expect(f.attempts()).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('a revoked gate cannot be opened or adopted by the factory', async () => {
    const f = await setup();
    await f.revoke();
    await expect(f.create()).rejects.toMatchObject({ stage: 'SETUP' });
    expect(requests).toHaveLength(0);
  });

  it('handle is unavailable outside its single owned SDK invocation', async () => {
    const f = await setup(),
      dispatcher = await f.create();
    await expect(
      dispatcher.handle(new HttpRequest({ hostname: 'foreign.invalid' })),
    ).rejects.toMatchObject({ stage: 'LIFECYCLE' });
    dispatcher.destroy();
    await expect(dispatcher.send()).rejects.toMatchObject({
      stage: 'LIFECYCLE',
    });
    expect(f.attempts()).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('rejects pre-declaration, scope mismatch and legacy/unmarked operation without opening a gate', async () => {
    const f = await setup();
    await expect(
      f.create({ scope: { ...f.input.scope, ownerId: f.id(99) } }),
    ).rejects.toMatchObject({ stage: 'SETUP' });
    await expect(f.create({ effectId: f.id(99) })).rejects.toMatchObject({
      stage: 'SETUP',
    });
    f.change('journals', (rows) => {
      delete rows[0].mediaPromotionProtocol;
    });
    const dispatcher = await f.create(); // Read is evidence only; authorizer still fences the journal.
    await expect(dispatcher.send()).rejects.toMatchObject({
      stage: 'PERMISSION',
    });
    expect(requests).toHaveLength(0);
    expect(f.attempts()).toHaveLength(0);
  });
});
