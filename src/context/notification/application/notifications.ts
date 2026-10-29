import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import {
  NOTIFICATION_TYPES,
  NotificationAfter,
  NotificationRecord,
  NotificationResponse,
  NotificationStore,
} from '../domain/notification';

const invalid = () =>
  new InvalidArgumentError('Invalid notification request or cursor');
const corrupt = () =>
  new ServiceUnavailableException('Notification data could not be verified');
const canonicalDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const encode = (userId: string, after: NotificationAfter) =>
  Buffer.from(JSON.stringify({ userId, ...after })).toString('base64url');
function decode(raw: string, userId: string): NotificationAfter {
  try {
    if (
      typeof raw !== 'string' ||
      raw.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(raw)
    )
      throw invalid();
    const value: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw invalid();
    const v = value as Record<string, unknown>;
    if (
      Object.keys(v).sort().join(',') !== 'at,id,userId' ||
      v.userId !== userId ||
      typeof v.id !== 'string' ||
      !isUuid(v.id) ||
      !canonicalDate(v.at)
    )
      throw invalid();
    const after = { at: v.at, id: v.id };
    if (encode(userId, after) !== raw) throw invalid();
    return after;
  } catch {
    throw invalid();
  }
}
function response(
  row: NotificationRecord,
  actorId: string,
): NotificationResponse {
  if (
    !row ||
    row.userId !== actorId ||
    !isUuid(row._id) ||
    !isUuid(row.transferId) ||
    !NOTIFICATION_TYPES.includes(row.type) ||
    !Array.isArray(row.itemIds) ||
    row.itemIds.some((id) => !isUuid(id)) ||
    new Set(row.itemIds).size !== row.itemIds.length ||
    typeof row.title !== 'string' ||
    typeof row.text !== 'string' ||
    !canonicalDate(row.createdAt) ||
    (row.readAt != null && !canonicalDate(row.readAt))
  )
    throw corrupt();
  return {
    id: row._id,
    transferId: row.transferId,
    type: row.type,
    itemIds: [...row.itemIds],
    title: row.title,
    text: row.text,
    createdAt: row.createdAt,
    ...(row.readAt != null ? { readAt: row.readAt } : {}),
  };
}
@Injectable()
export class Notifications {
  constructor(
    @Inject('NotificationStore') private readonly store: NotificationStore,
  ) {}
  async list(actorId: string, limit = 20, cursor?: string) {
    if (!isUuid(actorId) || !Number.isInteger(limit) || limit < 1 || limit > 50)
      throw invalid();
    const after = cursor === undefined ? undefined : decode(cursor, actorId);
    const rows = await this.store.list(actorId, limit + 1, after);
    if (!Array.isArray(rows) || rows.length > limit + 1) throw corrupt();
    const seen = new Set<string>();
    let previous = after;
    const projected = rows.map((row) => {
      const item = response(row, actorId);
      if (
        seen.has(item.id) ||
        (previous &&
          !(
            item.createdAt < previous.at ||
            (item.createdAt === previous.at && item.id < previous.id)
          ))
      )
        throw corrupt();
      seen.add(item.id);
      previous = { at: item.createdAt, id: item.id };
      return item;
    });
    const page = projected.slice(0, limit),
      last = page.at(-1);
    return {
      items: page,
      ...(projected.length > limit && last
        ? { nextCursor: encode(actorId, { at: last.createdAt, id: last.id }) }
        : {}),
    };
  }
  async unreadCount(actorId: string) {
    if (!isUuid(actorId)) throw invalid();
    const count = await this.store.unreadCount(actorId);
    if (!Number.isSafeInteger(count) || count < 0) throw corrupt();
    return { count };
  }
  async markRead(actorId: string, id: string) {
    if (!isUuid(actorId) || !isUuid(id)) throw invalid();
    const row = await this.store.markRead(
      actorId,
      id,
      new Date().toISOString(),
    );
    if (!row) throw new ResourceNotFoundError('Notification not found');
    const result = response(row, actorId);
    if (result.id !== id || !result.readAt) throw corrupt();
    return result;
  }
}
