export const PUSH_PROTOCOL = 'DEVICE_REVISION_V1' as const;
export type PushOutbox = {
  _id: string;
  notificationId: string;
  userId: string;
  transferId: string;
  status: 'PENDING' | 'EXPANDING' | 'EXPANDED';
  createdAt: string;
  attempts: number; // Legacy field; physical attempts live in separate rows.
  pushProtocol?: typeof PUSH_PROTOCOL;
  cursor?: string;
  revision?: number;
};
export type PushOutcome =
  | 'ACCEPTED'
  | 'INVALID_TOKEN'
  | 'RETRYABLE_REJECTION'
  | 'PERMANENT_REJECTION'
  | 'UNKNOWN';
export type PushDelivery = {
  _id: string;
  outboxId: string;
  notificationId: string;
  transferId: string;
  userId: string;
  installationId: string;
  deviceRevision: number;
  tokenHash: string;
  state: 'READY' | 'MAY_SEND' | 'SKIPPED' | 'RECORDED';
  attempts: number;
  nextAttemptAt: string;
  attemptId?: string;
  outcome?: PushOutcome;
};
export type PushAttempt = {
  _id: string;
  deliveryId: string;
  ordinal: number;
  state: 'MAY_SEND' | 'RESPONDED';
  grantedAt: string;
  respondedAt?: string;
  outcome?: PushOutcome;
};
// Ephemeral return from a NEW, acknowledged permission transaction. Never stored
// with the raw token and never reconstructed from an existing attempt.
export type PushGrant = {
  deliveryId: string;
  attemptId: string;
  ordinal: number;
  token: string;
  data: Readonly<{
    notificationId: string;
    transferId: string;
    recipientId: string;
  }>;
};
export type PushRetryPolicy = { maxAttempts: number; delayMs: number };
export interface NotificationPushStore {
  pending(limit: number): Promise<string[]>;
  ready(limit: number, at: string): Promise<string[]>;
  expand(
    outboxId: string,
    pageSize: number,
  ): Promise<{
    deliveryIds: string[];
    done: boolean;
  }>;
  grant(
    deliveryId: string,
    attemptId: string,
    at: string,
  ): Promise<PushGrant | null>;
  finish(
    grant: PushGrant,
    outcome: PushOutcome,
    at: string,
    policy: PushRetryPolicy,
  ): Promise<void>;
}
export interface NotificationPushProvider {
  // One physical send only. No hidden SDK/transport retries. An adapter must
  // substantiate explicit rejections; timeout/exception is always UNKNOWN.
  send(
    input: Readonly<{
      attemptId: string;
      token: string;
      data: PushGrant['data'];
    }>,
  ): Promise<PushOutcome>;
}
