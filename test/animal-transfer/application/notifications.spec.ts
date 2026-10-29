import { Notifications } from '../../../src/context/notification/application/notifications';
import { NotificationStore } from '../../../src/context/notification/domain/notification';
import { notificationFixture } from '../fixtures/notification.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';

describe('Notifications with simulated storage, no external delivery', () => {
  it('pages tied timestamps with opaque user-bound cursors and projects only public fields', async () => {
    const f = notificationFixture(),
      before = f.snapshot();
    const first = await f.service.list(otpActor, 2),
      second = await f.service.list(otpActor, 2, first.nextCursor);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(
      new Set([...first.items, ...second.items].map((i) => i.id)).size,
    ).toBe(3);
    expect(JSON.stringify(first)).not.toMatch(
      /internalPayload|private payload|userId|_id/,
    );
    expect(f.snapshot()).toEqual(before);
    await expect(f.service.list(otpOther, 2, first.nextCursor)).rejects.toThrow(
      'cursor',
    );
    expect((await f.service.list(otpOther)).items.map((i) => i.id)).toEqual([
      f.id(999),
    ]);
  });
  it('counts only the actor unread rows, including absent/null readAt', async () => {
    const f = notificationFixture();
    f.rows[0].readAt = null;
    expect(await f.service.unreadCount(otpActor)).toEqual({ count: 2 });
    expect(await f.service.unreadCount(otpOther)).toEqual({ count: 1 });
  });
  it('preserves the first read timestamp across concurrent and later repeats without changing any other data', async () => {
    const f = notificationFixture(),
      before = f.snapshot();
    const results = await Promise.all([
      f.service.markRead(otpActor, f.id(100)),
      f.service.markRead(otpActor, f.id(100)),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].readAt).toBeDefined();
    expect(await f.service.markRead(otpActor, f.id(100))).toEqual(results[0]);
    expect(await f.service.unreadCount(otpActor)).toEqual({ count: 1 });
    expect(f.rows.map((r) => ({ ...r, readAt: undefined }))).toEqual(
      before.map((r) => ({ ...r, readAt: undefined })),
    );
  });
  it('returns the same not-found response for an absent notice and a notice owned by another user', async () => {
    const f = notificationFixture(),
      before = f.snapshot();
    await expect(f.service.markRead(otpActor, f.id(999))).rejects.toThrow(
      'Notification not found',
    );
    await expect(f.service.markRead(otpActor, f.id(90))).rejects.toThrow(
      'Notification not found',
    );
    expect(f.snapshot()).toEqual(before);
  });
  it('keeps a lost write reply uncertain; an explicit retry can return the stored first read timestamp', async () => {
    const f = notificationFixture();
    f.flags.lostReadReply = true;
    await expect(f.service.markRead(otpActor, f.id(100))).rejects.toThrow(
      'could not be confirmed',
    );
    expect(f.model.findOne).not.toHaveBeenCalled();
    const at = f.rows[0].readAt;
    expect((await f.service.markRead(otpActor, f.id(100))).readAt).toBe(at);
  });
  it('never substitutes zero or an empty page for a storage error and removes raw failure details', async () => {
    const f = notificationFixture();
    f.flags.readFailure = true;
    for (const operation of [
      () => f.service.list(otpActor),
      () => f.service.unreadCount(otpActor),
      () => f.service.markRead(otpActor, f.id(100)),
    ]) {
      const error: unknown = await operation().catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 503 });
      expect(JSON.stringify(error)).not.toMatch(
        /private|credentials|URI|provider/,
      );
    }
  });
  it.each([
    'foreign',
    'unordered',
    'duplicate',
    'invalid-date',
    'too-many',
  ] as const)('fails closed on %s store output', async (mode) => {
    const f = notificationFixture();
    const own = structuredClone(f.rows.slice(0, 2)).reverse();
    if (mode === 'foreign') own[0].userId = otpOther;
    if (mode === 'unordered') own.reverse();
    if (mode === 'duplicate') own[1] = own[0];
    if (mode === 'invalid-date') own[0].createdAt = 'bad';
    if (mode === 'too-many') own.push(...own);
    const store = {
      list: () => Promise.resolve(own),
    } as unknown as NotificationStore;
    await expect(
      new Notifications(store).list(otpActor, 1),
    ).rejects.toMatchObject({ status: 503 });
  });
  it.each([
    '',
    'broken',
    Buffer.from(
      JSON.stringify({ userId: otpActor, at: 'bad', id: otpOther }),
    ).toString('base64url'),
  ])('rejects invalid cursor %j before querying', async (cursor) => {
    const f = notificationFixture();
    await expect(f.service.list(otpActor, 20, cursor)).rejects.toThrow(
      'cursor',
    );
    expect(f.calls).toEqual([]);
  });
  it('rejects an unsafe count and an acknowledgement without the requested read state', async () => {
    const f = notificationFixture();
    const invalidCount = new Notifications({
      unreadCount: () => Promise.resolve(Number.MAX_SAFE_INTEGER + 1),
    } as unknown as NotificationStore);
    await expect(invalidCount.unreadCount(otpActor)).rejects.toMatchObject({
      status: 503,
    });
    const noRead = new Notifications({
      markRead: () => Promise.resolve(f.rows[0]),
    } as unknown as NotificationStore);
    await expect(noRead.markRead(otpActor, f.id(100))).rejects.toMatchObject({
      status: 503,
    });
  });
});
