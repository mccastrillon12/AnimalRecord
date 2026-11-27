import { notificationFixture } from '../fixtures/notification.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';
import { NOTIFICATION_TYPES } from '../../../src/context/notification/domain/notification';
import { TransferNoticeSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';

describe('Notification Mongo query contracts, no Mongo connection', () => {
  it('filters the page by actor and known event types, orders with simple collation and requests one lookahead', async () => {
    const f = notificationFixture();
    const first = await f.service.list(otpActor, 1);
    await f.service.list(otpActor, 1, first.nextCursor);
    expect(f.calls[0]).toMatchObject({
      method: 'find',
      filter: {
        userId: otpActor,
        type: {
          $in: NOTIFICATION_TYPES,
        },
      },
      settings: {
        read: 'primary',
        readConcern: 'majority',
        collation: { locale: 'simple' },
        sort: { createdAt: -1, _id: -1 },
        limit: 2,
        maxTimeMS: 5000,
      },
    });
    expect(f.calls[1].filter).toMatchObject({
      userId: otpActor,
      $or: [
        { createdAt: { $lt: first.items[0].createdAt } },
        {
          createdAt: first.items[0].createdAt,
          _id: { $lt: first.items[0].id },
        },
      ],
    });
    expect(
      Object.keys(f.calls[0].settings.projection as object).sort(),
    ).toEqual([
      '_id',
      'createdAt',
      'itemIds',
      'readAt',
      'text',
      'title',
      'transferId',
      'type',
      'userId',
    ]);
  });
  it('performs the scoped unread count with bounded primary/majority read rather than loading notifications', async () => {
    const f = notificationFixture();
    await f.service.unreadCount(otpActor);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({
      method: 'count',
      filter: { userId: otpActor, readAt: null },
      settings: { read: 'primary', readConcern: 'majority', maxTimeMS: 5000 },
    });
    expect(f.model.find).not.toHaveBeenCalled();
  });
  it('only writes readAt with majority, no upsert, and scopes both the update and repeat read to the actor', async () => {
    const f = notificationFixture();
    await f.service.markRead(otpActor, f.id(100));
    await f.service.markRead(otpActor, f.id(100));
    expect(f.calls[0]).toMatchObject({
      method: 'mark',
      filter: { _id: f.id(100), userId: otpActor, readAt: null },
      options: {
        new: true,
        upsert: false,
        writeConcern: { w: 'majority', wtimeout: 10000 },
        maxTimeMS: 5000,
      },
    });
    expect(Object.keys(f.calls[0].update as object)).toEqual(['$set']);
    expect(Object.keys((f.calls[0].update as { $set: object }).$set)).toEqual([
      'readAt',
    ]);
    expect(f.calls.at(-1)).toMatchObject({
      method: 'findOne',
      filter: { _id: f.id(100), userId: otpActor },
      settings: { read: 'primary', readConcern: 'majority' },
    });
  });
  it('prepares receipts once and atomically marks only eligible unread rows for the account', async () => {
    const f = notificationFixture();
    await f.store.onModuleInit();
    await f.store.onModuleInit();
    expect(f.db.createCollection).toHaveBeenCalledTimes(1);
    const operation = f.id(50);
    const cutoff = '2026-10-29T12:00:00.000Z';
    f.rows[0].readAt = null;
    f.rows[2].createdAt = '2026-10-29T12:00:00.001Z';
    const previous = f.snapshot();
    await f.store.markAllRead(otpActor, operation, cutoff);
    expect(f.rows).toEqual([
      { ...previous[0], readAt: cutoff },
      ...previous.slice(1),
    ]);
    expect(f.receiptModel.insertOne).toHaveBeenCalledWith(
      { _id: `${otpActor}:${operation}`, cutoffAt: cutoff },
      { session: f.session },
    );
    expect(f.model.updateMany).toHaveBeenCalledWith(
      {
        userId: otpActor,
        type: { $in: NOTIFICATION_TYPES },
        readAt: null,
        createdAt: { $lte: cutoff },
      },
      { $set: { readAt: cutoff } },
      { session: f.session, upsert: false, collation: { locale: 'simple' } },
    );
    expect(f.session.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
      }),
    );
    expect(f.session.endSession).toHaveBeenCalledTimes(1);
  });
  it('keeps the receipt and changes together when a write fails, then lets the same operation succeed', async () => {
    const f = notificationFixture();
    await f.store.onModuleInit();
    const before = f.snapshot();
    const operation = f.id(50);
    f.flags.bulkWriteFailure = true;
    await expect(f.service.markAllRead(otpActor, operation)).rejects.toThrow(
      'retry with the same Idempotency-Key',
    );
    expect(f.snapshot()).toEqual(before);
    expect(f.receipts.size).toBe(0);
    f.flags.bulkWriteFailure = false;
    await f.service.markAllRead(otpActor, operation);
    expect(f.receipts.size).toBe(1);
    await expect(f.service.unreadCount(otpActor)).resolves.toEqual({
      count: 0,
    });
  });
  it('recovers a lost commit response without sweeping a later insert with an older timestamp', async () => {
    const f = notificationFixture();
    await f.store.onModuleInit();
    const operation = f.id(0xaf);
    f.flags.lostBulkReply = true;
    await expect(f.service.markAllRead(otpActor, operation)).rejects.toThrow(
      'could not be confirmed',
    );
    f.rows.push({ ...f.rows[0], _id: f.id(1010), readAt: undefined });
    const committed = f.snapshot();
    await f.service.markAllRead(otpActor, operation.toUpperCase());
    expect(f.snapshot()).toEqual(committed);
    expect(f.model.updateMany).toHaveBeenCalledTimes(1);
    await f.service.markAllRead(otpOther, operation);
    expect(
      f.rows.find(({ userId }) => userId === otpOther)?.readAt,
    ).toBeDefined();
    expect(f.rows.at(-1)?.readAt).toBeUndefined();
    await f.service.markAllRead(otpActor, f.id(51));
    expect(f.rows.at(-1)?.readAt).toBeDefined();
  });
  it('records an empty operation while keeping the existing inbox available if preparation fails', async () => {
    const f = notificationFixture(0);
    const operation = f.id(50);
    f.flags.receiptPreparationFailure = true;
    await f.store.onModuleInit();
    await expect(
      f.service.markAllRead(otpActor, operation),
    ).rejects.toMatchObject({
      status: 503,
    });
    expect(f.model.db.startSession).not.toHaveBeenCalled();
    await expect(f.service.unreadCount(otpOther)).resolves.toEqual({
      count: 1,
    });
    f.flags.receiptPreparationFailure = false;
    await f.store.onModuleInit();
    await f.service.markAllRead(otpActor, operation);
    f.rows.push({ ...f.rows[0], userId: otpActor, _id: f.id(500) });
    await f.service.markAllRead(otpActor, operation);
    expect(f.rows.at(-1)?.readAt).toBeUndefined();
    expect(f.receipts.size).toBe(1);
  });
  it('declares the unread lookup index without automatic creation, TTL or changes to stored notification identities', () => {
    expect(TransferNoticeSchema.get('collection')).toBe('notifications');
    expect(TransferNoticeSchema.get('autoCreate')).toBe(false);
    expect(TransferNoticeSchema.get('autoIndex')).toBe(false);
    expect(TransferNoticeSchema.indexes()).toEqual(
      expect.arrayContaining([[{ userId: 1, readAt: 1 }, expect.any(Object)]]),
    );
    expect(
      TransferNoticeSchema.indexes().every(
        ([, options]) => options.expireAfterSeconds === undefined,
      ),
    ).toBe(true);
  });
});
