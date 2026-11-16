import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
@Injectable()
export class MongoNotifications implements NotificationStore {
  constructor(
    @InjectModel(TRANSFER_NOTICE_MODEL)
    private readonly notices: Model<NotificationRecord>,
  ) {}
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
