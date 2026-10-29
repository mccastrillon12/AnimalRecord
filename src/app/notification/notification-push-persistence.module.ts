import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TRANSFER_NOTICE_MODEL,
  TRANSFER_OUTBOX_MODEL,
  TransferNoticeSchema,
  TransferOutboxSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  NOTIFICATION_DEVICE_MODEL,
  NOTIFICATION_DEVICE_TOKEN_MODEL,
  NotificationDeviceSchema,
  NotificationDeviceTokenSchema,
} from '../../context/notification/infrastructure/mongo-notification-devices';
import { MongoNotificationPush } from '../../context/notification/infrastructure/mongo-notification-push';
import {
  PUSH_ATTEMPT_MODEL,
  PUSH_DELIVERY_MODEL,
  PushAttemptSchema,
  PushDeliverySchema,
} from '../../context/notification/infrastructure/notification-push.schema';

// Deliberately outside the application graph. Importing this module later still
// supplies persistence only: no provider, scheduler or dispatch side effect.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TRANSFER_OUTBOX_MODEL, schema: TransferOutboxSchema },
      { name: TRANSFER_NOTICE_MODEL, schema: TransferNoticeSchema },
      { name: NOTIFICATION_DEVICE_MODEL, schema: NotificationDeviceSchema },
      {
        name: NOTIFICATION_DEVICE_TOKEN_MODEL,
        schema: NotificationDeviceTokenSchema,
      },
      { name: PUSH_DELIVERY_MODEL, schema: PushDeliverySchema },
      { name: PUSH_ATTEMPT_MODEL, schema: PushAttemptSchema },
    ]),
  ],
  providers: [
    { provide: 'NotificationPushStore', useClass: MongoNotificationPush },
  ],
  exports: ['NotificationPushStore'],
})
export class NotificationPushPersistenceModule {}
