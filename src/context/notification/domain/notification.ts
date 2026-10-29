export const NOTIFICATION_TYPES = [
  'TRANSFER_REQUEST_SENT',
  'TRANSFER_REQUEST_RECEIVED',
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
  list(
    userId: string,
    limit: number,
    after?: NotificationAfter,
  ): Promise<NotificationRecord[]>;
  unreadCount(userId: string): Promise<number>;
  markRead(
    userId: string,
    id: string,
    at: string,
  ): Promise<NotificationRecord | null>;
}
