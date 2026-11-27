import { randomUUID } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  NotificationPushProvider,
  NotificationPushStore,
  PushOutcome,
  PushRetryPolicy,
} from '../domain/notification-push';

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
  async work(
    limit = 20,
    options?: { onFailure: () => void; stopped: () => boolean },
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new InvalidArgumentError('Invalid push work limit');
    for (const id of await this.store.pending(limit)) {
      if (options?.stopped()) return [];
      try {
        await this.expand(id, limit);
      } catch (error) {
        if (!options) throw error;
        options.onFailure();
      }
    }
    const results: Array<'NOT_GRANTED' | PushOutcome> = [];
    if (options?.stopped()) return results;
    for (const id of await this.store.ready(
      limit,
      this.clock().toISOString(),
    )) {
      if (options?.stopped()) break;
      try {
        results.push(await this.run(id));
      } catch (error) {
        if (!options) throw error;
        options.onFailure();
      }
    }
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
    let policy = this.policy;
    try {
      const result: unknown = await this.provider.send(
        Object.freeze({
          attemptId: grant.attemptId,
          token: grant.token,
          animalCount: grant.animalCount,
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
      else if (
        result &&
        typeof result === 'object' &&
        'outcome' in result &&
        result.outcome === 'RETRYABLE_REJECTION' &&
        'retryAfterMs' in result &&
        typeof result.retryAfterMs === 'number' &&
        Number.isSafeInteger(result.retryAfterMs) &&
        result.retryAfterMs >= 0 &&
        result.retryAfterMs <= 366 * 86_400_000
      ) {
        outcome = result.outcome;
        policy = {
          ...this.policy,
          delayMs: Math.max(
            result.retryAfterMs,
            Math.min(
              86_400_000,
              this.policy.delayMs * 2 ** (grant.ordinal - 1),
            ),
          ),
        };
      }
    } catch {
      // Do not persist raw provider errors/tokens, or infer remote non-execution.
    }
    await this.store.finish(grant, outcome, this.clock().toISOString(), policy);
    return outcome;
  }
}
