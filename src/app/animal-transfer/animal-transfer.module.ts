import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { AnimalTransferController } from './animal-transfer.controller';
import { OwnershipArchiveModule } from './ownership-archive.module';
import { TransferOtpModule } from './transfer-otp.module';
import { TransferRequestsModule } from './transfer-requests.module';
import { NotificationModule } from '../notification/notification.module';
import { OwnershipHistoryController } from './ownership-history.controller';

const transferImports = [
  AuthModule,
  UserModule,
  OwnershipArchiveModule,
  TransferOtpModule,
  NotificationModule,
];

@Module({})
class AnimalTransferAcceptanceModule {}

@Module({
  imports: [...transferImports, TransferRequestsModule],
  controllers: [AnimalTransferController],
})
export class AnimalTransferModule {
  // The runtime exports acceptance start, item progress, and published history.
  static withAcceptance(runtime: DynamicModule): DynamicModule {
    return {
      module: AnimalTransferAcceptanceModule,
      imports: [
        ...transferImports,
        TransferRequestsModule.withAcceptance(runtime),
        runtime,
      ],
      controllers: [AnimalTransferController, OwnershipHistoryController],
    };
  }
}
