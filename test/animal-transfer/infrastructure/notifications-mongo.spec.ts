import { notificationFixture } from '../fixtures/notification.fixture';
import { otpActor } from '../fixtures/transfer-otp.fixture';
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
          $in: [
            'TRANSFER_REQUEST_SENT',
            'TRANSFER_REQUEST_RECEIVED',
            'TRANSFER_REQUEST_REJECTED',
          ],
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
