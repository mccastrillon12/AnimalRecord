import { createHash } from 'node:crypto';
import { TransferOtp } from '../../../src/context/animal-transfer/application/transfer-otp';
import {
  TransferOtpPolicy,
  TransferOtpState,
  TransferOtpStore,
} from '../../../src/context/animal-transfer/domain/transfer-otp';
import { User } from '../../../src/context/user/domain/user';
import { UserRepository } from '../../../src/context/user/domain/userRepository';
import { UserCodeSender } from '../../../src/context/user/application/sender/user-code-sender';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { VerificationCodeContext } from '../../../src/context/user/domain/ports/IEmailSender';

export const otpActor = '123e4567-e89b-42d3-a456-426614174001';
export const otpOther = '123e4567-e89b-42d3-a456-426614174002';
export function transferOtpFixture(method = 'EMAIL') {
  let time = new Date('2026-10-29T12:00:00Z');
  let row: TransferOtpState | null = null;
  const copy = <T>(value: T): T => structuredClone(value);
  const account = User.fromPrimitives({
    id: otpActor,
    name: 'Ana',
    identificationType: 'CC',
    identificationNumber: '123456',
    country: 'CO',
    email: 'ana@example.com',
    cellPhone: '+573001234567',
    authMethod: method,
    isVerified: true,
    isBiometricEnabled: false,
    verificationCode: 'existing-registration-hash',
    password: 'password-hash',
    refreshToken: 'refresh-hash',
  });
  const users = {
    findById: jest
      .fn<Promise<User | null>, [unknown]>()
      .mockResolvedValue(account),
    update: jest.fn(),
  };
  const email = {
    sendVerificationCode: jest
      .fn<Promise<void>, [string, string, VerificationCodeContext?]>()
      .mockResolvedValue(undefined),
    sendPasswordResetLink: jest.fn(),
    sendPinResetLink: jest.fn(),
  };
  const sms = {
    send: jest
      .fn<Promise<void>, [string, string]>()
      .mockResolvedValue(undefined),
  };
  const transport = new UserCodeSender(email, sms, {
    getAndroidAppHash: () => '',
  } as EnvironmentConfigService);
  const sender = {
    run: jest.fn<Promise<void>, [User, string, VerificationCodeContext?]>(
      transport.run.bind(transport),
    ),
  };
  const hash = (text: string) =>
    'test-hash:' + createHash('sha256').update(text).digest('hex');
  const hasher = {
    hash: jest.fn((text: string) => Promise.resolve(hash(text))),
    compare: jest.fn((text: string, stored: string) =>
      Promise.resolve(hash(text) === stored),
    ),
  };
  const policy: TransferOtpPolicy = {
    codeMinutes: 15,
    proofMinutes: 10,
    maxAttempts: 5,
    resendSeconds: 60,
    maxSends: 3,
    windowMinutes: 15,
  };
  const matches = (actor: string, challenge: string, revision: number) =>
    row?._id === actor &&
    row.challengeId === challenge &&
    row.revision === revision;
  const store = {
    find: jest.fn<
      ReturnType<TransferOtpStore['find']>,
      Parameters<TransferOtpStore['find']>
    >((actor) => Promise.resolve(row?._id === actor ? copy(row) : null)),
    put: jest.fn<
      ReturnType<TransferOtpStore['put']>,
      Parameters<TransferOtpStore['put']>
    >((state, revision) => {
      if (revision === undefined ? row !== null : row?.revision !== revision)
        return Promise.resolve(false);
      row = copy(state);
      return Promise.resolve(true);
    }),
    activate: jest.fn<
      ReturnType<TransferOtpStore['activate']>,
      Parameters<TransferOtpStore['activate']>
    >((actor, challenge, revision, now) => {
      if (
        !matches(actor, challenge, revision) ||
        row!.status !== 'DELIVERY_PENDING' ||
        row!.codeExpiresAt <= now
      )
        return Promise.resolve(false);
      row!.status = 'READY';
      row!.revision++;
      return Promise.resolve(true);
    }),
    claimAttempt: jest.fn<
      ReturnType<TransferOtpStore['claimAttempt']>,
      Parameters<TransferOtpStore['claimAttempt']>
    >((actor, challenge, revision, now, limit) => {
      if (
        !matches(actor, challenge, revision) ||
        row!.status !== 'READY' ||
        row!.codeExpiresAt <= now ||
        row!.attempts >= limit
      )
        return Promise.resolve(null);
      row!.attempts++;
      row!.revision++;
      return Promise.resolve(copy(row));
    }),
    authorize: jest.fn<
      ReturnType<TransferOtpStore['authorize']>,
      Parameters<TransferOtpStore['authorize']>
    >((actor, challenge, revision, now, proofHash, expires) => {
      if (
        !matches(actor, challenge, revision) ||
        row!.status !== 'READY' ||
        row!.codeExpiresAt <= now
      )
        return Promise.resolve(false);
      row!.status = 'VERIFIED';
      row!.proofHash = proofHash;
      row!.proofExpiresAt = expires;
      row!.revision++;
      delete row!.codeHash;
      return Promise.resolve(true);
    }),
    consume: jest.fn<
      ReturnType<TransferOtpStore['consume']>,
      Parameters<TransferOtpStore['consume']>
    >((actor, challenge, proofHash, now, session) => {
      if (!session.inTransaction())
        return Promise.reject(new Error('Business transaction required'));
      if (
        row?._id !== actor ||
        row.challengeId !== challenge ||
        row.status !== 'VERIFIED' ||
        row.proofHash !== proofHash ||
        row.proofExpiresAt! <= now
      )
        return Promise.resolve(false);
      row.status = 'CONSUMED';
      delete row.proofHash;
      delete row.proofExpiresAt;
      row.revision++;
      return Promise.resolve(true);
    }),
  } satisfies TransferOtpStore;
  const service = new TransferOtp(
    store,
    users as unknown as UserRepository,
    sender as unknown as UserCodeSender,
    hasher,
    policy,
    () => new Date(time),
  );
  return {
    account,
    users,
    sender,
    email,
    sms,
    hasher,
    policy,
    store,
    service,
    state: () => copy(row),
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
    code: () => sender.run.mock.calls.at(-1)![1],
  };
}
