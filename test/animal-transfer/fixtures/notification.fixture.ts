import { MongoNotifications } from '../../../src/context/notification/infrastructure/mongo-notifications';
import { Notifications } from '../../../src/context/notification/application/notifications';
import { NotificationRecord } from '../../../src/context/notification/domain/notification';
import { promotionTestId as id } from './media-promotion.fixture';
import { otpActor, otpOther } from './transfer-otp.fixture';

type Filter = Record<string, unknown>;
export function notificationFixture(count = 3) {
  const rows: Array<NotificationRecord & { internalPayload?: string }> = [
    ...Array.from({ length: count }, (_, i) => ({
      _id: id(100 + i),
      userId: otpActor,
      transferId: id(1),
      type: 'TRANSFER_REQUEST_RECEIVED' as const,
      itemIds: [id(2)],
      title: 'Solicitud recibida',
      text: 'La solicitud incluye 1 animal.',
      createdAt: '2026-10-29T12:00:00.000Z',
      internalPayload: 'private payload',
      ...(i === 1 ? { readAt: '2026-10-29T12:01:00.000Z' } : {}),
    })),
    {
      _id: id(999),
      userId: otpOther,
      transferId: id(3),
      type: 'TRANSFER_REQUEST_SENT',
      itemIds: [id(4)],
      title: 'Solicitud enviada',
      text: 'La solicitud incluye 1 animal.',
      createdAt: '2026-10-29T12:00:00.000Z',
    },
  ];
  const flags = {
    readFailure: false,
    lostReadReply: false,
    bulkWriteFailure: false,
    lostBulkReply: false,
    receiptPreparationFailure: false,
  };
  const calls: Array<{
    method: string;
    filter: Filter;
    update?: unknown;
    options?: unknown;
    settings: Record<string, unknown>;
  }> = [];
  const copy = <T>(v: T): T => structuredClone(v);
  function matches(row: NotificationRecord, filter: Filter): boolean {
    return Object.entries(filter).every(([key, wanted]) => {
      if (key === '$or')
        return (wanted as Filter[]).some((f) => matches(row, f));
      const actual = (row as unknown as Filter)[key];
      if (wanted === null) return actual == null;
      if (wanted && typeof wanted === 'object') {
        const op = wanted as { $in?: unknown[]; $lt?: string; $lte?: string };
        if (op.$in) return op.$in.includes(actual);
        if (op.$lt !== undefined)
          return typeof actual === 'string' && actual < op.$lt;
        if (op.$lte !== undefined)
          return typeof actual === 'string' && actual <= op.$lte;
        throw new Error('Unsupported notification fixture filter');
      }
      return actual === wanted;
    });
  }
  function query<T>(
    method: string,
    filter: Filter,
    run: (settings: Record<string, unknown>) => T,
    update?: unknown,
    options?: unknown,
  ) {
    const settings: Record<string, unknown> = {};
    const q = {
      select: (v: unknown) => {
        settings.projection = v;
        return q;
      },
      read: (v: unknown) => {
        settings.read = v;
        return q;
      },
      readConcern: (v: unknown) => {
        settings.readConcern = v;
        return q;
      },
      collation: (v: unknown) => {
        settings.collation = v;
        return q;
      },
      sort: (v: unknown) => {
        settings.sort = v;
        return q;
      },
      limit: (v: number) => {
        settings.limit = v;
        return q;
      },
      maxTimeMS: (v: unknown) => {
        settings.maxTimeMS = v;
        return q;
      },
      lean: () => q,
      exec: () => {
        calls.push({
          method,
          filter: copy(filter),
          update: copy(update),
          options: copy(options),
          settings: copy(settings),
        });
        if (flags.readFailure)
          return Promise.reject(
            new Error('private URI credentials provider failure'),
          );
        try {
          return Promise.resolve(copy(run(settings)));
        } catch (error) {
          return Promise.reject(
            error instanceof Error
              ? error
              : new Error('Invalid simulated notification failure'),
          );
        }
      },
    };
    return q;
  }
  let receiptCollectionExists = false;
  const receipts = new Map<string, { _id: string; cutoffAt: string }>();
  const receiptModel = {
    findOne: jest.fn(({ _id }: { _id: string }) =>
      Promise.resolve(receipts.get(_id) ?? null),
    ),
    insertOne: jest.fn((receipt: { _id: string; cutoffAt: string }) => {
      receipts.set(receipt._id, receipt);
      return Promise.resolve({ acknowledged: true });
    }),
  };
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<void>) => {
      const previous = copy(rows);
      const previousReceipts = new Map(receipts);
      try {
        await work();
      } catch (error) {
        rows.splice(0, rows.length, ...previous);
        receipts.clear();
        for (const [key, receipt] of previousReceipts)
          receipts.set(key, receipt);
        throw error;
      }
      if (flags.lostBulkReply) {
        flags.lostBulkReply = false;
        throw new Error('Read-all commit acknowledgement lost');
      }
    }),
    endSession: jest.fn(() => Promise.resolve()),
  };
  const db = {
    listCollections: jest.fn(() => ({
      toArray: () =>
        Promise.resolve(
          receiptCollectionExists ? [{ type: 'collection' }] : [],
        ),
    })),
    createCollection: jest.fn(() => {
      if (flags.receiptPreparationFailure)
        return Promise.reject(new Error('private collection permission'));
      receiptCollectionExists = true;
      return Promise.resolve();
    }),
    collection: jest.fn(() => receiptModel),
  };
  const model = {
    db: {
      db,
      startSession: jest.fn(() => Promise.resolve(session)),
    },
    updateMany: jest.fn(
      (filter: Filter, update: { $set: { readAt: string } }) =>
        query(
          'markAll',
          filter,
          () => {
            for (const row of rows.filter((entry) => matches(entry, filter)))
              row.readAt = update.$set.readAt;
            if (flags.bulkWriteFailure)
              throw new Error('private partial batch failure');
            return { acknowledged: true };
          },
          update,
        ),
    ),
    find: jest.fn((filter: Filter) =>
      query('find', filter, (settings) =>
        rows
          .filter((r) => matches(r, filter))
          .sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) ||
              b._id.localeCompare(a._id),
          )
          .slice(0, settings.limit as number),
      ),
    ),
    countDocuments: jest.fn((filter: Filter) =>
      query(
        'count',
        filter,
        () => rows.filter((r) => matches(r, filter)).length,
      ),
    ),
    findOneAndUpdate: jest.fn(
      (
        filter: Filter,
        update: { $set: { readAt: string } },
        options: unknown,
      ) =>
        query(
          'mark',
          filter,
          () => {
            const row = rows.find((r) => matches(r, filter));
            if (!row) return null;
            row.readAt = update.$set.readAt;
            if (flags.lostReadReply) {
              flags.lostReadReply = false;
              throw new Error(
                'Write acknowledgement lost after simulated update',
              );
            }
            return row;
          },
          update,
          options,
        ),
    ),
    findOne: jest.fn((filter: Filter) =>
      query(
        'findOne',
        filter,
        () => rows.find((r) => matches(r, filter)) ?? null,
      ),
    ),
  };
  const store = new MongoNotifications(model as never),
    service = new Notifications(store);
  return {
    rows,
    flags,
    calls,
    model,
    db,
    session,
    receiptModel,
    receipts,
    store,
    service,
    id,
    snapshot: () => copy(rows),
  };
}
