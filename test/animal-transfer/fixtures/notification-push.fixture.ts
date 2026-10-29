import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import { NotificationPushProcessor } from '../../../src/context/notification/application/notification-push';
import { MongoNotificationPush } from '../../../src/context/notification/infrastructure/mongo-notification-push';
import {
  PUSH_PROTOCOL,
  PushOutcome,
} from '../../../src/context/notification/domain/notification-push';
import { promotionTestId as id } from './media-promotion.fixture';
import { otpActor } from './transfer-otp.fixture';

type Row = Record<string, unknown>;
type Table = Map<string, Row>;
export const pushHash = (s: string) =>
  createHash('sha256').update(s).digest('hex');
export const pushNames = [
  'notification_outbox',
  'notifications',
  'notification_devices',
  'notification_device_tokens',
  'notification_push_deliveries',
  'notification_push_attempts',
] as const;
export function pushFixture() {
  const tables = Object.fromEntries(
    pushNames.map((n) => [n, new Map<string, Row>()]),
  ) as Record<(typeof pushNames)[number], Table>;
  const flags = {
    missing: false,
    standalone: false,
    lostCommit: false,
    failAttempt: false,
    fenceMiss: false,
    failFinish: false,
  };
  const calls: Array<{
    table: string;
    action: string;
    filter: unknown;
    update?: unknown;
    options?: unknown;
    session?: unknown;
    selection?: unknown;
  }> = [];
  let now = new Date('2026-10-29T12:00:00.000Z');
  let tail = Promise.resolve();
  const session = {
    withTransaction: jest.fn(
      async (work: () => Promise<unknown>, options: unknown) => {
        calls.push({ table: '', action: 'transaction', filter: options });
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const before = structuredClone(tables);
        try {
          const result = await work();
          if (flags.lostCommit) {
            flags.lostCommit = false;
            // Throw AFTER local simulated commit; no rollback in this branch.
            release();
            throw Object.assign(new Error('synthetic lost acknowledgement'), {
              committed: true,
            });
          }
          return result;
        } catch (error) {
          if (!(error as { committed?: boolean }).committed)
            for (const n of pushNames) {
              tables[n].clear();
              for (const [k, v] of before[n]) tables[n].set(k, v);
            }
          throw error;
        } finally {
          release();
        }
      },
    ),
    endSession: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
  const connection = {
    readyState: 1,
    db: {
      admin: () => ({
        command: () =>
          Promise.resolve(
            flags.standalone
              ? {}
              : {
                  setName: 'simulated-rs',
                  isWritablePrimary: true,
                  logicalSessionTimeoutMinutes: 30,
                },
          ),
      }),
      listCollections: () => ({
        toArray: () =>
          Promise.resolve(
            flags.missing
              ? []
              : pushNames.map((name) => ({
                  name,
                  type: 'collection',
                  options: {},
                })),
          ),
      }),
    },
    startSession: jest.fn().mockResolvedValue(session),
  };
  const matches = (row: Row, filter: Row): boolean =>
    Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object') {
        if ('$in' in value) return (value.$in as unknown[]).includes(row[key]);
        if ('$gt' in value) return String(row[key]) > String(value.$gt);
        if ('$lte' in value) return String(row[key]) <= String(value.$lte);
      }
      return row[key] === value;
    });
  const models = pushNames.map((name) => {
    const table = tables[name];
    function query(
      action: string,
      filter: Row,
      update?: Row,
      options?: unknown,
    ) {
      let active: unknown,
        selection: unknown,
        limit = Infinity,
        sort: Row = {};
      const q = {
        select: (s: unknown) => {
          selection = s;
          return q;
        },
        sort: (s: Row) => {
          sort = s;
          return q;
        },
        limit: (n: number) => {
          limit = n;
          return q;
        },
        session: (s: unknown) => {
          active = s;
          return q;
        },
        read: () => q,
        readConcern: () => q,
        maxTimeMS: () => q,
        collation: () => q,
        lean: () => q,
        exec: () => {
          calls.push({
            table: name,
            action,
            filter,
            update,
            options,
            session: active,
            selection,
          });
          const rows = [...table.values()].filter((r) => matches(r, filter));
          if (action === 'find') {
            rows.sort((a, b) => {
              for (const [key, order] of Object.entries(sort)) {
                if (a[key] !== b[key])
                  return (
                    (String(a[key]) < String(b[key]) ? -1 : 1) *
                    (order as number)
                  );
              }
              return 0;
            });
            return Promise.resolve(structuredClone(rows.slice(0, limit)));
          }
          if (action === 'findOne')
            return Promise.resolve(structuredClone(rows[0] ?? null));
          if (action === 'deleteOne') {
            if (rows[0]) table.delete(rows[0]._id as string);
            return Promise.resolve({ deletedCount: rows[0] ? 1 : 0 });
          }
          if (
            name === 'notification_devices' &&
            flags.fenceMiss &&
            (update?.$inc as Row | undefined)?.pushRevision
          )
            return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
          if (name === 'notification_push_attempts' && flags.failFinish)
            throw new Error('synthetic response write failure');
          const row = rows[0];
          if (row) {
            Object.assign(row, update?.$set ?? {});
            for (const [key, n] of Object.entries(update?.$inc ?? {}))
              row[key] = Number(row[key] ?? 0) + Number(n);
            for (const key of Object.keys(update?.$unset ?? {}))
              delete row[key];
          }
          return Promise.resolve({
            matchedCount: row ? 1 : 0,
            modifiedCount: row ? 1 : 0,
          });
        },
      };
      return q;
    }
    const insert = (rows: Row[], options: unknown) => {
      calls.push({
        table: name,
        action: 'insert',
        filter: structuredClone(rows),
        options,
      });
      if (name === 'notification_push_attempts' && flags.failAttempt)
        throw new Error('synthetic attempt insert failure');
      for (const row of rows) {
        if (table.has(row._id as string))
          throw Object.assign(new Error('duplicate'), { code: 11000 });
        table.set(row._id as string, structuredClone(row));
      }
      return Promise.resolve(rows);
    };
    return {
      db: connection,
      find: (f: Row) => query('find', f),
      findOne: (f: Row) => query('findOne', f),
      findById: (key: string) => query('findOne', { _id: key }),
      updateOne: (f: Row, u: Row, o: unknown) => query('updateOne', f, u, o),
      deleteOne: (f: Row, o: unknown) => query('deleteOne', f, undefined, o),
      insertMany: insert,
      create: insert,
    };
  });
  const store = new MongoNotificationPush(
    ...(models as unknown as ConstructorParameters<
      typeof MongoNotificationPush
    >),
  );
  const send = jest
    .fn<Promise<PushOutcome>, [unknown]>()
    .mockResolvedValue('ACCEPTED');
  const processor = new NotificationPushProcessor(
    store,
    { send },
    { maxAttempts: 3, delayMs: 30000 },
    () => now,
  );
  const seedDevice = (
    n = 10,
    userId = otpActor,
    revision = 1,
    token = `synthetic-token-${n}`,
  ) => {
    const row = {
      _id: id(n),
      userId,
      revision,
      token,
      tokenHash: pushHash(token),
      state: 'ACTIVE',
      provider: 'FCM',
      platform: 'ANDROID',
      keyHash: pushHash('key'),
      updatedAt: now.toISOString(),
      lastOperationId: id(99),
      lastOperationHash: pushHash('op'),
    };
    tables.notification_devices.set(row._id, row);
    tables.notification_device_tokens.set(row.tokenHash, {
      _id: row.tokenHash,
      installationId: row._id,
      revision,
    });
    return row;
  };
  tables.notification_outbox.set(id(1), {
    _id: id(1),
    notificationId: id(2),
    transferId: id(3),
    userId: otpActor,
    status: 'PENDING',
    attempts: 0,
    revision: 0,
    pushProtocol: PUSH_PROTOCOL,
    createdAt: now.toISOString(),
  });
  tables.notifications.set(id(2), {
    _id: id(2),
    userId: otpActor,
    transferId: id(3),
    type: 'TRANSFER_REQUEST_RECEIVED',
    title: 'Private title',
    text: 'Private text',
    itemIds: [id(4)],
    createdAt: now.toISOString(),
  });
  seedDevice();
  return {
    tables,
    flags,
    calls,
    models: models as unknown as Model<unknown>[],
    connection,
    session,
    store,
    processor,
    send,
    seedDevice,
    advance: (ms = 30000) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
