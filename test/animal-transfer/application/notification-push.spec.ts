import { NotificationPushProcessor } from '../../../src/context/notification/application/notification-push';
import { PushOutcome } from '../../../src/context/notification/domain/notification-push';
import { pushFixture } from '../fixtures/notification-push.fixture';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';
import { otpActor } from '../fixtures/transfer-otp.fixture';
import { notificationDeviceFixture } from '../fixtures/notification-device.fixture';
import { DeviceRecord } from '../../../src/context/notification/domain/notification-device';

// Real processor/repository, simulated storage and provider. These tests do NOT
// establish Mongo concurrency, rollback, network ambiguity or FCM guarantees.
describe('notification push processing with simulated persistence/transport', () => {
  it('recognizes the new reject-all event without enabling a real provider', async () => {
    const f = pushFixture();
    f.tables.notifications.get(id(2))!.type = 'TRANSFER_REQUEST_REJECTED';
    expect(await f.processor.work()).toEqual(['ACCEPTED']);
  });
  it('fans out once per installation with pagination and excludes other accounts', async () => {
    const f = pushFixture();
    f.seedDevice(20);
    f.seedDevice(30);
    f.seedDevice(40, id(500));
    const first = await f.processor.expand(id(1), 2);
    expect(first.done).toBe(false);
    expect(first.deliveryIds).toHaveLength(2);
    const second = await f.processor.expand(id(1), 2);
    expect(second.done).toBe(true);
    expect(second.deliveryIds).toHaveLength(1);
    expect(await f.processor.expand(id(1))).toEqual({
      deliveryIds: [],
      done: true,
    });
    expect(f.tables.notification_push_deliveries.size).toBe(3);
    expect(f.send).not.toHaveBeenCalled();
  });
  it('retains an inbox notification when there are no devices and does not backfill later registrations', async () => {
    const f = pushFixture();
    f.tables.notification_devices.clear();
    expect(await f.processor.work()).toEqual([]);
    f.seedDevice();
    expect(await f.processor.work()).toEqual([]);
    expect(f.tables.notifications.size).toBe(1);
    expect(f.tables.notification_outbox.get(id(1))?.status).toBe('EXPANDED');
  });
  it('does not adopt an unmarked legacy outbox or retrofit its protocol', async () => {
    const f = pushFixture();
    delete f.tables.notification_outbox.get(id(1))!.pushProtocol;
    expect(await f.processor.work()).toEqual([]);
    await expect(f.processor.expand(id(1))).rejects.toMatchObject({
      status: 503,
    });
    expect(f.tables.notification_push_deliveries.size).toBe(0);
    expect(
      f.tables.notification_outbox.get(id(1))?.pushProtocol,
    ).toBeUndefined();
  });
  it('sends only IDs after a fresh persisted permission and preserves the inbox', async () => {
    const f = pushFixture();
    f.send.mockImplementation(() => {
      expect([...f.tables.notification_push_attempts.values()][0].state).toBe(
        'MAY_SEND',
      );
      expect([...f.tables.notification_push_deliveries.values()][0].state).toBe(
        'MAY_SEND',
      );
      return Promise.resolve('ACCEPTED');
    });
    expect(await f.processor.work()).toEqual(['ACCEPTED']);
    expect(f.send).toHaveBeenCalledWith({
      attemptId: expect.any(String) as unknown,
      token: 'synthetic-token-10',
      data: { notificationId: id(2), transferId: id(3), recipientId: otpActor },
    });
    expect(JSON.stringify(f.send.mock.calls)).not.toMatch(
      /Private|itemIds|title|text|keyHash|tokenHash/,
    );
    expect([...f.tables.notification_push_attempts.values()][0]).toMatchObject({
      state: 'RESPONDED',
      outcome: 'ACCEPTED',
    });
    expect([...f.tables.notification_push_deliveries.values()][0].state).toBe(
      'RECORDED',
    );
    expect(f.tables.notifications.get(id(2))?.readAt).toBeUndefined();
    expect(await f.processor.work()).toEqual([]);
  });
  it('recovers undispatched READY work after a simulated lost expansion acknowledgement', async () => {
    const f = pushFixture();
    f.flags.lostCommit = true;
    await expect(f.processor.expand(id(1))).rejects.toMatchObject({
      status: 503,
    });
    expect(f.tables.notification_push_deliveries.size).toBe(1);
    expect(await f.processor.work()).toEqual(['ACCEPTED']);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(['rotation', 'logout', 'account'] as const)(
    'skips the old generation after %s before permission',
    async (kind) => {
      const f = pushFixture();
      const {
        deliveryIds: [delivery],
      } = await f.processor.expand(id(1));
      const device = f.tables.notification_devices.get(id(10))!;
      if (kind === 'rotation') f.seedDevice(10, otpActor, 2, 'new-token');
      if (kind === 'logout')
        Object.assign(device, { state: 'DISABLED', revision: 2 });
      if (kind === 'account') f.seedDevice(10, id(500), 2);
      expect(await f.processor.run(delivery)).toBe('NOT_GRANTED');
      expect(f.tables.notification_push_deliveries.get(delivery)?.state).toBe(
        'SKIPPED',
      );
      expect(f.tables.notification_push_attempts.size).toBe(0);
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it('reserves each device independently and does not resend an accepted sibling', async () => {
    const f = pushFixture();
    f.seedDevice(20);
    f.send
      .mockResolvedValueOnce('ACCEPTED')
      .mockResolvedValueOnce('RETRYABLE_REJECTION');
    expect(await f.processor.work()).toEqual([
      'ACCEPTED',
      'RETRYABLE_REJECTION',
    ]);
    f.advance();
    expect(await f.processor.work()).toEqual(['ACCEPTED']);
    expect(f.send).toHaveBeenCalledTimes(3);
    const attempts = [...f.tables.notification_push_attempts.values()];
    expect(new Set(attempts.map((a) => a._id)).size).toBe(3);
    expect(attempts.filter((a) => a.ordinal === 2)).toHaveLength(1);
  });
  it('retries only explicit retryable rejections after the delay and stops at the configured attempt budget', async () => {
    const f = pushFixture();
    f.send.mockResolvedValue('RETRYABLE_REJECTION');
    expect(await f.processor.work()).toEqual(['RETRYABLE_REJECTION']);
    expect(await f.processor.work()).toEqual([]);
    f.advance();
    expect(await f.processor.work()).toEqual(['RETRYABLE_REJECTION']);
    f.advance();
    expect(await f.processor.work()).toEqual(['RETRYABLE_REJECTION']);
    f.advance(864000000);
    expect(await f.processor.work()).toEqual([]);
    expect(
      [...f.tables.notification_push_deliveries.values()][0],
    ).toMatchObject({ state: 'RECORDED', attempts: 3 });
    expect(
      [...f.tables.notification_push_attempts.values()].map((a) => a.ordinal),
    ).toEqual([1, 2, 3]);
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it.each(['throw', 'malformed', 'unknown'] as const)(
    'records %s as uncertain without age-based retry or token invalidation',
    async (kind) => {
      const f = pushFixture();
      if (kind === 'throw')
        f.send.mockRejectedValue(new Error('private token and credentials'));
      if (kind === 'malformed')
        f.send.mockResolvedValue('untrusted-result' as PushOutcome);
      if (kind === 'unknown') f.send.mockResolvedValue('UNKNOWN');
      expect(await f.processor.work()).toEqual(['UNKNOWN']);
      f.advance(864000000);
      expect(await f.processor.work()).toEqual([]);
      expect(f.send).toHaveBeenCalledTimes(1);
      expect([...f.tables.notification_push_attempts.values()][0].outcome).toBe(
        'UNKNOWN',
      );
      expect(f.tables.notification_devices.get(id(10))?.state).toBe('ACTIVE');
      expect(
        JSON.stringify([...f.tables.notification_push_attempts.values()]),
      ).not.toMatch(/private|credentials|synthetic-token/);
    },
  );
  it('does not resend or reconstruct a permission after a simulated lost grant acknowledgement', async () => {
    const f = pushFixture();
    const {
      deliveryIds: [delivery],
    } = await f.processor.expand(id(1));
    f.flags.lostCommit = true;
    await expect(f.processor.run(delivery)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.tables.notification_push_deliveries.get(delivery)?.state).toBe(
      'MAY_SEND',
    );
    expect(f.send).not.toHaveBeenCalled();
    f.advance(864000000);
    expect(await f.processor.run(delivery)).toBe('NOT_GRANTED');
    expect(await f.processor.work()).toEqual([]);
    expect(f.tables.notification_push_attempts.size).toBe(1);
  });
  it('leaves an acknowledged permission uncertain if the process dies before invoking its provider', async () => {
    const f = pushFixture();
    const {
      deliveryIds: [delivery],
    } = await f.processor.expand(id(1));
    expect(
      await f.store.grant(delivery, id(99), '2026-10-29T12:00:00.000Z'),
    ).not.toBeNull();
    f.advance(864000000);
    expect(await f.processor.run(delivery)).toBe('NOT_GRANTED');
    expect(f.send).not.toHaveBeenCalled();
    expect([...f.tables.notification_push_attempts.values()][0].state).toBe(
      'MAY_SEND',
    );
  });
  it.each(['ACCEPTED', 'RETRYABLE_REJECTION'] as const)(
    'uses the persisted %s response after a simulated lost response acknowledgement',
    async (outcome) => {
      const f = pushFixture();
      f.send.mockImplementationOnce(() => {
        f.flags.lostCommit = true;
        return Promise.resolve(outcome);
      });
      await expect(f.processor.work()).rejects.toMatchObject({ status: 503 });
      expect([...f.tables.notification_push_attempts.values()][0].outcome).toBe(
        outcome,
      );
      f.advance();
      expect(await f.processor.work()).toEqual(
        outcome === 'ACCEPTED' ? [] : ['ACCEPTED'],
      );
      expect(f.send).toHaveBeenCalledTimes(outcome === 'ACCEPTED' ? 1 : 2);
    },
  );
  it('keeps grant uncertainty if the response cannot be persisted, without replaying the physical send', async () => {
    const f = pushFixture();
    f.flags.failFinish = true;
    await expect(f.processor.work()).rejects.toMatchObject({ status: 503 });
    f.flags.failFinish = false;
    expect(await f.processor.work()).toEqual([]);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect([...f.tables.notification_push_attempts.values()][0].state).toBe(
      'MAY_SEND',
    );
  });
  it('returns a fresh permission to only one competing processor in the simulated serialized transactions', async () => {
    const f = pushFixture();
    const {
      deliveryIds: [delivery],
    } = await f.processor.expand(id(1));
    expect(
      (
        await Promise.all([
          f.processor.run(delivery),
          f.processor.run(delivery),
        ])
      ).sort(),
    ).toEqual(['ACCEPTED', 'NOT_GRANTED']);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('replays the client receipt after invalidation without silently reactivating the rejected token', async () => {
    const client = notificationDeviceFixture(),
      f = pushFixture();
    const operation = client.nextOperation();
    await client.register(otpActor, id(10), 0, client.token, operation);
    const registered = client.rows().get(id(10))!;
    f.tables.notification_devices.set(id(10), structuredClone(registered));
    f.tables.notification_device_tokens.clear();
    f.tables.notification_device_tokens.set(registered.tokenHash!, {
      _id: registered.tokenHash,
      installationId: id(10),
      revision: 1,
    });
    f.send.mockResolvedValue('INVALID_TOKEN');
    await f.processor.work();
    client
      .rows()
      .set(id(10), f.tables.notification_devices.get(id(10)) as DeviceRecord);
    client.claims().clear();
    expect(
      await client.register(otpActor, id(10), 0, client.token, operation),
    ).toMatchObject({ state: 'DISABLED', revision: 2 });
    expect(
      await client.register(otpActor, id(10), 2, 'new-provider-token'),
    ).toMatchObject({ state: 'ACTIVE', revision: 3 });
  });
  it('disables only the current invalid generation and removes its matching token claim atomically', async () => {
    const f = pushFixture();
    const original = structuredClone(
      f.tables.notification_devices.get(id(10))!,
    );
    f.send.mockResolvedValue('INVALID_TOKEN');
    expect(await f.processor.work()).toEqual(['INVALID_TOKEN']);
    expect(f.tables.notification_devices.get(id(10))).toMatchObject({
      state: 'DISABLED',
      revision: 2,
      keyHash: original.keyHash,
      lastOperationId: original.lastOperationId,
      lastOperationHash: original.lastOperationHash,
    });
    expect(f.tables.notification_devices.get(id(10))?.token).toBeUndefined();
    expect(f.tables.notification_device_tokens.size).toBe(0);
  });
  it.each(['rotation', 'account', 'logout'] as const)(
    'records a late invalid-token response without changing a newer %s',
    async (kind) => {
      const f = pushFixture();
      f.send.mockImplementation(() => {
        const device = f.seedDevice(
          10,
          kind === 'account' ? id(500) : otpActor,
          2,
          'new-token',
        );
        if (kind === 'logout') Object.assign(device, { state: 'DISABLED' });
        return Promise.resolve('INVALID_TOKEN');
      });
      expect(await f.processor.work()).toEqual(['INVALID_TOKEN']);
      expect(f.tables.notification_devices.get(id(10))).toMatchObject({
        revision: 2,
        token: 'new-token',
        state: kind === 'logout' ? 'DISABLED' : 'ACTIVE',
      });
      expect([...f.tables.notification_push_attempts.values()][0].outcome).toBe(
        'INVALID_TOKEN',
      );
    },
  );
  it('a logout after permission does not revoke an already granted send', async () => {
    const f = pushFixture();
    f.send.mockImplementation(() => {
      Object.assign(f.tables.notification_devices.get(id(10))!, {
        state: 'DISABLED',
        revision: 2,
      });
      return Promise.resolve('ACCEPTED');
    });
    expect(await f.processor.work()).toEqual(['ACCEPTED']);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.tables.notification_devices.get(id(10))?.state).toBe('DISABLED');
  });
  it('does not retry a permanent rejection or alter the active token', async () => {
    const f = pushFixture();
    f.send.mockResolvedValue('PERMANENT_REJECTION');
    expect(await f.processor.work()).toEqual(['PERMANENT_REJECTION']);
    expect(await f.processor.work()).toEqual([]);
    expect(f.tables.notification_devices.get(id(10))?.state).toBe('ACTIVE');
  });
  it.each([
    { maxAttempts: 0, delayMs: 1000 },
    { maxAttempts: 101, delayMs: 1000 },
    { maxAttempts: 2, delayMs: 0 },
  ])('refuses invalid retry policy %j', (policy) => {
    const f = pushFixture();
    expect(
      () => new NotificationPushProcessor(f.store, { send: f.send }, policy),
    ).toThrow('Invalid push retry policy');
  });
  it('validates internal batch and delivery inputs before accessing storage', async () => {
    const f = pushFixture();
    expect(() => f.processor.expand(id(1), 51)).toThrow();
    await expect(f.processor.work(0)).rejects.toThrow();
    await expect(f.processor.run('invalid')).rejects.toThrow();
    expect(f.connection.startSession).not.toHaveBeenCalled();
  });
});
