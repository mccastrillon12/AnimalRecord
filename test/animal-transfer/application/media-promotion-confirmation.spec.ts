import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { HttpResponse } from '@smithy/protocol-http';
import {
  MediaPromotionConfirmation,
  MediaPromotionConfirmationError,
} from '../../../src/context/animal-media/application/media-promotion-confirmation';
import { MediaPromotionDispatcherFactory } from '../../../src/context/animal-media/domain/media-promotion-dispatch';
import { MediaPromotionCopyDispatcher } from '../../../src/context/animal-media/infrastructure/media-promotion-copy-dispatcher';
import { AwsMediaPromotionDestinationReader } from '../../../src/context/animal-media/infrastructure/aws-media-promotion-destination-reader';
import {
  AwsMediaPromotionConfirmation,
  AwsPromotionConfirmationConfig,
} from '../../../src/context/animal-media/infrastructure/aws-media-promotion-confirmation';
import { promotionStoreFixture } from '../fixtures/media-promotion-store.fixture';
import { xmlResponse } from '../fixtures/s3-promotion-transport.fixture';
import { bounded } from '../integration/support/write-race-gate';
import { InvalidArgumentError } from '../../../src/context/shared/domain/errors/InvalidArgumentError';

const bytes = Buffer.alloc(32, 'a');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const revision = { etag: '"final"', size: 32, versionId: 'final/version 1' };
type Step = {
  method: string;
  respond: () => HttpResponse | Promise<HttpResponse>;
};

