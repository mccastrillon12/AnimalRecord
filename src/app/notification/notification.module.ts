import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Notifications } from '../../context/notification/application/notifications';
import { MongoNotifications } from '../../context/notification/infrastructure/mongo-notifications';
import {
  TRANSFER_NOTICE_MODEL,
  TransferNoticeSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import { AuthModule } from '../auth/auth.module';
import { NotificationController } from './notification.controller';
import { NotificationDevices } from '../../context/notification/application/notification-devices';
import {
  MongoNotificationDevices,
  NOTIFICATION_DEVICE_MODEL,
  NOTIFICATION_DEVICE_TOKEN_MODEL,
  NotificationDeviceSchema,
  NotificationDeviceTokenSchema,
} from '../../context/notification/infrastructure/mongo-notification-devices';
import { NotificationDeviceController } from './notification-device.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: TRANSFER_NOTICE_MODEL, schema: TransferNoticeSchema },
      { name: NOTIFICATION_DEVICE_MODEL, schema: NotificationDeviceSchema },
      {
        name: NOTIFICATION_DEVICE_TOKEN_MODEL,
        schema: NotificationDeviceTokenSchema,
      },
    ]),
  ],
  controllers: [NotificationController, NotificationDeviceController],
  providers: [
    Notifications,
    { provide: 'NotificationStore', useClass: MongoNotifications },
    NotificationDevices,
    { provide: 'NotificationDeviceStore', useClass: MongoNotificationDevices },
  ],
})
export class NotificationModule {}
