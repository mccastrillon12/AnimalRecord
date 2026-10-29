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

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: TRANSFER_NOTICE_MODEL, schema: TransferNoticeSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    Notifications,
    { provide: 'NotificationStore', useClass: MongoNotifications },
  ],
})
export class NotificationModule {}
