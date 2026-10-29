import {
  notificationDeviceFixture,
  installationKey,
} from '../fixtures/notification-device.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';
import { DeviceRegistration } from '../../../src/context/notification/domain/notification-device';

describe('Device registration with serialized simulated transactions, no FCM/Mongo', () => {
  it('registers multiple devices for one account and never returns credentials, hashes, token or user ID', async () => {
    const f = notificationDeviceFixture(),
      first = await f.register();
    expect(first).toMatchObject({
      installationId: f.installationId,
      revision: 1,
      state: 'ACTIVE',
      registeredToCurrentUser: true,
    });
    await f.register(otpActor, f.id(11), 0, 'synthetic-push-token-B');
    expect(f.rows().size).toBe(2);
    expect(f.claims().size).toBe(2);
    expect(await f.service.get(otpActor, f.installationId, f.key)).toEqual(
      first,
    );
    expect(JSON.stringify(first)).not.toMatch(
      /token|Hash|userId|Operation|synthetic|key/,
    );
    expect(f.rows().get(f.installationId)!.keyHash).not.toBe(f.key);
  });
  it('replays the exact latest operation and rejects key reuse for a changed body', async () => {
    const f = notificationDeviceFixture(),
      operation = f.nextOperation();
    const first = await f.register(
        otpActor,
        f.installationId,
        0,
        f.token,
        operation,
      ),
      before = f.snapshot();
    expect(
      await f.register(otpActor, f.installationId, 0, f.token, operation),
    ).toEqual(first);
    expect(f.snapshot()).toEqual(before);
    await expect(
      f.register(otpActor, f.installationId, 0, 'changed-token', operation),
    ).rejects.toThrow('already used');
    expect(f.snapshot()).toEqual(before);
  });
  it('rotates the token atomically and prevents a stale registration from undoing the new generation', async () => {
    const f = notificationDeviceFixture(),
      oldOperation = f.nextOperation();
    await f.register(otpActor, f.installationId, 0, f.token, oldOperation);
    const oldHash = f.rows().get(f.installationId)!.tokenHash!;
    expect(
      (await f.register(otpActor, f.installationId, 1, 'rotated-token'))
        .revision,
    ).toBe(2);
    expect(f.claims().has(oldHash)).toBe(false);
    expect(f.claims().size).toBe(1);
    await expect(
      f.register(otpActor, f.installationId, 0, f.token, oldOperation),
    ).rejects.toThrow('revision changed');
    expect(f.rows().get(f.installationId)!.token).toBe('rotated-token');
  });
  it('allows an explicit account switch with installation proof and revision; stale old-account removal cannot detach the new account', async () => {
    const f = notificationDeviceFixture();
    await f.register();
    expect(
      await f.service.get(otpOther, f.installationId, f.key),
    ).toMatchObject({ revision: 1, registeredToCurrentUser: false });
    const rebound = await f.register(otpOther, f.installationId, 1);
    expect(rebound).toMatchObject({
      revision: 2,
      registeredToCurrentUser: true,
    });
    await expect(
      f.service.unregister(
        otpActor,
        f.installationId,
        f.key,
        f.nextOperation(),
        '"1"',
      ),
    ).rejects.toThrow('not found');
    await expect(f.register(otpActor, f.installationId, 1)).rejects.toThrow(
      'revision changed',
    );
    expect(
      (await f.service.get(otpActor, f.installationId, f.key))
        .registeredToCurrentUser,
    ).toBe(false);
  });
  it('disables without retaining the token, preserves a tombstone and replays the logout without reactivating a prior PUT', async () => {
    const f = notificationDeviceFixture(),
      registerId = f.nextOperation();
    await f.register(otpActor, f.installationId, 0, f.token, registerId);
    const removeId = f.nextOperation();
    const result = await f.service.unregister(
      otpActor,
      f.installationId,
      f.key,
      removeId,
      '"1"',
    );
    expect(result).toMatchObject({
      revision: 2,
      state: 'DISABLED',
      registeredToCurrentUser: false,
    });
    expect(
      await f.service.unregister(
        otpActor,
        f.installationId,
        f.key,
        removeId,
        '"1"',
      ),
    ).toEqual(result);
    expect(f.rows().get(f.installationId)).not.toHaveProperty('token');
    expect(f.rows().get(f.installationId)).not.toHaveProperty('tokenHash');
    expect(f.claims().size).toBe(0);
    await expect(
      f.register(otpActor, f.installationId, 0, f.token, registerId),
    ).rejects.toThrow('revision changed');
    expect(
      (await f.register(otpOther, f.installationId, 2, 'new-account-token'))
        .revision,
    ).toBe(3);
  });
  it('rejects a second installation for the same token and rolls back a failed rotation without losing the original claim', async () => {
    const f = notificationDeviceFixture();
    await f.register();
    const before = f.snapshot();
    await expect(f.register(otpOther, f.id(11))).rejects.toThrow(
      'already assigned',
    );
    expect(f.snapshot()).toEqual(before);
    f.flags.failClaim = true;
    await expect(
      f.register(otpActor, f.installationId, 1, 'rotated-token'),
    ).rejects.toThrow('claim write failed');
    expect(f.snapshot()).toEqual(before);
  });
  it('concurrent first registration and rotation produce one revision without duplicate routing assignments', async () => {
    const f = notificationDeviceFixture(),
      operation = f.nextOperation();
    const initial = await Promise.all([
      f.register(otpActor, f.installationId, 0, f.token, operation),
      f.register(otpActor, f.installationId, 0, f.token, operation),
    ]);
    expect(initial[0]).toEqual(initial[1]);
    expect(f.claims().size).toBe(1);
    const competing = await Promise.allSettled([
      f.register(otpActor, f.installationId, 1, 'rotation-A'),
      f.register(otpOther, f.installationId, 1, 'rotation-B'),
    ]);
    expect(competing.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.rows().get(f.installationId)!.revision).toBe(2);
    expect(f.claims().size).toBe(1);
  });
  it('does not adopt a lost commit reply; explicit same-operation replay resolves only the latest stored receipt', async () => {
    const f = notificationDeviceFixture(),
      operation = f.nextOperation();
    f.flags.lostReply = true;
    await expect(
      f.register(otpActor, f.installationId, 0, f.token, operation),
    ).rejects.toThrow('reply lost');
    expect(f.find).not.toHaveBeenCalled();
    expect(
      (await f.register(otpActor, f.installationId, 0, f.token, operation))
        .revision,
    ).toBe(1);
    expect(f.claims().size).toBe(1);
  });
  it('requires installation proof, hides account identity and does not treat an installation UUID as a credential', async () => {
    const f = notificationDeviceFixture();
    await f.register();
    const before = f.snapshot();
    const wrong = Buffer.alloc(32, 8).toString('base64url');
    await expect(
      f.service.get(otpOther, f.installationId, wrong),
    ).rejects.toThrow('not found');
    await expect(
      f.register(
        otpOther,
        f.installationId,
        1,
        f.token,
        f.nextOperation(),
        wrong,
      ),
    ).rejects.toThrow('not found');
    await expect(
      f.service.unregister(
        otpOther,
        f.installationId,
        wrong,
        f.nextOperation(),
        '"1"',
      ),
    ).rejects.toThrow('not found');
    expect(f.snapshot()).toEqual(before);
  });
  it.each(['0', '"-1"', '"01"', '*', '"9007199254740991"'])(
    'rejects invalid or unbounded If-Match %j',
    async (revision) => {
      const f = notificationDeviceFixture();
      await expect(
        f.service.register(
          otpActor,
          f.installationId,
          installationKey,
          f.nextOperation(),
          revision,
          { provider: 'FCM', platform: 'ANDROID', token: f.token },
        ),
      ).rejects.toThrow('Invalid');
      expect(f.rows().size).toBe(0);
    },
  );
  it.each(['', 'short', 'A'.repeat(42) + 'B'])(
    'rejects missing or noncanonical installation proof %j before reading storage',
    async (key) => {
      const f = notificationDeviceFixture();
      await expect(
        f.service.get(otpActor, f.installationId, key),
      ).rejects.toThrow('Invalid');
      expect(f.find).not.toHaveBeenCalled();
      expect(f.rows().size).toBe(0);
    },
  );
  it.each([
    { provider: 'SNS' },
    { platform: 'WEB' },
    { token: 'token with whitespace' },
    { token: '' },
    { token: 'x'.repeat(4097) },
    { userId: otpOther },
  ])(
    'rejects unsupported registration metadata before storage',
    async (change) => {
      const f = notificationDeviceFixture();
      await expect(
        f.service.register(
          otpActor,
          f.installationId,
          f.key,
          f.nextOperation(),
          '"0"',
          {
            provider: 'FCM',
            platform: 'ANDROID',
            token: f.token,
            ...change,
          } as DeviceRegistration,
        ),
      ).rejects.toThrow('Invalid');
      expect(f.rows().size).toBe(0);
    },
  );
});
