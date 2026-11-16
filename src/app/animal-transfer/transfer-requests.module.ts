import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransferOtpModule } from './transfer-otp.module';
import { TransferRequests } from '../../context/animal-transfer/application/transfer-requests';
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
@Module({
  imports: [
    TransferOtpModule,
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
    { provide: 'TransferRequestStore', useClass: MongoTransferRequests },
  ],
  exports: [TransferRequests],
})
export class TransferRequestsModule {}
