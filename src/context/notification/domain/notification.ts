export const NOTIFICATION_TYPES = [
  'TRANSFER_REQUEST_SENT',
  'TRANSFER_REQUEST_RECEIVED',
  'TRANSFER_REQUEST_REJECTED',
  'TRANSFER_ITEM_ACCEPTED',
  'ANIMAL_TRANSFER_PENDING',
  'ANIMAL_TRANSFER_RECEIVED',
  'ANIMAL_TRANSFER_ACCEPTED',
  'ANIMAL_TRANSFER_REJECTED',
  'ANIMAL_TRANSFER_RECIPIENT_ACCEPTED',
  'ANIMAL_TRANSFER_RECIPIENT_REJECTED',
  'ANIMAL_TRANSFER_MIXED_RESULT',
] as const;
export type NotificationRecord = {
  _id: string;
  userId: string;
  transferId: string;
  type: (typeof NOTIFICATION_TYPES)[number];
  itemIds: string[];
  title: string;
  text: string;
  createdAt: string;
  readAt?: string | null;
};
export type NotificationResponse = Omit<
  NotificationRecord,
  '_id' | 'userId'
> & { id: string };
export type NotificationAfter = { at: string; id: string };
export interface NotificationStore {
  findOwned(userId: string, id: string): Promise<NotificationRecord | null>;
  list(
    userId: string,
    limit: number,
    after?: NotificationAfter,
  ): Promise<NotificationRecord[]>;
  unreadCount(userId: string): Promise<number>;
  markAllRead(userId: string, operationId: string, at: string): Promise<void>;
  markRead(
    userId: string,
    id: string,
    at: string,
  ): Promise<NotificationRecord | null>;
}
