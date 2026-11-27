import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, mongo } from 'mongoose';
import { TRANSFER_NOTICE_MODEL } from '../../animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  NOTIFICATION_TYPES,
  NotificationAfter,
  NotificationRecord,
  NotificationStore,
} from '../domain/notification';

const projection = {
  _id: 1,
  userId: 1,
  transferId: 1,
  type: 1,
  itemIds: 1,
  title: 1,
  text: 1,
  createdAt: 1,
  readAt: 1,
};

const receiptCollection = 'notification_read_all_operations';
type ReadAllReceipt = { _id: string; cutoffAt: string };

@Injectable()
export class MongoNotifications implements NotificationStore, OnModuleInit {
  private readonly logger = new Logger(MongoNotifications.name);
  private readAllReceipts?: mongo.Collection<ReadAllReceipt>;

  constructor(
    @InjectModel(TRANSFER_NOTICE_MODEL)
    private readonly notices: Model<NotificationRecord>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const db = this.notices.db?.db;
      if (!db) throw new Error('Notification database is unavailable');
      const list = () =>
        db
          .listCollections(
            { name: receiptCollection },
            { nameOnly: false, readPreference: 'primary', maxTimeMS: 5000 },
          )
          .toArray();
      let [entry] = await list();
      if (!entry) {
        try {
          await db.createCollection(receiptCollection, { timeoutMS: 5000 });
        } catch (error) {
          if (!(error instanceof mongo.MongoServerError) || error.code !== 48)
            throw error;
        }
        [entry] = await list();
      }
      if (
        entry?.type !== 'collection' ||
        entry.options?.capped === true ||
        entry.options?.timeseries
      )
        throw new Error('Notification read-all storage is incompatible');
      this.readAllReceipts = db.collection<ReadAllReceipt>(receiptCollection);
    } catch {
      this.logger.warn('notification-read-all-storage-preparation-failed');
    }
  }
  async findOwned(
    userId: string,
    id: string,
  ): Promise<NotificationRecord | null> {
    try {
      return await this.notices
        .findOne({ _id: id, userId, type: { $in: [...NOTIFICATION_TYPES] } })
        .select(projection)
        .read('primary')
        .readConcern('majority')
        .maxTimeMS(5000)
        .lean()
        .exec();
    } catch {
      throw new ServiceUnavailableException('Notification could not be loaded');
    }
  }
  async list(
    userId: string,
    limit: number,
    after?: NotificationAfter,
  ): Promise<NotificationRecord[]> {
    try {
      return await this.notices
        .find({
          userId,
          type: { $in: [...NOTIFICATION_TYPES] },
          ...(after
            ? {
                $or: [
                  { createdAt: { $lt: after.at } },
                  { createdAt: after.at, _id: { $lt: after.id } },
                ],
              }
            : {}),
        })
        .select(projection)
        .read('primary')
        .readConcern('majority')
        .collation({ locale: 'simple' })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .maxTimeMS(5000)
        .lean()
        .exec();
    } catch {
      throw new ServiceUnavailableException(
        'Notifications could not be loaded',
      );
    }
  }
  async unreadCount(userId: string): Promise<number> {
    try {
      return await this.notices
        .countDocuments({
          userId,
          type: { $in: [...NOTIFICATION_TYPES] },
          readAt: null,
        })
        .read('primary')
        .readConcern('majority')
        .maxTimeMS(5000)
        .exec();
    } catch {
      throw new ServiceUnavailableException(
        'Unread notification count could not be loaded',
      );
    }
  }
  async markAllRead(
    userId: string,
    operationId: string,
    at: string,
  ): Promise<void> {
    const receipts = this.readAllReceipts;
    if (!receipts)
      throw new ServiceUnavailableException(
        'Notification read-all storage must be prepared before use',
      );
    const _id = `${userId}:${operationId}`;
    let session: ClientSession | undefined;
    try {
      const active = await this.notices.db.startSession();
      session = active;
      await active.withTransaction(
        async () => {
          const prior = await receipts.findOne(
            { _id },
            { session: active, projection: { _id: 1 } },
          );
          if (prior) return;
          const receipt = await receipts.insertOne(
            { _id, cutoffAt: at },
            { session: active },
          );
          const changed = await this.notices
            .updateMany(
              {
                userId,
                type: { $in: [...NOTIFICATION_TYPES] },
                readAt: null,
                createdAt: { $lte: at },
              },
              { $set: { readAt: at } },
              {
                session: active,
                upsert: false,
                collation: { locale: 'simple' },
              },
            )
            .exec();
          if (!receipt.acknowledged || !changed.acknowledged)
            throw new Error(
              'Notification read-all writes were not acknowledged',
            );
        },
        {
          readPreference: 'primary',
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority', wtimeoutMS: 10000 },
          timeoutMS: 15000,
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Notification read-all could not be confirmed; retry with the same Idempotency-Key',
      );
    } finally {
      // Session cleanup cannot change an acknowledged transaction outcome.
      await session?.endSession().catch(() => undefined);
    }
  }
  async markRead(
    userId: string,
    id: string,
    at: string,
  ): Promise<NotificationRecord | null> {
    const owned = { _id: id, userId, type: { $in: [...NOTIFICATION_TYPES] } };
    try {
      const changed = await this.notices
        .findOneAndUpdate(
          { ...owned, readAt: null },
          { $set: { readAt: at } },
          {
            new: true,
            upsert: false,
            writeConcern: { w: 'majority', wtimeout: 10000 },
            maxTimeMS: 5000,
          },
        )
        .select(projection)
        .lean()
        .exec();
      if (changed) return changed;
      // A normal zero match can be a prior reader. Never extend a lost write reply into success.
      return await this.notices
        .findOne(owned)
        .select(projection)
        .read('primary')
        .readConcern('majority')
        .maxTimeMS(5000)
        .lean()
        .exec();
    } catch {
      throw new ServiceUnavailableException(
        'Notification read state could not be confirmed; retry the same notification',
      );
    }
  }
}
