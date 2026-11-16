import {
  PromotionAttemptRow,
  PromotionResponseRow,
} from '../../../src/context/animal-media/domain/media-promotion-persistence';
import { xmlResponse } from '../fixtures/s3-promotion-transport.fixture';
import { PromotionDispatchMongoFixture } from './support/media-promotion-dispatch-mongo-fixture';
import { readPromotionDispatchMongoSettings } from './support/media-promotion-dispatch-mongo-safety';

// Only the dedicated config discovers this suite. No real HTTP/S3 or app bootstrap.
describe('Opt-in Mongo dispatcher with real persistence and synthetic native S3', () => {
  let f: PromotionDispatchMongoFixture;
  beforeEach(async () => {
    f = new PromotionDispatchMongoFixture();
    await f.open(readPromotionDispatchMongoSettings(process.env));
    jest.spyOn(Math, 'random').mockReturnValue(0); // Actual SDK retry, zero jitter delay.
  });
  afterEach(async () => {
    try {
      await f.close();
    } finally {
      jest.restoreAllMocks();
    }
  });

  const attempts = () =>
    f.right.records
      .find<PromotionAttemptRow>({ kind: 'ATTEMPT' })
      .sort({ ordinal: 1 })
      .read('primary')
      .readConcern('majority')
      .lean<PromotionAttemptRow[]>()
      .exec();
  const responses = () =>
    f.right.records
      .find<PromotionResponseRow>({ kind: 'RESPONSE' })
      .read('primary')
      .readConcern('majority')
      .lean<PromotionResponseRow[]>()
      .exec();
  const seal = async () => {
    const upload = await f.right.uploads.findOne().lean().exec();
    await f.right.uploadRepository.seal(
      upload!.finalKey,
      upload!.pinned!.sha256,
      { etag: 'synthetic-final', size: 32 },
    );
  };
  const revoke = async () => {
    const s = await f.right.journals.findOne().lean().exec();
    const selection = {
      operationId: s!.id,
      instanceId: s!.instanceId,
      animalId: s!.claims[0].animalId,
    };
    const read = await f.right.repository.read(selection);
    await f.right.repository.revoke(selection, read.gate!.gateRevision, {
      requestId: '20000000-0000-4000-8000-000000000001',
      operatorId: '20000000-0000-4000-8000-000000000002',
      evidenceRef: 'test:dispatch-revoked',
    });
  };
  async function grantBeforeNative(count: number) {
    const rows = await attempts();
    expect(rows).toHaveLength(count);
    expect(rows.every((r) => typeof r.authorizationId === 'string')).toBe(true);
    expect(new Set(rows.map((r) => r.authorizationId)).size).toBe(count);
    expect(rows.map((r) => r.ordinal)).toEqual(
      Array.from({ length: count }, (_, i) => i + 1),
    );
    const transactionIds = [
      'animal_write_journals',
      'animal_ownership_controls',
      'animal_media_uploads',
      'animal_media_promotion_records',
    ].map(
      (collection) =>
        f.commands
          .filter(
            (c) =>
              c.side === 'left' &&
              c.command === 'update' &&
              c.collection === collection,
          )
          .at(-1)?.transaction,
    );
    expect(transactionIds[0]).toBeDefined();
    expect(new Set(transactionIds).size).toBe(1);
    expect(
      f.commands.some(
        (c) =>
          c.transaction === transactionIds[0] &&
          c.command === 'commitTransaction' &&
          c.majority,
      ),
    ).toBe(true);
    expect(
      f.commands.some((c) => c.transaction === transactionIds[0] && c.snapshot),
    ).toBe(true);
  }

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    '%s has a committed grant visible to another client before native delegation',
    async (kind) => {
      const s = await f.declare(kind),
        dispatcher = await f.dispatcher(s);
      f.transport.steps.push(async () => {
        await grantBeforeNative(1);
        return xmlResponse();
      });
      await expect(dispatcher.send()).resolves.toMatchObject({
        CopyObjectResult: { ETag: '"final-etag"' },
      });
      expect(f.transport.requests).toHaveLength(1);
      expect(f.transport.requests[0].method).toBe('PUT');
      expect(f.transport.requests[0].path).toContain(s.upload.finalKey);
      expect(f.transport.requests[0].source).toContain(s.upload.stagingKey);
      expect((await responses())[0].data).toMatchObject({ outcome: 'UNKNOWN' });
      const snapshot = await f.snapshot();
      expect(snapshot.uploads[0].sealed).toBeUndefined(); // No verification/seal from a synthetic 200.
      expect(snapshot.uploads[0].mediaPromotionRevision).toBe(3);
      expect(snapshot.control!.activeWrites).toHaveLength(1);
    },
  );

  it.each(['503', 'reset', '200-error'] as const)(
    'persists separate attempts and permissions on SDK retry after %s',
    async (failure) => {
      const s = await f.declare(),
        dispatcher = await f.dispatcher(s);
      f.transport.steps.push(
        async () => {
          await grantBeforeNative(1);
          if (failure === 'reset')
            throw Object.assign(new Error('synthetic reset'), {
              code: 'ECONNRESET',
            });
          return xmlResponse(failure === '503' ? 503 : 200, 'SlowDown');
        },
        async () => {
          await grantBeforeNative(2);
          return xmlResponse();
        },
      );
      await dispatcher.send();
      expect(f.transport.requests).toHaveLength(2);
      const rows = await attempts();
      expect(rows[1].data).toMatchObject({
        origin: 'SDK_RETRY',
        previousAttemptId: rows[0].id,
        dispatcherInstanceId: s.id(30),
      });
      expect(await responses()).toHaveLength(2);
    },
  );

  it('regional redirect obtains another permission even if SDK metadata reports one attempt', async () => {
    const s = await f.declare(),
      dispatcher = await f.dispatcher(s, 'left', {
        followRegionRedirects: true,
        regions: ['us-east-1', 'us-west-2'],
      });
    f.transport.steps.push(
      async () => {
        await grantBeforeNative(1);
        return xmlResponse(301, 'PermanentRedirect', {
          'x-amz-bucket-region': 'us-west-2',
        });
      },
      async () => {
        await grantBeforeNative(2);
        return xmlResponse();
      },
    );
    const result = await dispatcher.send();
    expect(result.$metadata.attempts).toBe(1);
    expect(f.transport.requests).toHaveLength(2);
    expect(await attempts()).toHaveLength(2);
  });

  it('SDK exhaustion preserves every grant and UNKNOWN response', async () => {
    const s = await f.declare(),
      dispatcher = await f.dispatcher(s);
    for (let i = 1; i <= 3; i++)
      f.transport.steps.push(async () => {
        await grantBeforeNative(i);
        return xmlResponse(503, 'SlowDown');
      });
    await expect(dispatcher.send()).rejects.toMatchObject({ name: 'SlowDown' });
    expect(f.transport.requests).toHaveLength(3);
    expect(await responses()).toHaveLength(3);
    await expect(f.dispatcher(s, 'right')).rejects.toMatchObject({
      stage: 'SETUP',
    });
  });

  it('seal wins against a stale intention snapshot and no permission or native send remains', async () => {
    const s = await f.declare(),
      dispatcher = await f.dispatcher(s);
    const pause = f.left.gate.arm('UPLOAD_FENCE'),
      before = await f.snapshot();
    const pending = f.observe(dispatcher.send());
    await pause.entered();
    await seal();
    pause.release();
    expect(await pending).toMatchObject({ error: { stage: 'PERMISSION' } });
    const after = await f.snapshot();
    expect(after.records).toEqual(before.records);
    expect(after.journal).toEqual(before.journal);
    expect(after.control).toEqual(before.control);
    expect(after.uploads[0].mediaPromotionRevision).toBe(
      before.uploads[0].mediaPromotionRevision,
    );
    expect(f.transport.requests).toHaveLength(0);
  });

  it('seal after intention denies authorization without erasing the intention', async () => {
    const s = await f.declare(),
      dispatcher = await f.dispatcher(s),
      pause = f.pauseReply('INTEND_ATTEMPT');
    const pending = f.observe(dispatcher.send());
    await pause.entered();
    await seal();
    pause.release();
    expect(await pending).toMatchObject({ error: { stage: 'PERMISSION' } });
    expect(await attempts()).toHaveLength(1);
    expect((await attempts())[0].authorizationId).toBeUndefined();
    expect(f.transport.requests).toHaveLength(0);
  });

  it.each(['seal', 'revoke'] as const)(
    '%s after a committed grant with paused reply cannot prevent its late delegation',
    async (action) => {
      const s = await f.declare(),
        dispatcher = await f.dispatcher(s),
        pause = f.pauseReply('AUTHORIZE_ATTEMPT');
      f.transport.steps.push(() => xmlResponse());
      const pending = f.observe(dispatcher.send());
      await pause.entered();
      expect(f.transport.requests).toHaveLength(0);
      expect((await attempts())[0].authorizationId).toEqual(expect.any(String));
      if (action === 'seal') await seal();
      else await revoke();
      pause.release();
      expect(await pending).toHaveProperty('value');
      expect(f.transport.requests).toHaveLength(1);
      expect((await responses())[0].data).toMatchObject({ outcome: 'UNKNOWN' });
    },
  );

  it.each(['INTEND_ATTEMPT', 'AUTHORIZE_ATTEMPT'] as const)(
    'application reply lost after acknowledged %s commit never authorizes a send',
    async (type) => {
      const s = await f.declare(),
        dispatcher = await f.dispatcher(s);
      const apply = f.left.repository.apply.bind(f.left.repository);
      jest
        .spyOn(f.left.repository, 'apply')
        .mockImplementation(async (...args) => {
          if (args[2].type === type) f.loseNextCommitReply(f.left);
          return apply(...args);
        });
      await expect(dispatcher.send()).rejects.toMatchObject({
        stage: 'PERMISSION',
        $metadata: { attempts: 1 },
      });
      expect(f.transport.requests).toHaveLength(0);
      expect(await attempts()).toHaveLength(1);
      expect(!!(await attempts())[0].authorizationId).toBe(
        type === 'AUTHORIZE_ATTEMPT',
      );
      await expect(f.dispatcher(s, 'right')).rejects.toMatchObject({
        stage: 'SETUP',
      });
    },
  );

  it.each([false, true])(
    'response failure (committed=%s) stops retry and keeps permission',
    async (committed) => {
      const s = await f.declare(),
        dispatcher = await f.dispatcher(s);
      const apply = f.left.repository.apply.bind(f.left.repository);
      jest
        .spyOn(f.left.repository, 'apply')
        .mockImplementation(async (...args) => {
          if (args[2].type === 'RECORD_RESPONSE') {
            if (committed) f.loseNextCommitReply(f.left);
            else f.left.gate.failGateCas = true; // Real zero-match final CAS, transaction rolls back.
          }
          return apply(...args);
        });
      f.transport.steps.push(() => xmlResponse(503, 'SlowDown'));
      await expect(dispatcher.send()).rejects.toMatchObject({
        stage: 'RESPONSE',
        $metadata: { attempts: 1 },
      });
      expect(f.transport.requests).toHaveLength(1);
      expect(await responses()).toHaveLength(committed ? 1 : 0);
      expect((await attempts())[0].authorizationId).toEqual(expect.any(String));
    },
  );

  it.each(['seal', 'revoke'] as const)(
    '%s after failed native delegation denies an SDK retry',
    async (action) => {
      const s = await f.declare(),
        dispatcher = await f.dispatcher(s);
      f.transport.steps.push(async () => {
        if (action === 'seal') await seal();
        else await revoke();
        return xmlResponse(503, 'SlowDown');
      });
      await expect(dispatcher.send()).rejects.toMatchObject({
        stage: 'PERMISSION',
      });
      expect(f.transport.requests).toHaveLength(1);
      expect(await attempts()).toHaveLength(1);
      expect((await attempts())[0].authorizationId).toEqual(expect.any(String));
      expect(await responses()).toHaveLength(1);
    },
  );

  it.each(['revoke', 'settle'] as const)(
    '%s between intention and authorization denies native delegation',
    async (action) => {
      const s = await f.declare(),
        dispatcher = await f.dispatcher(s),
        pause = f.pauseReply('INTEND_ATTEMPT');
      const pending = f.observe(dispatcher.send());
      await pause.entered();
      if (action === 'revoke') await revoke();
      else
        await f.right.journal.settleCallback(
          s.handle,
          'THREW',
          s.journal.createdAt,
        );
      pause.release();
      expect(await pending).toMatchObject({ error: { stage: 'PERMISSION' } });
      expect(f.transport.requests).toHaveLength(0);
      expect((await attempts())[0].authorizationId).toBeUndefined();
    },
  );

  it('two clients with dispatchers from the same snapshot cannot adopt each other attempts', async () => {
    const s = await f.declare(),
      first = await f.dispatcher(s),
      second = await f.dispatcher(s, 'right');
    const pause = f.transport.pauseNextResponse(xmlResponse());
    const pending = f.observe(first.send());
    await pause.entered();
    await expect(second.send()).rejects.toMatchObject({ stage: 'PERMISSION' });
    pause.release();
    expect(await pending).toHaveProperty('value');
    expect(await attempts()).toHaveLength(1);
    expect(f.transport.requests).toHaveLength(1);
  });

  it('a late evidence CAS conflict preserves the grant and stops SDK retry', async () => {
    const s = await f.declare(),
      dispatcher = await f.dispatcher(s);
    const apply = f.left.repository.apply.bind(f.left.repository);
    jest
      .spyOn(f.left.repository, 'apply')
      .mockImplementation(async (...args) => {
        if (args[2].type === 'RECORD_RESPONSE') await revoke();
        return apply(...args);
      });
    f.transport.steps.push(() => xmlResponse(503, 'SlowDown'));
    await expect(dispatcher.send()).rejects.toMatchObject({
      stage: 'RESPONSE',
    });
    expect(await responses()).toHaveLength(0);
    expect(f.transport.requests).toHaveLength(1);
    expect((await attempts())[0].authorizationId).toEqual(expect.any(String));
  });
});
