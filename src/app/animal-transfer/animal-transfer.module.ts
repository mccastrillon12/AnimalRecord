import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { AnimalTransferController } from './animal-transfer.controller';
import { OwnershipArchiveModule } from './ownership-archive.module';
import { TransferOtpModule } from './transfer-otp.module';
import { TransferRequestsModule } from './transfer-requests.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    OwnershipArchiveModule,
    TransferOtpModule,
    TransferRequestsModule,
    NotificationModule,
  ],
  controllers: [AnimalTransferController],
})
export class AnimalTransferModule {}
