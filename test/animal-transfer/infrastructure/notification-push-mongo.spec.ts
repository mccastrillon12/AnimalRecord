import { MODULE_METADATA } from '@nestjs/common/constants';
import { NotificationModule } from '../../../src/app/notification/notification.module';
import { NotificationPushPersistenceModule } from '../../../src/app/notification/notification-push-persistence.module';
import {
  PushAttemptSchema,
  PushDeliverySchema,
} from '../../../src/context/notification/infrastructure/notification-push.schema';
import { NotificationDeviceSchema } from '../../../src/context/notification/infrastructure/mongo-notification-devices';
import { TransferOutboxSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import { pushFixture } from '../fixtures/notification-push.fixture';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';

describe('push Mongo adapter contract (no database connection)', () => {
  it.each(['collections', 'topology', 'binding'] as const)(
    'fails closed before transactions when %s is unprepared',
    async (kind) => {
      const f = pushFixture();
      if (kind === 'collections') f.flags.missing = true;
      if (kind === 'topology') f.flags.standalone = true;
      if (kind === 'binding')
        Object.defineProperty(f.models[3], 'db', { value: {} });
      await expect(f.processor.work()).rejects.toMatchObject({ status: 503 });
      expect(f.connection.startSession).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it('uses one session and majority commit for fences, attempts, deliveries and responses', async () => {
    const f = pushFixture();
    await f.processor.work();
    for (const call of f.calls.filter((c) => c.action === 'transaction'))
      expect(call.filter).toMatchObject({
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
        maxCommitTimeMS: 5000,
        timeoutMS: 15000,
      });
    const writes = f.calls.filter((c) =>
      ['insert', 'updateOne', 'deleteOne'].includes(c.action),
    );
    for (const call of writes)
      expect(call.options).toMatchObject({ session: f.session });
    expect(
      writes.find((c) => c.table === 'notification_devices')?.update,
    ).toEqual({ $inc: { pushRevision: 1 } });
    expect(f.session.endSession).toHaveBeenCalledTimes(3);
    expect(
      JSON.stringify([...f.tables.notification_push_attempts.values()]),
    ).not.toMatch(/token|Private|keyHash/);
    expect(
      JSON.stringify([...f.tables.notification_push_deliveries.values()]),
    ).not.toMatch(/synthetic-token|Private|keyHash/);
  });
  it.each([
    'missing-claim',
    'bad-hash',
    'missing-notice',
    'wrong-owner',
    'bad-fence-counter',
  ] as const)('denies permission for %s', async (kind) => {
    const f = pushFixture();
    const {
      deliveryIds: [delivery],
    } = await f.processor.expand(id(1));
    if (kind === 'missing-claim') f.tables.notification_device_tokens.clear();
    if (kind === 'bad-hash')
      f.tables.notification_devices.get(id(10))!.token = 'modified-token';
    if (kind === 'missing-notice') f.tables.notifications.clear();
    if (kind === 'wrong-owner')
      f.tables.notification_push_deliveries.get(delivery)!.userId = id(500);
    if (kind === 'bad-fence-counter')
      f.tables.notification_devices.get(id(10))!.pushRevision =
        Number.MAX_SAFE_INTEGER;
    await expect(f.processor.run(delivery)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.tables.notification_push_attempts.size).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['fence', 'attempt'] as const)(
    'does not send when %s cannot be persisted; simulated transaction rolls back',
    async (kind) => {
      const f = pushFixture();
      const {
        deliveryIds: [delivery],
      } = await f.processor.expand(id(1));
      if (kind === 'fence') f.flags.fenceMiss = true;
      else f.flags.failAttempt = true;
      await expect(f.processor.run(delivery)).rejects.toThrow();
      expect(f.tables.notification_push_attempts.size).toBe(0);
      expect(f.tables.notification_push_deliveries.get(delivery)?.state).toBe(
        'READY',
      );
      expect(
        f.tables.notification_devices.get(id(10))?.pushRevision,
      ).toBeUndefined();
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it('requires the prior persisted retryable rejection as well as READY before another permission', async () => {
    const f = pushFixture();
    f.send.mockResolvedValue('RETRYABLE_REJECTION');
    await f.processor.work();
    f.tables.notification_push_attempts.clear();
    f.advance();
    await expect(f.processor.work()).rejects.toMatchObject({ status: 503 });
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('does not infer invalidation success if its token claim cannot be removed', async () => {
    const f = pushFixture();
    f.send.mockImplementation(() => {
      f.tables.notification_device_tokens.clear();
      return Promise.resolve('INVALID_TOKEN');
    });
    await expect(f.processor.work()).rejects.toThrow('inconsistent');
    expect(f.tables.notification_devices.get(id(10))?.state).toBe('ACTIVE');
    expect([...f.tables.notification_push_attempts.values()][0].state).toBe(
      'MAY_SEND',
    );
  });
  it('declares ordinary collections and indexes without TTL, automatic creation or retrospective protocol default', () => {
    for (const schema of [
      PushAttemptSchema,
      PushDeliverySchema,
      TransferOutboxSchema,
    ]) {
      expect(schema.get('autoCreate')).toBe(false);
      expect(schema.get('autoIndex')).toBe(false);
      expect(
        schema.indexes().some(([, o]) => o.expireAfterSeconds !== undefined),
      ).toBe(false);
    }
    expect(PushAttemptSchema.indexes()).toContainEqual([
      { deliveryId: 1, ordinal: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(
      TransferOutboxSchema.path('pushProtocol').options.default,
    ).toBeUndefined();
    expect(
      NotificationDeviceSchema.path('pushRevision').options.default,
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, NotificationModule),
    ).not.toContain(NotificationPushPersistenceModule);
  });
});
