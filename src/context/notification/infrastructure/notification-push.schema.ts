import { Schema } from 'mongoose';
import { PushAttempt, PushDelivery } from '../domain/notification-push';
export const PUSH_DELIVERY_MODEL = 'NotificationPushDelivery';
export const PUSH_ATTEMPT_MODEL = 'NotificationPushAttempt';
const id = { type: String, required: true };
const outcomes = [
  'ACCEPTED',
  'INVALID_TOKEN',
  'RETRYABLE_REJECTION',
  'PERMANENT_REJECTION',
  'UNKNOWN',
];
const options = (collection: string) => ({
  collection,
  autoCreate: false,
  autoIndex: false,
  versionKey: false as const,
});
export const PushDeliverySchema = new Schema<PushDelivery>(
  {
    _id: id,
    outboxId: id,
    notificationId: id,
    transferId: id,
    userId: id,
    installationId: id,
    deviceRevision: { type: Number, required: true },
    tokenHash: id,
    state: {
      type: String,
      enum: ['READY', 'MAY_SEND', 'SKIPPED', 'RECORDED'],
      required: true,
    },
    attempts: { type: Number, required: true },
    nextAttemptAt: id,
    attemptId: String,
    outcome: { type: String, enum: outcomes },
  },
  options('notification_push_deliveries'),
);
PushDeliverySchema.index({ state: 1, nextAttemptAt: 1, _id: 1 });
export const PushAttemptSchema = new Schema<PushAttempt>(
  {
    _id: id,
    deliveryId: id,
    ordinal: { type: Number, required: true },
    state: { type: String, enum: ['MAY_SEND', 'RESPONDED'], required: true },
    grantedAt: id,
    respondedAt: String,
    outcome: { type: String, enum: outcomes },
  },
  options('notification_push_attempts'),
);
PushAttemptSchema.index({ deliveryId: 1, ordinal: 1 }, { unique: true });
