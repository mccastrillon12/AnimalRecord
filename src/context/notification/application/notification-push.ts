import { randomUUID } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  NotificationPushProvider,
  NotificationPushStore,
  PushOutcome,
  PushRetryPolicy,
} from '../domain/notification-push';

// Explicit construction only: no scheduler, module provider or default transport.
export class NotificationPushProcessor {
  private readonly policy: Readonly<PushRetryPolicy>;
  constructor(
    private readonly store: NotificationPushStore,
    private readonly provider: NotificationPushProvider,
    policy: PushRetryPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (
      !Number.isSafeInteger(policy.maxAttempts) ||
      policy.maxAttempts < 1 ||
      policy.maxAttempts > 100 ||
      !Number.isSafeInteger(policy.delayMs) ||
      policy.delayMs < 1000 ||
      policy.delayMs > 86400000
    )
      throw new InvalidArgumentError('Invalid push retry policy');
    this.policy = Object.freeze({ ...policy });
  }
  expand(outboxId: string, pageSize = 20) {
    if (
      !isUuid(outboxId) ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 50
    )
      throw new InvalidArgumentError('Invalid push expansion input');
    return this.store.expand(outboxId, pageSize);
  }
  async work(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new InvalidArgumentError('Invalid push work limit');
    for (const id of await this.store.pending(limit))
      await this.expand(id, limit);
    const results: Array<'NOT_GRANTED' | PushOutcome> = [];
    for (const id of await this.store.ready(limit, this.clock().toISOString()))
      results.push(await this.run(id));
    return results;
  }
  async run(deliveryId: string): Promise<'NOT_GRANTED' | PushOutcome> {
    if (!isUuid(deliveryId))
      throw new InvalidArgumentError('Invalid push delivery ID');
    const grant = await this.store.grant(
      deliveryId,
      randomUUID(),
      this.clock().toISOString(),
    );
    if (!grant) return 'NOT_GRANTED';
    let outcome: PushOutcome = 'UNKNOWN';
    try {
      const result: unknown = await this.provider.send(
        Object.freeze({
          attemptId: grant.attemptId,
          token: grant.token,
          data: Object.freeze({ ...grant.data }),
        }),
      );
      if (
        result === 'ACCEPTED' ||
        result === 'INVALID_TOKEN' ||
        result === 'RETRYABLE_REJECTION' ||
        result === 'PERMANENT_REJECTION'
      )
        outcome = result;
    } catch {
      // Do not persist raw provider errors/tokens, or infer remote non-execution.
    }
    await this.store.finish(
      grant,
      outcome,
      this.clock().toISOString(),
      this.policy,
    );
    return outcome;
  }
}
