import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransferOtpModule } from './transfer-otp.module';
import {
  TRANSFER_ACCEPTANCE_DECISION,
  TRANSFER_ITEM_PHOTO_STORAGE,
  TransferRequests,
} from '../../context/animal-transfer/application/transfer-requests';
import { TransferAcceptanceExecution } from '../../context/animal-transfer/application/transfer-acceptance-execution';
import { MongoTransferRequests } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-requests';
import { TRANSFER_REQUEST_MODELS } from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  AnimalEntity,
  AnimalSchema,
} from '../../context/animal/infrastructure/persistence/mongo/animal.schema';
import {
  UserEntity,
  UserSchema,
} from '../../context/user/infrastructure/persistence/mongo/user.schema';
import {
  AnimalTransferReasonEntity,
  AnimalTransferReasonSchema,
} from '../../context/catalogs/infrastructure/persistence/mongo/catalogs.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import { AwsS3StorageService } from '../../context/shared/infrastructure/storage/aws-s3-storage.service';
@Module({
  imports: [
    TransferOtpModule,
    EnvironmentConfigModule,
    MongooseModule.forFeature([
      ...TRANSFER_REQUEST_MODELS,
      { name: AnimalEntity.name, schema: AnimalSchema },
      { name: UserEntity.name, schema: UserSchema },
      {
        name: AnimalTransferReasonEntity.name,
        schema: AnimalTransferReasonSchema,
      },
      {
        name: AnimalOwnershipControlEntity.name,
        schema: AnimalOwnershipControlSchema,
      },
    ]),
  ],
  providers: [
    TransferRequests,
    { provide: TRANSFER_ITEM_PHOTO_STORAGE, useClass: AwsS3StorageService },
    { provide: 'TransferRequestStore', useClass: MongoTransferRequests },
  ],
  exports: [TransferRequests],
})
export class TransferRequestsModule {
  static withAcceptance(runtime: DynamicModule): DynamicModule {
    return {
      module: TransferRequestsModule,
      imports: [runtime],
      providers: [
        TransferAcceptanceExecution,
        {
          provide: TRANSFER_ACCEPTANCE_DECISION,
          useExisting: TransferAcceptanceExecution,
        },
      ],
    };
  }
}
