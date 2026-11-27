import { resolve } from 'node:path';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Schema } from 'mongoose';
import {
  configuredNotificationPush,
  NotificationPushRunner,
} from '../../../src/app/notification/notification-push-runtime.module';
import { NotificationPushProcessor } from '../../../src/context/notification/application/notification-push';
import { FcmNotificationPush } from '../../../src/context/notification/infrastructure/fcm-notification-push';
import { pushFixture, pushNames } from '../fixtures/notification-push.fixture';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';

const at = '2026-10-29T12:00:00.000Z';
const enabledEnv = {
  TRANSFER_PUSH_ENABLED: 'true',
  TRANSFER_PUSH_FROM: at,
  TRANSFER_PUSH_FCM_PROJECT_ID: 'animalrecord-test',
  GOOGLE_APPLICATION_CREDENTIALS: resolve('synthetic-key.json'),
};
class SimulatedPushDatabase {}
const input = {
  attemptId: id(5),
  token: 'synthetic-device-token',
  animalCount: 2,
  data: { notificationId: id(2), transferId: id(3), recipientId: id(4) },
};
const successful = {
  status: 200,
  body: JSON.stringify({
    name: 'projects/animalrecord-test/messages/synthetic',
  }),
};
const rejection = (code: number, status: string, fcmCode?: string) => ({
  status: code,
  body: JSON.stringify({
    error: {
      code,
      status,
      details: fcmCode
        ? [
            {
              '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
              errorCode: fcmCode,
            },
          ]
        : [],
    },
  }),
});

function fixture(clock = () => Date.parse(at)) {
  const token = jest
    .fn<Promise<string | null>, []>()
    .mockResolvedValue('synthetic-oauth');
  const post = jest
    .fn<
      Promise<typeof successful & { retryAfter?: string }>,
      [URL, string, string]
    >()
    .mockResolvedValue(successful);
  const fcm = new FcmNotificationPush('animalrecord-test', token, post, clock);
  return { token, post, fcm };
}

