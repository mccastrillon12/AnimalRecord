import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TRANSFER_NOTICE_MODEL,
  TRANSFER_OUTBOX_MODEL,
  TRANSFER_REQUEST_MODEL,
  TransferNoticeSchema,
  TransferOutboxSchema,
  TransferRequestSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import { PUSH_ACTIVATION_FROM } from '../../context/notification/domain/notification-push';
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

// Supplies persistence only. The runtime mounts it with an explicit cutoff.
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
export class NotificationPushPersistenceModule {
  static withActivation(from: string): DynamicModule {
    return {
      module: NotificationPushPersistenceModule,
      imports: [
        MongooseModule.forFeature([
          { name: TRANSFER_REQUEST_MODEL, schema: TransferRequestSchema },
        ]),
      ],
      providers: [{ provide: PUSH_ACTIVATION_FROM, useValue: from }],
    };
  }
}
