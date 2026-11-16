import { ClientSession } from 'mongoose';
import {
  transferOtpFixture,
  otpActor,
  otpOther,
} from '../fixtures/transfer-otp.fixture';
import { UserEmail } from '../../../src/context/user/domain/userEmail';
import { deferred, bounded } from '../integration/support/write-race-gate';

describe('Transfer OTP application with an atomic simulated store, no delivery or Mongo', () => {
  it.each(['EMAIL', 'PHONE'])(
    'issues a %s challenge and proves intent without touching registration/login',
    async (method) => {
      const f = transferOtpFixture(method),
        before = f.account.toPrimitives();
      const challenge = await f.service.issue(otpActor);
      expect(challenge.channel).toBe(method);
      expect(f.code()).toMatch(/^\d{6}$/);
      expect(JSON.stringify(challenge)).not.toContain(f.code());
      expect(f.state()!.codeHash).not.toBe(f.code());
      const authorization = await f.service.verify(
        otpActor,
        challenge.challengeId,
        f.code(),
      );
      expect(authorization.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(authorization.purpose).toBe('ANIMAL_TRANSFER');
      expect(f.state()!.proofHash).not.toBe(authorization.proof);
      expect(f.state()!.codeHash).toBeUndefined();
      expect(f.account.toPrimitives()).toEqual(before);
      expect(f.users.update).not.toHaveBeenCalled();
      await expect(
        f.service.verify(otpActor, challenge.challengeId, f.code()),
      ).rejects.toThrow('unavailable');
    },
  );
  it('only sends once when challenge creation races', async () => {
    const f = transferOtpFixture();
    const results = await Promise.allSettled([
      f.service.issue(otpActor),
      f.service.issue(otpActor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.sender.run).toHaveBeenCalledTimes(1);
  });
  it('reserves verification attempts and creates at most one proof under concurrent verification', async () => {
    const f = transferOtpFixture(),
      c = await f.service.issue(otpActor);
    const results = await Promise.allSettled([
      f.service.verify(otpActor, c.challengeId, f.code()),
      f.service.verify(otpActor, c.challengeId, f.code()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.hasher.compare).toHaveBeenCalledTimes(1);
  });
  it('invalidates the old code on resend and enforces cooldown plus the per-user send budget', async () => {
    const f = transferOtpFixture(),
      c = await f.service.issue(otpActor),
      oldCode = f.code();
    await expect(
      f.service.issue(otpActor, c.challengeId),
    ).rejects.toMatchObject({ retryAfterSeconds: 60 });
    f.advance(60000);
    await f.service.issue(otpActor, c.challengeId);
    if (oldCode !== f.code())
      await expect(
        f.service.verify(otpActor, c.challengeId, oldCode),
      ).rejects.toThrow('Invalid');
    f.advance(60000);
    await f.service.issue(otpActor);
    f.advance(60000);
    await expect(f.service.issue(otpActor)).rejects.toMatchObject({
      retryAfterSeconds: 720,
    });
    expect(f.sender.run).toHaveBeenCalledTimes(3);
  });
  it('expires codes and proofs on their own server-side deadlines', async () => {
    const f = transferOtpFixture(),
      c = await f.service.issue(otpActor);
    f.advance(15 * 60000);
    await expect(
      f.service.verify(otpActor, c.challengeId, f.code()),
    ).rejects.toThrow('expired');
    const next = await f.service.issue(otpActor),
      proof = await f.service.verify(otpActor, next.challengeId, f.code());
    f.advance(10 * 60000);
    await expect(
      f.service.consumeAuthorization(otpActor, next.challengeId, proof.proof, {
        inTransaction: () => true,
      } as ClientSession),
    ).rejects.toThrow('expired');
  });
  it('counts bad attempts before comparison and stops at the configured limit', async () => {
    const f = transferOtpFixture(),
      c = await f.service.issue(otpActor);
    const wrong = f.code() === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await expect(
        f.service.verify(otpActor, c.challengeId, wrong),
      ).rejects.toThrow('Invalid');
    await expect(
      f.service.verify(otpActor, c.challengeId, f.code()),
    ).rejects.toMatchObject({ retryAfterSeconds: 900 });
    expect(f.hasher.compare).toHaveBeenCalledTimes(5);
  });
  it('leaves a possibly delivered code unusable after an uncertain send, without automatic replay', async () => {
    const f = transferOtpFixture();
    f.sender.run.mockRejectedValueOnce(
      new Error('secret code/provider failure'),
    );
    await expect(f.service.issue(otpActor)).rejects.toThrow(
      'delivery could not be confirmed',
    );
    expect(f.state()!.status).toBe('DELIVERY_PENDING');
    expect(f.store.activate).not.toHaveBeenCalled();
    await expect(
      f.service.verify(otpActor, f.state()!.challengeId, f.code()),
    ).rejects.toThrow('unavailable');
    expect(f.sender.run).toHaveBeenCalledTimes(1);
  });
  it('does not send after uncertain persistence and does not activate after an expired delivery', async () => {
    const f = transferOtpFixture();
    f.store.put.mockRejectedValueOnce(new Error('uncertain write'));
    await expect(f.service.issue(otpActor)).rejects.toThrow('uncertain');
    expect(f.sender.run).not.toHaveBeenCalled();
    f.sender.run.mockImplementationOnce(() => {
      f.advance(16 * 60000);
      return Promise.resolve();
    });
    await expect(f.service.issue(otpActor)).rejects.toThrow(
      'no longer current',
    );
    expect(f.state()!.status).toBe('DELIVERY_PENDING');
  });
  it('a concurrent resend prevents a previously correct verification from issuing a proof', async () => {
    const f = transferOtpFixture(),
      c = await f.service.issue(otpActor),
      entered = deferred(),
      release = deferred();
    f.hasher.compare.mockImplementationOnce(async () => {
      entered.resolve();
      await bounded(release.promise, 'OTP comparison');
      return true;
    });
    const pending = f.service.verify(otpActor, c.challengeId, f.code());
    await bounded(entered.promise, 'OTP attempt');
    try {
      f.advance(60000);
      await f.service.issue(otpActor, c.challengeId);
    } finally {
      release.resolve();
    }
    await expect(pending).rejects.toThrow('changed');
    expect(f.state()!.proofHash).toBeUndefined();
  });
  it('rejects another actor or a changed registered contact without consuming attempts', async () => {
    const f = transferOtpFixture(),
      c = await f.service.issue(otpActor);
    await expect(
      f.service.verify(otpOther, c.challengeId, f.code()),
    ).rejects.toThrow('unavailable');
    f.account.email = new UserEmail('new@example.com');
    await expect(
      f.service.verify(otpActor, c.challengeId, f.code()),
    ).rejects.toThrow('unavailable');
    expect(f.store.claimAttempt).not.toHaveBeenCalled();
  });
  it.each(['GOOGLE', 'APPLE', 'MICROSOFT'])(
    'rejects %s rather than pretending registration sent an OTP',
    async (method) => {
      const f = transferOtpFixture(method);
      await expect(f.service.issue(otpActor)).rejects.toThrow('supported');
      expect(f.sender.run).not.toHaveBeenCalled();
      expect(f.store.put).not.toHaveBeenCalled();
    },
  );
  it.each(['EMAIL', 'PHONE'])(
    'does not fall back or claim delivery for %s without its registered contact',
    async (method) => {
      const f = transferOtpFixture(method);
      if (method === 'EMAIL') f.account.email = undefined;
      else f.account.cellPhone = undefined;
      await expect(f.service.issue(otpActor)).rejects.toThrow('supported');
      expect(f.sender.run).not.toHaveBeenCalled();
      expect(f.store.put).not.toHaveBeenCalled();
    },
  );
  it('a lost activation acknowledgement does not prove rollback or trigger another send', async () => {
    const f = transferOtpFixture(),
      c = await f.service.issue(otpActor);
    f.advance(60000);
    const activate = f.store.activate.getMockImplementation()!;
    f.store.activate.mockImplementationOnce(async (...args) => {
      await activate(...args);
      throw new Error('activation acknowledgement lost');
    });
    await expect(f.service.issue(otpActor, c.challengeId)).rejects.toThrow(
      'acknowledgement',
    );
    expect(f.state()!.status).toBe('READY');
    expect(f.sender.run).toHaveBeenCalledTimes(2);
    const proof = await f.service.verify(otpActor, c.challengeId, f.code());
    expect(proof.purpose).toBe('ANIMAL_TRANSFER');
  });
  it('consumes a proof once, bound to actor/challenge and supplied business transaction', async () => {
    const f = transferOtpFixture(),
      c = await f.service.issue(otpActor),
      p = await f.service.verify(otpActor, c.challengeId, f.code());
    const session = { inTransaction: () => true } as ClientSession;
    await expect(
      f.service.consumeAuthorization(otpOther, c.challengeId, p.proof, session),
    ).rejects.toThrow('Invalid');
    await expect(
      f.service.consumeAuthorization(otpActor, otpOther, p.proof, session),
    ).rejects.toThrow('Invalid');
    await f.service.consumeAuthorization(
      otpActor,
      c.challengeId,
      p.proof,
      session,
    );
    expect(f.store.consume.mock.calls.at(-1)!.at(-1)).toBe(session);
    await expect(
      f.service.consumeAuthorization(otpActor, c.challengeId, p.proof, session),
    ).rejects.toThrow('Invalid');
  });
});