describe('transfer push runtime and FCM HTTP v1 payload, no network', () => {
  it('keeps push opt-in and rejects incomplete environment configuration', () => {
    expect(configuredNotificationPush({})).toBeUndefined();
    expect(
      configuredNotificationPush({ TRANSFER_PUSH_ENABLED: 'false' }),
    ).toBeUndefined();
    expect(configuredNotificationPush(enabledEnv)?.providers).toContain(
      NotificationPushRunner,
    );
    expect(() =>
      configuredNotificationPush({
        ...enabledEnv,
        TRANSFER_PUSH_FROM: '2026-10-29',
      }),
    ).toThrow();
    expect(() =>
      configuredNotificationPush({
        ...enabledEnv,
        GOOGLE_APPLICATION_CREDENTIALS: '',
      }),
    ).toThrow();
  });

  it('sends one visible request to FCM with only the approved data', async () => {
    const f = fixture();
    expect(await (await f.fcm.authorize()).send(input)).toBe('ACCEPTED');
    expect(f.post).toHaveBeenCalledTimes(1);
    const [url, bearer, payload] = f.post.mock.calls[0];
    expect(url.href).toBe(
      'https://fcm.googleapis.com/v1/projects/animalrecord-test/messages:send',
    );
    expect(bearer).toBe('synthetic-oauth');
    expect(JSON.parse(payload)).toEqual({
      message: {
        token: input.token,
        notification: {
          title: '¡Te acaban de transferir 2 animales!',
          body: 'Acéptalos y hazle seguimiento a su información.',
        },
        data: {
          schemaVersion: '1',
          type: 'ANIMAL_TRANSFER_RECEIVED',
          notificationId: id(2),
          transferId: id(3),
        },
        android: {
          priority: 'HIGH',
          notification: { channel_id: 'animal_transfers' },
        },
        apns: {
          headers: { 'apns-push-type': 'alert', 'apns-priority': '10' },
          payload: { aps: { sound: 'default' } },
        },
      },
    });
    expect(payload).not.toContain(input.data.recipientId);
    expect(payload).not.toContain(input.attemptId);
  });

  it.each([
    [rejection(404, 'NOT_FOUND', 'UNREGISTERED'), 'INVALID_TOKEN'],
    [rejection(404, 'NOT_FOUND'), 'PERMANENT_REJECTION'],
    [
      rejection(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT'),
      'PERMANENT_REJECTION',
    ],
    [
      rejection(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH'),
      'PERMANENT_REJECTION',
    ],
    [rejection(503, 'UNAVAILABLE', 'UNAVAILABLE'), 'UNKNOWN'],
    [{ status: 502, body: '<html>error</html>' }, 'UNKNOWN'],
    [{ status: 200, body: '{}' }, 'UNKNOWN'],
  ] as const)(
    'classifies the structured reply %# without a second send',
    async (reply, expected) => {
      const f = fixture();
      f.post.mockResolvedValue(reply);
      await expect((await f.fcm.authorize()).send(input)).resolves.toBe(
        expected,
      );
      expect(f.post).toHaveBeenCalledTimes(1);
    },
  );

  it('persists Retry-After and increases the next delay after another explicit quota rejection', async () => {
    const mongo = pushFixture(at);
    let clock = Date.parse(at);
    const f = fixture(() => clock);
    const processor = new NotificationPushProcessor(
      mongo.store,
      await f.fcm.authorize(),
      { maxAttempts: 3, delayMs: 60_000 },
      () => new Date(clock),
    );
    const quota = rejection(429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED');
    f.post
      .mockResolvedValueOnce({ ...quota, retryAfter: '90' })
      .mockResolvedValueOnce({
        ...quota,
        retryAfter: 'Thu, 29 Oct 2026 12:02:40 GMT',
      })
      .mockResolvedValueOnce(successful);
    await expect(processor.work()).resolves.toEqual(['RETRYABLE_REJECTION']);
    clock += 89_999;
    await expect(processor.work()).resolves.toEqual([]);
    clock++;
    await expect(processor.work()).resolves.toEqual(['RETRYABLE_REJECTION']);
    expect(
      [...mongo.tables.notification_push_deliveries.values()][0].nextAttemptAt,
    ).toBe('2026-10-29T12:03:30.000Z');
    clock += 120_000;
    await expect(processor.work()).resolves.toEqual(['ACCEPTED']);
    expect(f.post).toHaveBeenCalledTimes(3);
  });

  it('records an uncertain transport failure without trying again or marking the inbox read', async () => {
    const mongo = pushFixture(at);
    const f = fixture();
    f.post.mockRejectedValue(new Error('private timeout error'));
    const processor = new NotificationPushProcessor(
      mongo.store,
      await f.fcm.authorize(),
      { maxAttempts: 3, delayMs: 60_000 },
      () => new Date(at),
    );
    await expect(processor.work()).resolves.toEqual(['UNKNOWN']);
    await expect(processor.work()).resolves.toEqual([]);
    expect(mongo.tables.notifications.get(id(2))?.readAt).toBeUndefined();
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it('mounts the real runtime with simulated dependencies, waits for credentials and stops cleanly', async () => {
    const mongo = pushFixture(at);
    const f = fixture();
    const connection = {
      models: {},
      model: (_name: string, schema: Schema) =>
        mongo.models.find(
          (_, index) =>
            pushNames[index] === (schema.get('collection') as string),
        ),
    };
    const connectionToken = getConnectionToken();
    const module = await Test.createTestingModule({
      imports: [
        {
          module: SimulatedPushDatabase,
          global: true,
          providers: [{ provide: connectionToken, useValue: connection }],
          exports: [connectionToken],
        },
        configuredNotificationPush(enabledEnv)!,
      ],
    })
      .overrideProvider(FcmNotificationPush)
      .useValue(f.fcm)
      .compile();
    f.token.mockResolvedValueOnce(null);
    jest.useFakeTimers({ now: Date.parse(at) - 1 });
    try {
      await module.init();
      await jest.advanceTimersByTimeAsync(0);
      expect(f.token).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(30_000);
      expect(mongo.tables.notification_push_attempts.size).toBe(0);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(f.post).toHaveBeenCalledTimes(1);
      expect(mongo.tables.notification_push_attempts.size).toBe(1);
      expect(
        mongo.tables.animal_transfers.get(id(3))?.inboundPushRevision,
      ).toBe(1);
      await module.close();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(f.token).toHaveBeenCalledTimes(2);
    } finally {
      await module.close();
      jest.useRealTimers();
    }
  });
});