describe('Isolated confirmation cycle: real SDK/adapter, simulated store and native HTTP', () => {
  const steps: Step[] = [];
  const requests: string[] = [];
  const rejectedTargets: Array<{
    method: unknown;
    hostname: unknown;
    path: unknown;
  }> = [];
  const clients: S3Client[] = [];
  const dispatchers: MediaPromotionCopyDispatcher[] = [];
  const destroySpies: jest.SpyInstance[] = [];
  let target: string;
  let socketGuard: jest.SpyInstance;
  beforeEach(() => {
    steps.length = requests.length = 0;
    rejectedTargets.length = 0;
    destroySpies.length = 0;
    target = '';
    socketGuard = jest
      .spyOn(net.Socket.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('Real sockets forbidden');
      });
    jest.spyOn(http, 'request').mockImplementation(() => {
      throw new Error('Plain HTTP forbidden');
    });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.spyOn(https, 'request').mockImplementation(((
      options: http.RequestOptions,
      callback: (response: http.IncomingMessage) => void,
    ) => {
      const method = options.method!;
      const url = new URL(options.path!, 'https://synthetic.invalid');
      if (
        (options.hostname ?? options.host) !==
          'animalrecord-test-media.s3.us-east-1.amazonaws.com' ||
        !['PUT', 'HEAD', 'GET'].includes(method) ||
        decodeURIComponent(url.pathname) !== '/' + target
      ) {
        rejectedTargets.push({
          method,
          hostname: options.hostname ?? options.host,
          path: options.path,
        });
        throw new Error('Unexpected synthetic destination');
      }
      requests.push(method);
      const request = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
      request.on('finish', () => {
        void Promise.resolve()
          .then(async () => {
            const step = steps.shift();
            if (!step || step.method !== method)
              throw new Error('Unexpected native request');
            return bounded(
              Promise.resolve().then(step.respond),
              'synthetic confirmation response',
            );
          })
          .then(
            (response) => {
              const body = response.body as unknown;
              callback(
                Object.assign(
                  body instanceof Readable ? body : Readable.from([]),
                  {
                    statusCode: response.statusCode,
                    headers: response.headers,
                  },
                ) as unknown as http.IncomingMessage,
              );
            },
            (error: unknown) => request.emit('error', error),
          );
      });
      return request as unknown as http.ClientRequest;
    }) as typeof https.request);
  });
  afterEach(() => {
    try {
      dispatchers.splice(0).forEach((d) => d.destroy());
      clients.splice(0).forEach((c) => c.destroy());
      expect(socketGuard).not.toHaveBeenCalled();
      expect(rejectedTargets).toEqual([]);
      expect(steps).toHaveLength(0);
    } finally {
      jest.restoreAllMocks();
    }
  });

  function setup(
    kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
    maxAttempts = 1,
  ) {
    const f = promotionStoreFixture(kind);
    f.change('uploads', (rows) => {
      (rows[0].pinned as Record<string, unknown>).sha256 = sha256;
    });
    target = f.upload.finalKey;
    const input = {
      scope: { ...f.initial.scope },
      uploadId: f.upload.id,
      bucket: 'animalrecord-test-media',
      effectId: f.effectId,
      dispatcherInstanceId: f.id(30),
      observationId: f.id(40),
    };
    const credentials = {
      accessKeyId: 'SYNTHETIC',
      secretAccessKey: 'synthetic-secret',
    };
    const client = new S3Client({
      region: 'us-east-1',
      credentials,
      maxAttempts: 1,
      defaultsMode: 'standard',
    });
    clients.push(client);
    const reader = new AwsMediaPromotionDestinationReader(client);
    const factory = {
      create: jest
        .fn<
          ReturnType<MediaPromotionDispatcherFactory['create']>,
          Parameters<MediaPromotionDispatcherFactory['create']>
        >()
        .mockImplementation(async (identity) => {
          const d = await MediaPromotionCopyDispatcher.create(f.repository, {
            ...identity,
            credentials,
            regions: ['us-east-1'],
            maxAttempts,
          });
          dispatchers.push(d);
          destroySpies.push(jest.spyOn(d, 'destroy'));
          return d;
        }),
    } satisfies MediaPromotionDispatcherFactory;
    const head = () =>
      new HttpResponse({
        statusCode: 200,
        headers: {
          etag: revision.etag,
          'content-length': '32',
          'x-amz-version-id': revision.versionId,
          'content-type': f.upload.mimeType,
          'x-amz-meta-animal-upload-id': f.upload.id,
          'x-amz-meta-animal-upload-sha256': sha256,
        },
        body: Readable.from([]),
      });
    const get = () =>
      new HttpResponse({
        statusCode: 200,
        headers: {
          etag: revision.etag,
          'content-length': '32',
          'x-amz-version-id': revision.versionId,
        },
        body: Readable.from([bytes]),
      });
    const observations = () =>
      f.state().records.filter((r) => r.kind === 'OBSERVATION');
    const attempts = () =>
      f.state().records.filter((r) => r.kind === 'ATTEMPT');
    const queue = (method: string, respond: Step['respond']) =>
      steps.push({ method, respond });
    const verification = () => {
      queue('HEAD', head);
      queue('GET', get);
      queue('HEAD', head);
    };
    const copy = () => {
      const grants = attempts().filter((r) => r.authorizationId);
      expect(grants).toHaveLength(requests.filter((m) => m === 'PUT').length);
      expect(new Set(grants.map((r) => r.authorizationId)).size).toBe(
        grants.length,
      );
      return xmlResponse(200);
    };
    const absent = () =>
      new HttpResponse({ statusCode: 404, body: Readable.from([]) });
    const success = () => {
      queue('HEAD', absent);
      queue('PUT', copy);
      verification();
    };
    const cycle = () =>
      new MediaPromotionConfirmation(f.repository, reader, factory);
    const confirmation = cycle();
    const runtimeConfig = {
      bucket: input.bucket,
      region: 'us-east-1',
      credentials,
      maxAttempts,
    };
    const runtime = (config: AwsPromotionConfirmationConfig = runtimeConfig) =>
      new AwsMediaPromotionConfirmation(f.repository, config);
    return {
      ...f,
      input,
      reader,
      factory,
      head,
      get,
      copy,
      absent,
      queue,
      verification,
      success,
      cycle,
      confirmation,
      attempts,
      observations,
      confirm: () => confirmation.confirm(input),
      runtime,
      runtimeConfig,
    };
  }

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'confirms %s with UNKNOWN, MATCH and seal together; retains grant/claim',
    async (kind) => {
      const f = setup(kind),
        before = f.state();
      f.success();
      await f.confirm();
      expect(requests).toEqual(['HEAD', 'PUT', 'HEAD', 'GET', 'HEAD']);
      expect(f.state().uploads[0].sealed).toEqual(revision);
      expect(f.observations()).toMatchObject([
        {
          id: f.input.observationId,
          data: { finding: 'MATCH' },
        },
      ]);
      expect(
        f.state().records.filter((r) => r.kind === 'RESPONSE'),
      ).toMatchObject([{ data: { outcome: 'UNKNOWN' } }]);
      expect(f.attempts()[0].authorizationId).toBeDefined();
      expect(destroySpies[0]).toHaveBeenCalled();
      expect(f.state().controls[0].activeWrites).toEqual(
        before.controls[0].activeWrites,
      );
      expect(f.state().journals[0].callback).toBe('MAY_RUN');
    },
  );

  it('verifies an existing final without creating a dispatcher or attributing an ACK', async () => {
    const f = setup();
    f.queue('HEAD', f.head);
    f.verification();
    await f.confirm();
    expect(f.factory.create).not.toHaveBeenCalled();
    expect(f.attempts()).toHaveLength(0);
    expect(f.observations()).toHaveLength(1);
    expect(f.state().uploads[0].sealed).toEqual(revision);
  });

  it.each([409, 412])(
    'reconciles SDK %s by full verification without another send',
    async (status) => {
      const f = setup();
      f.queue('HEAD', f.absent);
      f.queue('PUT', () => xmlResponse(status, 'PreconditionFailed'));
      f.verification();
      await f.confirm();
      expect(requests.filter((m) => m === 'PUT')).toHaveLength(1);
      expect(f.attempts()[0].authorizationId).toBeDefined();
      expect(f.state().uploads[0].sealed).toEqual(revision);
    },
  );

  it('gives every physical SDK retry a new durable permission before verifying', async () => {
    const f = setup('PROFILE_CONFIRM', 2);
    f.queue('HEAD', f.absent);
    f.queue('PUT', () => {
      f.copy();
      return xmlResponse(503, 'SlowDown');
    });
    f.queue('PUT', f.copy);
    f.verification();
    await f.confirm();
    expect(requests).toEqual(['HEAD', 'PUT', 'PUT', 'HEAD', 'GET', 'HEAD']);
    expect(f.attempts()).toHaveLength(2);
    expect(f.attempts()[1].data).toMatchObject({
      origin: 'SDK_RETRY',
      previousAttemptId: f.attempts()[0].id,
    });
  });

  it.each([500, 'network'] as const)(
    'stops on %s without verification, fallback or new application attempt',
    async (status) => {
      const f = setup();
      f.queue('HEAD', f.absent);
      f.queue('PUT', () => {
        if (status === 'network')
          throw Object.assign(new Error('secret endpoint'), {
            code: 'ECONNRESET',
          });
        return xmlResponse(status, 'InternalError');
      });
      await expect(f.confirm()).rejects.toMatchObject({
        stage: 'DISPATCH',
        reason: 'UNCERTAIN',
      });
      expect(requests).toEqual(['HEAD', 'PUT']);
      expect(f.observations()).toHaveLength(0);
      expect(f.attempts()[0].authorizationId).toBeDefined();
    },
  );

  it.each(['OPEN', 'DECLARE', 'AUTHORIZE_ATTEMPT', 'RECORD_RESPONSE'] as const)(
    'does not adopt a committed %s with lost application reply',
    async (lost) => {
      const f = setup();
      if (lost === 'OPEN') {
        f.loseReply();
      } else {
        const apply = f.repository.apply.bind(f.repository);
        jest
          .spyOn(f.repository, 'apply')
          .mockImplementation((selection, rev, command) => {
            if (command.type === (lost === 'DECLARE' ? 'DECLARE_EFFECT' : lost))
              f.loseReply();
            return apply(selection, rev, command);
          });
      }
      if (lost === 'AUTHORIZE_ATTEMPT' || lost === 'RECORD_RESPONSE')
        f.queue('HEAD', f.absent);
      if (lost === 'RECORD_RESPONSE') f.queue('PUT', f.copy);
      await expect(f.confirm()).rejects.toMatchObject({
        stage:
          lost === 'OPEN'
            ? 'OPEN'
            : lost === 'DECLARE'
              ? 'DECLARE'
              : 'DISPATCH',
        reason: 'UNCERTAIN',
      });
      expect(f.observations()).toHaveLength(0);
      expect(f.state().uploads[0].sealed).toBeUndefined();
      if (lost === 'AUTHORIZE_ATTEMPT') {
        expect(f.attempts()[0].authorizationId).toBeDefined();
        expect(requests).toEqual(['HEAD']);
      }
      if (lost === 'RECORD_RESPONSE') expect(requests).toEqual(['HEAD', 'PUT']);
    },
  );

  it.each(['INTEND_ATTEMPT', 'AUTHORIZE_ATTEMPT', 'RECORD_RESPONSE'] as const)(
    'local %s failure carrying SDK 412 metadata remains terminal',
    async (failed) => {
      const f = setup(),
        apply = f.repository.apply.bind(f.repository);
      jest
        .spyOn(f.repository, 'apply')
        .mockImplementation((selection, rev, command) => {
          if (command.type === failed)
            return Promise.reject(
              Object.assign(new Error('secret persistence URI'), {
                $metadata: { httpStatusCode: 412 },
              }),
            );
          return apply(selection, rev, command);
        });
      f.queue('HEAD', f.absent);
      if (failed === 'RECORD_RESPONSE') f.queue('PUT', f.copy);
      await expect(f.confirm()).rejects.toMatchObject({
        stage: 'DISPATCH',
        reason: 'UNCERTAIN',
      });
      expect(requests).toEqual(
        failed === 'RECORD_RESPONSE' ? ['HEAD', 'PUT'] : ['HEAD'],
      );
      expect(f.observations()).toHaveLength(0);
    },
  );

  it('reports lost seal commit response as uncertain with original MATCH and seal still durable', async () => {
    const f = setup();
    f.queue('HEAD', f.head);
    f.queue('HEAD', f.head);
    f.queue('GET', f.get);
    f.queue('HEAD', () => {
      f.loseReply();
      return f.head();
    });
    await expect(f.confirm()).rejects.toMatchObject({
      stage: 'SEAL',
      reason: 'UNCERTAIN',
    });
    expect(f.state().uploads[0].sealed).toEqual(revision);
    expect(
      (await f.repository.read(f.selection, f.input.observationId)).record,
    ).toMatchObject({ id: f.input.observationId, kind: 'OBSERVATION' });
    await expect(f.confirm()).rejects.toMatchObject({ stage: 'LIFECYCLE' });
    expect(requests).toEqual(['HEAD', 'HEAD', 'GET', 'HEAD']);
  });

  it.each(['missing', 'wrong bytes'] as const)(
    'does not copy when a previously present destination becomes %s',
    async (change) => {
      const f = setup();
      f.queue('HEAD', f.head);
      if (change === 'missing') f.queue('HEAD', f.absent);
      else {
        f.queue('HEAD', f.head);
        f.queue(
          'GET',
          () =>
            new HttpResponse({
              ...f.get(),
              body: Readable.from([Buffer.alloc(32, 'b')]),
            }),
        );
      }
      await expect(f.confirm()).rejects.toMatchObject({
        stage: 'VERIFY',
        reason: 'CONFLICT',
      });
      expect(f.factory.create).not.toHaveBeenCalled();
      expect(f.observations()).toHaveLength(0);
    },
  );

  it('revocation during GET invalidates sealing but keeps the previously granted permission', async () => {
    const f = setup();
    f.queue('HEAD', f.absent);
    f.queue('PUT', f.copy);
    f.queue('HEAD', f.head);
    f.queue('GET', async () => {
      const state = await f.repository.read(f.selection);
      await f.repository.revoke(f.selection, state.gate!.gateRevision, f.audit);
      return f.get();
    });
    f.queue('HEAD', f.head);
    await expect(f.confirm()).rejects.toMatchObject({
      stage: 'SEAL',
      reason: 'CONFLICT',
    });
    expect(f.attempts()[0].authorizationId).toBeDefined();
    expect(f.observations()).toHaveLength(0);
    expect(f.state().uploads[0].sealed).toBeUndefined();
  });

  it('cannot replay through another instance using the same operation/evidence', async () => {
    const f = setup();
    f.success();
    await f.confirm();
    const before = f.state();
    await expect(f.cycle().confirm(f.input)).rejects.toMatchObject({
      stage: 'OPEN',
      reason: 'CONFLICT',
    });
    expect(f.state()).toEqual(before);
    expect(requests).toHaveLength(5);
  });

  it('denies a concurrent invocation before it can open another gate', async () => {
    const f = setup(),
      pause = f.pause('journals');
    f.success();
    const first = f.confirm();
    try {
      await bounded(pause.entered, 'gate pause');
      await expect(f.confirm()).rejects.toMatchObject({
        stage: 'LIFECYCLE',
        reason: 'CONFLICT',
      });
    } finally {
      pause.resume();
      await first;
    }
    expect(f.attempts()).toHaveLength(1);
  });

  it('captures all backend identities before the first await', async () => {
    const f = setup(),
      pause = f.pause('journals');
    f.success();
    const original = structuredClone(f.input);
    const first = f.confirm();
    try {
      await bounded(pause.entered, 'gate pause');
      f.input.scope.ownerId = f.id(90);
      f.input.effectId = f.id(91);
      f.input.observationId = f.id(92);
      f.input.dispatcherInstanceId = f.id(93);
      f.input.uploadId = f.id(94);
      f.input.bucket = 'other-bucket';
    } finally {
      pause.resume();
      await first;
    }
    expect(f.observations()[0].id).toBe(original.observationId);
    expect(f.factory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: original.scope,
        effectId: original.effectId,
        dispatcherInstanceId: original.dispatcherInstanceId,
      }),
    );
  });

  it.each(['UUID', 'collision', 'bucket', 'scope'] as const)(
    'rejects invalid %s before any durable or native operation',
    async (invalid) => {
      const f = setup();
      if (invalid === 'UUID') f.input.observationId = 'invalid';
      if (invalid === 'collision') f.input.observationId = f.input.effectId;
      if (invalid === 'bucket') f.input.bucket = 'https://secret';
      if (invalid === 'scope') f.input.scope.ownershipVersion = 0;
      await expect(f.confirm()).rejects.toMatchObject({
        stage: 'INPUT',
        reason: 'CONFLICT',
      });
      expect(f.state().records).toHaveLength(0);
      expect(requests).toHaveLength(0);
    },
  );

  it.each(['legacy', 'sealed', 'unpinned'] as const)(
    'does not adopt a %s ticket',
    async (kind) => {
      const f = setup();
      f.change('uploads', (rows) => {
        if (kind === 'legacy') rows[0].legacy = {};
        if (kind === 'sealed') rows[0].sealed = revision;
        if (kind === 'unpinned') delete rows[0].pinned;
      });
      await expect(f.confirm()).rejects.toMatchObject({
        stage: 'DECLARE',
        reason: 'CONFLICT',
      });
      expect(requests).toHaveLength(0);
      expect(f.attempts()).toHaveLength(0);
    },
  );

  it('rejects unmarked MAY_RUN journals without retrofitting the protocol', async () => {
    const f = setup();
    f.change('journals', (rows) => {
      delete rows[0].mediaPromotionProtocol;
    });
    await expect(f.confirm()).rejects.toMatchObject({
      stage: 'OPEN',
      reason: 'CONFLICT',
    });
    expect(f.state().journals[0].mediaPromotionProtocol).toBeUndefined();
    expect(requests).toHaveLength(0);
  });

  it('keeps an earlier revocation tombstone and does not attempt inspection or copy', async () => {
    const f = setup();
    await f.repository.revoke(f.selection, undefined, f.audit);
    const before = f.state();
    await expect(f.confirm()).rejects.toMatchObject({
      stage: 'OPEN',
      reason: 'CONFLICT',
    });
    expect(f.state()).toEqual(before);
    expect(requests).toHaveLength(0);
  });

  it('retains the existing 5 GiB effect limit before native I/O', async () => {
    const f = setup();
    f.change('uploads', (rows) => {
      rows[0].size = 5 * 1024 * 1024 * 1024 + 1;
      (rows[0].pinned as Record<string, unknown>).size = rows[0].size;
    });
    await expect(f.confirm()).rejects.toMatchObject({
      stage: 'DECLARE',
      reason: 'CONFLICT',
    });
    expect(requests).toHaveLength(0);
    expect(f.factory.create).not.toHaveBeenCalled();
    expect(f.attempts()).toHaveLength(0);
  });

  it('does not treat a failed preflight HEAD as destination absence', async () => {
    const f = setup();
    f.queue('HEAD', () => xmlResponse(503, 'SlowDown'));
    await expect(f.confirm()).rejects.toMatchObject({
      stage: 'INSPECT',
      reason: 'UNAVAILABLE',
    });
    expect(f.factory.create).not.toHaveBeenCalled();
    expect(f.observations()).toHaveLength(0);
  });

  it('sanitizes setup failures and never enters verification', async () => {
    const f = setup();
    f.queue('HEAD', f.absent);
    f.factory.create.mockRejectedValueOnce(
      new Error('mongodb://secret credentials headers payload'),
    );
    let error: unknown;
    try {
      await f.confirm();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MediaPromotionConfirmationError);
    expect(error).toMatchObject({
      stage: 'DISPATCH_SETUP',
      reason: 'UNAVAILABLE',
    });
    expect(String(error)).not.toMatch(
      /secret|credentials|headers|payload|mongodb/,
    );
    expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false);
    expect(requests).toEqual(['HEAD']);
  });

  it.each(['ownerId', 'ownershipVersion'] as const)(
    'does not continue with a backend context whose %s differs from the journal',
    async (field) => {
      const f = setup();
      if (field === 'ownerId') f.input.scope.ownerId = f.id(90);
      else f.input.scope.ownershipVersion++;
      await expect(f.confirm()).rejects.toMatchObject({
        stage: 'OPEN',
        reason: 'CONFLICT',
      });
      expect(f.attempts()).toHaveLength(0);
      expect(requests).toHaveLength(0);
    },
  );

  it('a claim removed during preflight prevents permission despite the old snapshot', async () => {
    const f = setup();
    f.queue('HEAD', () => {
      f.change('controls', (rows) => {
        rows[0].activeWrites = [];
      });
      return f.absent();
    });
    await expect(f.confirm()).rejects.toMatchObject({
      stage: 'DISPATCH',
      reason: 'UNCERTAIN',
    });
    expect(f.attempts()).toHaveLength(0);
    expect(requests).toEqual(['HEAD']);
    expect(destroySpies[0]).toHaveBeenCalled();
  });

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    'AWS assembly confirms %s and releases its private read/copy clients',
    async (kind) => {
      const f = setup(kind),
        destroy = jest.spyOn(S3Client.prototype, 'destroy');
      f.success();
      await f.runtime().confirm(f.input);
      expect(requests).toEqual(['HEAD', 'PUT', 'HEAD', 'GET', 'HEAD']);
      expect(f.state().uploads[0].sealed).toEqual(revision);
      expect(destroy).toHaveBeenCalledTimes(2);
    },
  );

  it('AWS assembly keeps configuration and static credentials captured at construction', async () => {
    const f = setup(),
      runtime = f.runtime();
    f.runtimeConfig.bucket = 'other-bucket';
    f.runtimeConfig.region = 'us-west-2';
    f.runtimeConfig.maxAttempts = 2;
    f.runtimeConfig.credentials.accessKeyId = 'CHANGED';
    f.runtimeConfig.credentials.secretAccessKey = '';
    f.success();
    await runtime.confirm(f.input);
    expect(f.state().uploads[0].sealed).toEqual(revision);
    expect(requests).toHaveLength(5);
  });

  it('AWS assembly overrides a foreign bucket offered on its internal input', async () => {
    const f = setup();
    f.success();
    await f
      .runtime()
      .confirm({ ...f.input, bucket: 'other-bucket' } as typeof f.input);
    expect(f.observations()).toHaveLength(1);
  });

  it('AWS assembly verifies an existing final and releases only its reader client', async () => {
    const f = setup(),
      destroy = jest.spyOn(S3Client.prototype, 'destroy');
    f.queue('HEAD', f.head);
    f.verification();
    await f.runtime().confirm(f.input);
    expect(f.attempts()).toHaveLength(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('AWS assembly supports an explicit rotating credential provider without default credentials', async () => {
    const f = setup();
    const provider = jest
      .fn()
      .mockResolvedValue(Object.freeze({ ...f.runtimeConfig.credentials }));
    f.success();
    await f
      .runtime({ ...f.runtimeConfig, credentials: provider })
      .confirm(f.input);
    expect(provider).toHaveBeenCalled();
    expect(f.observations()).toHaveLength(1);
  });

  it('AWS assembly defaults to three readonly attempts without creating grants on HEAD failure', async () => {
    const f = setup(),
      destroy = jest.spyOn(S3Client.prototype, 'destroy');
    for (let i = 0; i < 3; i++)
      f.queue('HEAD', () => xmlResponse(503, 'SlowDown'));
    await expect(
      f
        .runtime({ ...f.runtimeConfig, maxAttempts: undefined })
        .confirm(f.input),
    ).rejects.toMatchObject({ stage: 'INSPECT', reason: 'UNAVAILABLE' });
    expect(f.attempts()).toHaveLength(0);
    expect(requests).toEqual(['HEAD', 'HEAD', 'HEAD']);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('AWS assembly gives copy retries distinct permissions using the configured limit', async () => {
    const f = setup();
    f.queue('HEAD', f.absent);
    f.queue('PUT', () => {
      f.copy();
      return xmlResponse(503, 'SlowDown');
    });
    f.queue('PUT', f.copy);
    f.verification();
    await f.runtime({ ...f.runtimeConfig, maxAttempts: 2 }).confirm(f.input);
    expect(f.attempts()).toHaveLength(2);
    expect(f.observations()).toHaveLength(1);
  });

  it('AWS assembly releases its reader after an invalid input or uncertain open', async () => {
    const f = setup(),
      destroy = jest.spyOn(S3Client.prototype, 'destroy');
    await expect(
      f.runtime().confirm({ ...f.input, observationId: 'invalid' }),
    ).rejects.toMatchObject({ stage: 'INPUT' });
    f.loseReply();
    await expect(f.runtime().confirm(f.input)).rejects.toMatchObject({
      stage: 'OPEN',
      reason: 'UNCERTAIN',
    });
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(0);
  });

  it('AWS assembly releases both clients on an uncertain copy and does not verify', async () => {
    const f = setup(),
      destroy = jest.spyOn(S3Client.prototype, 'destroy');
    f.queue('HEAD', f.absent);
    f.queue('PUT', () => xmlResponse(500, 'InternalError'));
    await expect(f.runtime().confirm(f.input)).rejects.toMatchObject({
      stage: 'DISPATCH',
      reason: 'UNCERTAIN',
    });
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(requests).toEqual(['HEAD', 'PUT']);
  });

  it('AWS assembly cannot adopt a previous successful operation in a fresh cycle', async () => {
    const f = setup(),
      runtime = f.runtime();
    f.success();
    await runtime.confirm(f.input);
    const before = f.state();
    await expect(runtime.confirm(f.input)).rejects.toMatchObject({
      stage: 'OPEN',
      reason: 'CONFLICT',
    });
    expect(f.state()).toEqual(before);
    expect(requests).toHaveLength(5);
  });

  it.each([
    { bucket: 'x' },
    { bucket: 'https://secret' },
    { region: '' },
    { region: 'cn-north-1' },
    { region: 'us-gov-west-1' },
    { region: 'us-iso-east-1' },
    { credentials: undefined },
    { credentials: {} },
    { credentials: { accessKeyId: 'key', secretAccessKey: '' } },
    {
      credentials: {
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        sessionToken: 4,
      },
    },
    { maxAttempts: 0 },
    { maxAttempts: 1.5 },
    { endpoint: 'https://secret' },
    { requestHandler: {} },
    { followRegionRedirects: true },
  ])(
    'AWS assembly rejects unsupported configuration before resources or persistence: %j',
    (override) => {
      const f = setup(),
        destroy = jest.spyOn(S3Client.prototype, 'destroy');
      let failure: unknown;
      try {
        f.runtime({
          ...f.runtimeConfig,
          ...override,
        } as AwsPromotionConfirmationConfig);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(InvalidArgumentError);
      expect((failure as Error).message).toBe(
        'Invalid promotion runtime configuration',
      );
      expect(destroy).not.toHaveBeenCalled();
      expect(f.state().records).toHaveLength(0);
      expect(requests).toHaveLength(0);
    },
  );

  it('AWS assembly pins reader endpoint and denies a copy endpoint overridden through environment', async () => {
    const f = setup();
    const previous = process.env.AWS_ENDPOINT_URL_S3;
    try {
      process.env.AWS_ENDPOINT_URL_S3 = 'https://unapproved.synthetic.invalid';
      f.queue('HEAD', f.absent);
      await expect(f.runtime().confirm(f.input)).rejects.toMatchObject({
        stage: 'DISPATCH',
        reason: 'UNCERTAIN',
      });
      expect(requests).toEqual(['HEAD']);
      expect(f.attempts()).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.AWS_ENDPOINT_URL_S3;
      else process.env.AWS_ENDPOINT_URL_S3 = previous;
    }
  });
});
