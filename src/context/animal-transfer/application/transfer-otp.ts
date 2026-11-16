import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import { ClientSession } from 'mongoose';
import { UserRepository } from '../../user/domain/userRepository';
import { UserCodeSender } from '../../user/application/sender/user-code-sender';
import { UserId } from '../../user/domain/userId';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import {
  TransferOtpPolicy,
  TransferOtpState,
  TransferOtpStore,
} from '../domain/transfer-otp';

export class TransferOtpThrottled extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      'Transfer verification is temporarily limited; wait before retrying',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
export type TransferOtpChallengeResponse = {
  challengeId: string;
  channel: 'EMAIL' | 'PHONE';
  maskedDestination: string;
  expiresAt: string;
  resendAvailableAt: string;
};
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const invalid = () =>
  new InvalidArgumentError(
    'Invalid, expired or unavailable transfer verification',
  );

@Injectable()
export class TransferOtp {
  private readonly policy: TransferOtpPolicy;
  constructor(
    @Inject('TransferOtpStore') private readonly store: TransferOtpStore,
    @Inject('UserRepository') private readonly users: UserRepository,
    private readonly sender: UserCodeSender,
    @Inject('TransferOtpHasher') private readonly hasher: IPasswordHasher,
    @Inject('TransferOtpPolicy') policy: TransferOtpPolicy,
    @Inject('TransferOtpClock') private readonly now: () => Date,
  ) {
    if (
      Object.values(policy).some((v) => !Number.isSafeInteger(v) || v < 1) ||
      Object.keys(policy).sort().join(',') !==
        'codeMinutes,maxAttempts,maxSends,proofMinutes,resendSeconds,windowMinutes'
    )
      throw new Error('Invalid transfer OTP configuration');
    this.policy = Object.freeze({ ...policy });
  }
  private async account(actorId: string) {
    if (!isUuid(actorId)) throw invalid();
    const user = await this.users.findById(new UserId(actorId));
    if (!user) throw new ResourceNotFoundError('Authenticated user not found');
    const channel = user.authMethod.value;
    const destination =
      channel === 'EMAIL'
        ? user.email?.value
        : channel === 'PHONE'
          ? user.cellPhone?.value
          : undefined;
    if (!destination || (channel !== 'EMAIL' && channel !== 'PHONE'))
      throw new ConflictError(
        'The account has no supported registration OTP channel',
      );
    return {
      user,
      channel,
      destination,
      contactHash: digest(`${channel}\0${destination}`),
    } as {
      user: typeof user;
      channel: 'EMAIL' | 'PHONE';
      destination: string;
      contactHash: string;
    };
  }
  async issue(
    actorId: string,
    previousChallengeId?: string,
  ): Promise<TransferOtpChallengeResponse> {
    if (previousChallengeId !== undefined && !isUuid(previousChallengeId))
      throw invalid();
    const account = await this.account(actorId);
    const current = await this.store.find(actorId),
      now = this.now();
    if (previousChallengeId && current?.challengeId !== previousChallengeId)
      throw invalid();
    if (current && current.resendAvailableAt > now)
      throw new TransferOtpThrottled(
        Math.ceil((current.resendAvailableAt.getTime() - now.getTime()) / 1000),
      );
    const inWindow =
      current &&
      current.sendWindowStartedAt.getTime() +
        this.policy.windowMinutes * 60000 >
        now.getTime();
    if (inWindow && current.sendCount >= this.policy.maxSends)
      throw new TransferOtpThrottled(
        Math.ceil(
          (current.sendWindowStartedAt.getTime() +
            this.policy.windowMinutes * 60000 -
            now.getTime()) /
            1000,
        ),
      );
    const code = String(randomInt(100000, 1000000));
    const state: TransferOtpState = {
      _id: actorId,
      challengeId: previousChallengeId ?? randomUUID(),
      revision: current ? current.revision + 1 : 0,
      purpose: 'ANIMAL_TRANSFER',
      channel: account.channel,
      contactHash: account.contactHash,
      status: 'DELIVERY_PENDING',
      codeHash: await this.hasher.hash(code),
      attempts: 0,
      codeExpiresAt: new Date(now.getTime() + this.policy.codeMinutes * 60000),
      resendAvailableAt: new Date(
        now.getTime() + this.policy.resendSeconds * 1000,
      ),
      sendWindowStartedAt: inWindow ? current.sendWindowStartedAt : now,
      sendCount: inWindow ? current.sendCount + 1 : 1,
    };
    if (!(await this.store.put(state, current?.revision)))
      throw new ConflictError(
        'Transfer verification changed; refresh before retrying',
      );
    // Persist first. A failed send does not activate; a lost activation reply may leave READY.
    try {
      await this.sender.run(account.user, code, {
        purpose: 'ANIMAL_TRANSFER',
        expiresInMinutes: this.policy.codeMinutes,
      });
    } catch {
      throw new ExternalServiceError(
        'Transfer verification delivery could not be confirmed',
      );
    }
    if (
      !(await this.store.activate(
        actorId,
        state.challengeId,
        state.revision,
        this.now(),
      ))
    )
      throw new ConflictError(
        'Transfer verification delivery is no longer current',
      );
    const maskedDestination =
      account.channel === 'PHONE'
        ? `***${account.destination.slice(-4)}`
        : `${account.destination[0]}***@${account.destination.split('@')[1]}`;
    return {
      challengeId: state.challengeId,
      channel: state.channel,
      maskedDestination,
      expiresAt: state.codeExpiresAt.toISOString(),
      resendAvailableAt: state.resendAvailableAt.toISOString(),
    };
  }
  async verify(actorId: string, challengeId: string, code: string) {
    if (
      !isUuid(challengeId) ||
      typeof code !== 'string' ||
      !/^\d{6}$/.test(code)
    )
      throw invalid();
    const account = await this.account(actorId),
      state = await this.store.find(actorId),
      now = this.now();
    if (
      !state ||
      state.challengeId !== challengeId ||
      state.status !== 'READY' ||
      state.purpose !== 'ANIMAL_TRANSFER' ||
      !state.codeHash ||
      state.codeExpiresAt <= now ||
      state.contactHash !== account.contactHash
    )
      throw invalid();
    if (state.attempts >= this.policy.maxAttempts)
      throw new TransferOtpThrottled(
        Math.max(
          1,
          Math.ceil((state.codeExpiresAt.getTime() - now.getTime()) / 1000),
        ),
      );
    // Reserve an attempt before the expensive comparison, including concurrent failures.
    const claimed = await this.store.claimAttempt(
      actorId,
      challengeId,
      state.revision,
      now,
      this.policy.maxAttempts,
    );
    if (!claimed)
      throw new ConflictError(
        'Transfer verification changed; retry explicitly',
      );
    if (!(await this.hasher.compare(code, claimed.codeHash!))) throw invalid();
    const proof = randomBytes(32).toString('base64url'),
      at = this.now();
    const expiresAt = new Date(at.getTime() + this.policy.proofMinutes * 60000);
    if (
      !(await this.store.authorize(
        actorId,
        challengeId,
        claimed.revision,
        at,
        this.proofHash(actorId, challengeId, proof),
        expiresAt,
      ))
    )
      throw new ConflictError('Transfer verification changed or expired');
    return {
      challengeId,
      purpose: 'ANIMAL_TRANSFER' as const,
      proof,
      expiresAt: expiresAt.toISOString(),
    };
  }
  /** Future request creation must consume this proof inside its own business transaction. */
  async consumeAuthorization(
    actorId: string,
    challengeId: string,
    proof: string,
    session: ClientSession,
  ): Promise<void> {
    if (
      !isUuid(actorId) ||
      !isUuid(challengeId) ||
      typeof proof !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(proof)
    )
      throw invalid();
    if (
      !(await this.store.consume(
        actorId,
        challengeId,
        this.proofHash(actorId, challengeId, proof),
        this.now(),
        session,
      ))
    )
      throw invalid();
  }
  private proofHash(actor: string, challenge: string, proof: string) {
    return digest(`ANIMAL_TRANSFER\0${actor}\0${challenge}\0${proof}`);
  }
}
