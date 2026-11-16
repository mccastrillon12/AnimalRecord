import { HttpResponse } from '@smithy/protocol-http';
import { PromotionMatch } from '../../../src/context/animal-media/domain/media-promotion-sealing';
import { xmlResponse } from '../fixtures/s3-promotion-transport.fixture';
import {
  PromotionSealMongoFixture,
  SEAL_BYTES,
  SEAL_REVISION,
} from './support/media-promotion-seal-mongo-fixture';
import { readPromotionSealMongoSettings } from './support/media-promotion-seal-mongo-safety';

type Seed = Awaited<ReturnType<PromotionSealMongoFixture['seedSeal']>>;
describe('Opt-in Mongo verified seal with real SDK and synthetic HEAD/GET transport', () => {
  let f: PromotionSealMongoFixture;
  beforeEach(async () => {
    f = new PromotionSealMongoFixture();
    await f.open(readPromotionSealMongoSettings(process.env));
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(async () => {
    try {
      await f.close();
    } finally {
      jest.restoreAllMocks();
    }
  });
  function script(s: Seed) {
    f.transport.steps.push(
      { method: 'HEAD', respond: () => s.head() },
      { method: 'GET', respond: () => s.get() },
      { method: 'HEAD', respond: () => s.head() },
    );
  }
  const observations = () =>
    f.right.records
      .find({ kind: 'OBSERVATION' })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  async function remainsUnsealed(s: Seed) {
    expect(
      (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
    ).toBeUndefined();
    expect(await observations()).toHaveLength(0);
  }
  async function revoke(s: Seed) {
    const read = await f.right.repository.read(s.selection);
    await f.right.repository.revoke(s.selection, read.gate!.gateRevision, {
      requestId: s.id(50),
      operatorId: s.id(51),
      evidenceRef: 'test:seal-revoked',
    });
  }

  it.each(['PROFILE_CONFIRM', 'ATTACHMENT_CONFIRM'] as const)(
    '%s writes MATCH/seal and all fences in one transaction after real SDK reads',
    async (kind) => {
      const s = await f.seedSeal(kind),
        start = f.commands.length;
      script(s);
      await f.verifier().verifyAndSeal(s.input);
      expect(f.transport.requests.map((r) => r.method)).toEqual([
        'HEAD',
        'GET',
        'HEAD',
      ]);
      expect(f.transport.requests[1].ifMatch).toBe(SEAL_REVISION.etag);
      expect(f.transport.requests[1].versionId).toBe(SEAL_REVISION.versionId);
      expect(
        (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
      ).toEqual(SEAL_REVISION);
      expect(
        (await f.right.repository.read(s.selection, s.input.observationId))
          .record,
      ).toMatchObject({
        kind: 'OBSERVATION',
        data: { finding: 'MATCH', revision: SEAL_REVISION },
      });
      expect(
        (await f.right.repository.read(s.selection, s.attemptId)).record,
      ).toHaveProperty('authorizationId', s.id(11));
      const commands = f.commands.slice(start),
        transactions = [
          ['update', 'animal_write_journals'],
          ['update', 'animal_ownership_controls'],
          ['update', 'animal_media_uploads'],
          ['insert', 'animal_media_promotion_records'],
          ['update', 'animal_media_promotion_records'],
        ].map(
          ([command, collection]) =>
            commands
              .filter(
                (c) =>
                  c.side === 'left' &&
                  c.command === command &&
                  c.collection === collection,
              )
              .at(-1)?.transaction,
        );
      expect(transactions[0]).toBeDefined();
      expect(new Set(transactions).size).toBe(1);
      expect(
        commands.some(
          (c) =>
            c.transaction === transactions[0] &&
            c.command === 'commitTransaction' &&
            c.majority,
        ),
      ).toBe(true);
      expect(
        commands.some((c) => c.transaction === transactions[0] && c.snapshot),
      ).toBe(true);
      expect((await f.snapshot()).control!.activeWrites).toHaveLength(1);
    },
  );

  it.each(['HEAD', 'GET'] as const)(
    'SDK retry of %s remains read-only and cannot create a new permission',
    async (method) => {
      const s = await f.seedSeal();
      if (method === 'HEAD')
        f.transport.steps.push({
          method,
          respond: () => xmlResponse(503, 'SlowDown'),
        });
      else
        f.transport.steps.push(
          { method: 'HEAD', respond: () => s.head() },
          {
            method: 'GET',
            respond: () => {
              throw Object.assign(new Error('synthetic reset'), {
                code: 'ECONNRESET',
              });
            },
          },
        );
      if (method === 'HEAD') script(s);
      else
        f.transport.steps.push(
          { method: 'GET', respond: () => s.get() },
          { method: 'HEAD', respond: () => s.head() },
        );
      await f.verifier().verifyAndSeal(s.input);
      expect(f.transport.requests).toHaveLength(4);
      expect(await f.right.records.countDocuments({ kind: 'ATTEMPT' })).toBe(1);
      expect(await f.right.records.countDocuments({ kind: 'RESPONSE' })).toBe(
        0,
      );
    },
  );

  it('GET 412 is verification conflict, never permission to copy', async () => {
    const s = await f.seedSeal();
    f.transport.steps.push(
      { method: 'HEAD', respond: () => s.head() },
      { method: 'GET', respond: () => xmlResponse(412, 'PreconditionFailed') },
    );
    await expect(f.verifier().verifyAndSeal(s.input)).rejects.toMatchObject({
      stage: 'VERIFY',
      reason: 'CONFLICT',
    });
    await remainsUnsealed(s);
    expect(f.transport.requests.map((r) => r.method)).toEqual(['HEAD', 'GET']);
  });
  it.each(['digest', 'truncated'] as const)(
    'rejects %s body without partial evidence or seal',
    async (mode) => {
      const s = await f.seedSeal();
      f.transport.steps.push(
        { method: 'HEAD', respond: () => s.head() },
        {
          method: 'GET',
          respond: () =>
            s.get(
              mode === 'digest'
                ? Buffer.alloc(32, 'b')
                : SEAL_BYTES.subarray(0, 31),
            ),
        },
      );
      await expect(f.verifier().verifyAndSeal(s.input)).rejects.toMatchObject({
        stage: 'VERIFY',
        reason: 'CONFLICT',
      });
      await remainsUnsealed(s);
    },
  );
  it('a changed current revision after GET cannot be sealed using bytes of the former version', async () => {
    const s = await f.seedSeal();
    f.transport.steps.push(
      { method: 'HEAD', respond: () => s.head() },
      { method: 'GET', respond: () => s.get() },
      {
        method: 'HEAD',
        respond: () => s.head({ 'x-amz-version-id': 'changed' }),
      },
    );
    await expect(f.verifier().verifyAndSeal(s.input)).rejects.toMatchObject({
      stage: 'VERIFY',
      reason: 'CONFLICT',
    });
    await remainsUnsealed(s);
  });
  it('HEAD 404 records no successful verification or permission', async () => {
    const s = await f.seedSeal();
    f.transport.steps.push({
      method: 'HEAD',
      respond: () => new HttpResponse({ statusCode: 404, headers: {} }),
    });
    await expect(f.verifier().verifyAndSeal(s.input)).rejects.toMatchObject({
      stage: 'VERIFY',
      reason: 'CONFLICT',
    });
    await remainsUnsealed(s);
  });

  it('ticket counter changed during native I/O invalidates the captured subject even if its gate did not change', async () => {
    const s = await f.seedSeal(),
      verifier = f.verifier();
    f.transport.steps.push({ method: 'HEAD', respond: () => s.head() });
    const pause = f.transport.pause('GET', s.get());
    f.transport.steps.push({ method: 'HEAD', respond: () => s.head() });
    const pending = f.observe(verifier.verifyAndSeal(s.input));
    await pause.entered();
    // Deliberate fixture fault, no production protocol adoption or recovery.
    await f.right.uploads.updateOne(
      { id: s.upload.id },
      { $inc: { mediaPromotionRevision: 1 } },
      { writeConcern: { w: 'majority' } },
    );
    pause.release();
    expect(await pending).toMatchObject({
      error: { stage: 'SEAL', reason: 'CONFLICT' },
    });
    await remainsUnsealed(s);
  });

  it.each(['gate-cas', 'identity-collision'] as const)(
    'rolls back MATCH/ticket/journal/control when %s rejects after tentative writes',
    async (mode) => {
      const s = await f.seedSeal(),
        before = await f.snapshot(),
        subject = await f.left.repository.readForSeal(
          s.selection,
          s.input.effectId,
        );
      if (mode === 'gate-cas') f.left.gate.failGateCas = true;
      const observation: PromotionMatch =
        mode === 'identity-collision'
          ? { ...s.observation, id: s.id(11) }
          : s.observation;
      await expect(
        f.left.repository.sealVerified(s.selection, subject, observation),
      ).rejects.toThrow();
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it.each(['authorization', 'seal'] as const)(
    'serializes a real authorization/seal race when %s wins',
    async (winner) => {
      const s = await f.seedSeal('PROFILE_CONFIRM', false),
        subject = await f.left.repository.readForSeal(
          s.selection,
          s.input.effectId,
        );
      const pause = f.left.gate.arm('JOURNAL_FENCE'); // Before acquiring any write lock.
      const pending = f.observe<unknown>(
        winner === 'authorization'
          ? f.left.repository.sealVerified(s.selection, subject, s.observation)
          : f.left.repository.apply(s.selection, 2, s.authorize),
      );
      await pause.entered();
      if (winner === 'authorization')
        await f.right.repository.apply(s.selection, 2, s.authorize);
      else
        await f.right.repository.sealVerified(
          s.selection,
          subject,
          s.observation,
        );
      pause.release();
      expect(await pending).toHaveProperty('error');
      const attempt = (await f.right.repository.read(s.selection, s.attemptId))
        .record;
      if (winner === 'authorization') {
        expect(attempt).toHaveProperty('authorizationId', s.id(11));
        await remainsUnsealed(s);
      } else {
        expect(attempt).not.toHaveProperty('authorizationId');
        expect(
          (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
        ).toEqual(SEAL_REVISION);
        expect(await observations()).toHaveLength(1);
      }
    },
  );

  it.each(['ordinary', 'verified'] as const)(
    'serializes the ordinary seal when %s wins',
    async (winner) => {
      const s = await f.seedSeal(),
        subject = await f.left.repository.readForSeal(
          s.selection,
          s.input.effectId,
        ),
        before = await f.snapshot();
      const pause = f.left.gate.arm(
        winner === 'ordinary' ? 'UPLOAD_FENCE' : 'UPLOAD_SEAL',
      );
      const pending = f.observe(
        winner === 'ordinary'
          ? f.left.repository.sealVerified(s.selection, subject, s.observation)
          : f.left.uploadRepository.seal(
              s.upload.finalKey,
              s.upload.pinned!.sha256,
              SEAL_REVISION,
            ),
      );
      await pause.entered();
      if (winner === 'ordinary')
        await f.right.uploadRepository.seal(
          s.upload.finalKey,
          s.upload.pinned!.sha256,
          SEAL_REVISION,
        );
      else
        await f.right.repository.sealVerified(
          s.selection,
          subject,
          s.observation,
        );
      pause.release();
      const result = await pending;
      expect(
        (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
      ).toEqual(SEAL_REVISION);
      if (winner === 'ordinary') {
        expect(result).toHaveProperty('error');
        expect(await observations()).toHaveLength(0);
        const after = await f.snapshot();
        expect(after.journal).toEqual(before.journal);
        expect(after.control).toEqual(before.control);
      } else {
        expect(result).toEqual({ value: undefined });
        expect(await observations()).toHaveLength(1);
      }
    },
  );

  it.each(['revoke', 'settle', 'token'] as const)(
    '%s while GET response is paused prevents seal without claiming rollback of prior grants',
    async (mode) => {
      const s = await f.seedSeal(),
        verifier = f.verifier();
      f.transport.steps.push({ method: 'HEAD', respond: () => s.head() });
      const pause = f.transport.pause('GET', s.get());
      f.transport.steps.push({ method: 'HEAD', respond: () => s.head() });
      const pending = f.observe(verifier.verifyAndSeal(s.input));
      await pause.entered();
      if (mode === 'revoke') await revoke(s);
      else if (mode === 'settle')
        await f.right.journal.settleCallback(
          s.handle,
          'THREW',
          s.upload.createdAt,
        );
      else
        await f.right.controls.updateOne(
          { animalId: s.selection.animalId },
          { $pull: { activeWrites: { token: s.selection.operationId } } },
          { writeConcern: { w: 'majority' } },
        ); // Controlled fixture fault, not recovery.
      pause.release();
      expect(await pending).toMatchObject({
        error: { stage: 'SEAL', reason: 'CONFLICT' },
      });
      await remainsUnsealed(s);
      expect(
        (await f.right.repository.read(s.selection, s.attemptId)).record,
      ).toHaveProperty('authorizationId', s.id(11));
    },
  );

  it('lost application reply after recognized seal commit leaves BOTH known observation and ticket sealed', async () => {
    const s = await f.seedSeal(),
      verifier = f.verifier(),
      seal = f.left.repository.sealVerified.bind(f.left.repository);
    jest
      .spyOn(f.left.repository, 'sealVerified')
      .mockImplementation(async (...args) => {
        f.loseNextCommitReply(f.left);
        await seal(...args);
      });
    script(s);
    await expect(verifier.verifyAndSeal(s.input)).rejects.toMatchObject({
      stage: 'SEAL',
      reason: 'UNCERTAIN',
    });
    expect(f.transport.requests).toHaveLength(3);
    expect(
      (await f.right.uploadRepository.find(s.upload.finalKey))!.sealed,
    ).toEqual(SEAL_REVISION);
    expect(
      (await f.right.repository.read(s.selection, s.input.observationId))
        .record,
    ).toMatchObject({ kind: 'OBSERVATION', data: { finding: 'MATCH' } });
  });
  it('a verified seal denies a new retry permission without removing the earlier permission', async () => {
    const s = await f.seedSeal();
    script(s);
    await f.verifier().verifyAndSeal(s.input);
    await expect(
      f.right.repository.apply(s.selection, 4, {
        ...s.intention,
        attemptId: s.id(60),
        origin: 'SDK_RETRY',
        previousAttemptId: s.attemptId,
      }),
    ).rejects.toThrow();
    expect(
      (await f.right.repository.read(s.selection, s.attemptId)).record,
    ).toHaveProperty('authorizationId', s.id(11));
  });
  it('a previously revoked gate can seal current verified bytes under its still active linked claim', async () => {
    const s = await f.seedSeal();
    await revoke(s);
    script(s);
    await f.verifier().verifyAndSeal(s.input);
    expect(
      (await f.right.repository.read(s.selection)).gate!.data.gate.state,
    ).toBe('REVOKED');
    expect(await observations()).toHaveLength(1);
  });
  it('a preexisting final can be verified without inventing a dispatch attempt or causal acknowledgement', async () => {
    const s = await f.seedSeal('PROFILE_CONFIRM', false, false);
    script(s);
    await f.verifier().verifyAndSeal(s.input);
    expect(await f.right.records.countDocuments({ kind: 'ATTEMPT' })).toBe(0);
    expect(await f.right.records.countDocuments({ kind: 'RESPONSE' })).toBe(0);
    expect(await observations()).toHaveLength(1);
  });
});
