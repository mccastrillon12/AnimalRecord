import { ClientSession } from 'mongoose';
import * as nodemailer from 'nodemailer';
import {
  MongoTransferOtp,
  TransferOtpSchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-otp';
import { transferOtpFixture, otpActor } from '../fixtures/transfer-otp.fixture';
import { NodemailerEmailSender } from '../../../src/context/user/infrastructure/email/nodemailer-email-sender';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';

describe('Transfer OTP adapter contracts without Mongo/SMTP/SNS', () => {
  afterEach(() => jest.restoreAllMocks());
  function repository() {
    const client = {};
    const exec = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const updateOne = jest.fn().mockReturnValue({ exec });
    const create = jest.fn().mockResolvedValue([]);
    const claimed = jest.fn().mockResolvedValue(null);
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValue({ lean: () => ({ exec: claimed }) });
    const model = {
      db: { getClient: () => client },
      updateOne,
      create,
      findOneAndUpdate,
    };
    return {
      repo: new MongoTransferOtp(model as never),
      client,
      exec,
      updateOne,
      create,
      findOneAndUpdate,
    };
  }
  it.each(['inactive', 'other-client'])(
    'rejects a proof consumption with %s transaction before writing',
    async (mode) => {
      const f = repository(),
        session = {
          inTransaction: () => mode !== 'inactive',
          client: mode === 'other-client' ? {} : f.client,
        } as unknown as ClientSession;
      await expect(
        f.repo.consume(otpActor, otpActor, 'hash', new Date(), session),
      ).rejects.toThrow('same client');
      expect(f.updateOne).not.toHaveBeenCalled();
    },
  );
  it('consumes only the actor/purpose/unexpired proof in the supplied business transaction, with server-time expiry', async () => {
    const f = repository(),
      now = new Date(),
      session = {
        inTransaction: () => true,
        client: f.client,
      } as unknown as ClientSession;
    expect(
      await f.repo.consume(otpActor, 'challenge', 'hash', now, session),
    ).toBe(true);
    expect(f.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: otpActor,
        challengeId: 'challenge',
        purpose: 'ANIMAL_TRANSFER',
        status: 'VERIFIED',
        proofHash: 'hash',
        proofExpiresAt: { $gt: now },
        $expr: { $gt: ['$proofExpiresAt', '$$NOW'] },
      }),
      expect.objectContaining({
        $set: { status: 'CONSUMED' },
        $unset: { proofHash: 1, proofExpiresAt: 1 },
      }),
      { session },
    );
    f.exec.mockResolvedValueOnce({ matchedCount: 0 });
    expect(
      await f.repo.consume(otpActor, 'challenge', 'hash', now, session),
    ).toBe(false);
  });
  it('reserves a bounded attempt with majority before checking the code and preserves the returned revision', async () => {
    const f = repository(),
      now = new Date();
    await f.repo.claimAttempt(otpActor, 'challenge', 3, now, 5);
    expect(f.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: otpActor,
        challengeId: 'challenge',
        revision: 3,
        purpose: 'ANIMAL_TRANSFER',
        status: 'READY',
        attempts: { $lt: 5 },
        $expr: { $gt: ['$codeExpiresAt', '$$NOW'] },
      }),
      { $inc: { attempts: 1, revision: 1 } },
      { writeConcern: { w: 'majority' }, new: true },
    );
  });
  it('treats a duplicate actor insertion as contention, never as permission to overwrite or send again', async () => {
    const f = repository(),
      data = transferOtpFixture();
    await data.service.issue(otpActor);
    f.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: 11000 }),
    );
    expect(await f.repo.put(data.state()!, undefined)).toBe(false);
    expect(f.updateOne).not.toHaveBeenCalled();
    f.create.mockRejectedValueOnce(new Error('uncertain acknowledgement'));
    await expect(f.repo.put(data.state()!, undefined)).rejects.toThrow(
      'uncertain',
    );
    expect(f.create).toHaveBeenCalledTimes(2);
  });
  it('replaces a challenge by revision and removes the previous authorization without installing indexes or TTL', async () => {
    const f = repository(),
      data = transferOtpFixture();
    await data.service.issue(otpActor);
    await f.repo.put(data.state()!, 4);
    expect(f.updateOne).toHaveBeenCalledWith(
      { _id: otpActor, revision: 4 },
      expect.objectContaining({ $unset: { proofHash: 1, proofExpiresAt: 1 } }),
      { writeConcern: { w: 'majority' } },
    );
    expect(TransferOtpSchema.get('autoCreate')).toBe(false);
    expect(TransferOtpSchema.get('autoIndex')).toBe(false);
    expect(TransferOtpSchema.indexes()).toEqual([]);
  });
  it('reuses SMTP with explicit transfer intent/expiry and preserves the old registration message', async () => {
    const sendMail = jest
      .fn<Promise<void>, [Record<string, unknown>]>()
      .mockResolvedValue(undefined);
    jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as never);
    const sender = new NodemailerEmailSender({} as EnvironmentConfigService);
    await sender.sendVerificationCode('ana@example.com', '12345');
    await sender.sendVerificationCode('ana@example.com', '654321', {
      purpose: 'ANIMAL_TRANSFER',
      expiresInMinutes: 3,
    });
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      subject: 'Verify your email - Animal Record',
      text: expect.stringContaining('15 minutes') as unknown,
    });
    expect(sendMail.mock.calls[1][0]).toMatchObject({
      to: 'ana@example.com',
      subject: expect.stringContaining('transferencia') as unknown,
      text: expect.stringContaining('3 minutos') as unknown,
    });
  });
});
