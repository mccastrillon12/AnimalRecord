import { ClientSession } from 'mongoose';

export type TransferOtpPolicy = Readonly<{
  codeMinutes: number;
  proofMinutes: number;
  maxAttempts: number;
  resendSeconds: number;
  maxSends: number;
  windowMinutes: number;
}>;
export type TransferOtpState = {
  _id: string; // One active challenge/rate budget per authenticated user.
  challengeId: string;
  revision: number;
  purpose: 'ANIMAL_TRANSFER';
  channel: 'EMAIL' | 'PHONE';
  contactHash: string;
  status: 'DELIVERY_PENDING' | 'READY' | 'VERIFIED' | 'CONSUMED';
  codeHash?: string;
  codeExpiresAt: Date;
  resendAvailableAt: Date;
  attempts: number;
  sendWindowStartedAt: Date;
  sendCount: number;
  proofHash?: string;
  proofExpiresAt?: Date;
};
export interface TransferOtpStore {
  find(actorId: string): Promise<TransferOtpState | null>;
  put(
    state: TransferOtpState,
    expectedRevision: number | undefined,
  ): Promise<boolean>;
  activate(
    actorId: string,
    challengeId: string,
    revision: number,
    now: Date,
  ): Promise<boolean>;
  claimAttempt(
    actorId: string,
    challengeId: string,
    revision: number,
    now: Date,
    limit: number,
  ): Promise<TransferOtpState | null>;
  authorize(
    actorId: string,
    challengeId: string,
    revision: number,
    now: Date,
    hash: string,
    expiresAt: Date,
  ): Promise<boolean>;
  consume(
    actorId: string,
    challengeId: string,
    hash: string,
    now: Date,
    session: ClientSession,
  ): Promise<boolean>;
}
