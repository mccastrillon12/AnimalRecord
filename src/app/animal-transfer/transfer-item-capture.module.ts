import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransferItemCapture } from '../../context/animal-transfer/application/transfer-item-capture';
import { OwnershipArchiveCapture } from '../../context/animal-transfer/application/ownership-archive-capture';
import { MongoTransferItemCapture } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import {
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
  TransferRequestSchema,
  TransferRequestItemSchema,
  TransferRequestClaimSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OwnershipArchiveSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';

/** Explicit provider composition only. Not imported by the app; no SDK/bootstrap/worker. */
@Module({})
export class TransferItemCaptureModule {
  static register(
    capture: Pick<OwnershipArchiveCapture, 'captureBatch'>,
  ): DynamicModule {
    if (!capture || typeof capture.captureBatch !== 'function')
      throw new Error('An explicit bound capture provider is required');
    const models = [
      { name: TRANSFER_REQUEST_MODEL, schema: TransferRequestSchema },
      { name: TRANSFER_REQUEST_ITEM_MODEL, schema: TransferRequestItemSchema },
      {
        name: TRANSFER_REQUEST_CLAIM_MODEL,
        schema: TransferRequestClaimSchema,
      },
      { name: OWNERSHIP_ARCHIVE_MODEL, schema: OwnershipArchiveSchema },
      {
        name: AnimalOwnershipControlEntity.name,
        schema: AnimalOwnershipControlSchema,
      },
      {
        name: AnimalOwnershipPeriodEntity.name,
        schema: AnimalOwnershipPeriodSchema,
      },
    ].map(({ name, schema }) => {
      const cloned = schema.clone();
      cloned.set('autoCreate', false);
      cloned.set('autoIndex', false);
      return { name, schema: cloned };
    });
    return {
      module: TransferItemCaptureModule,
      imports: [MongooseModule.forFeature(models)],
      providers: [
        TransferItemCapture,
        { provide: 'ItemCaptureStore', useClass: MongoTransferItemCapture },
        {
          provide: 'ItemCaptureBatch',
          useValue: Object.freeze({
            captureBatch: capture.captureBatch.bind(capture),
          }),
        },
      ],
      exports: [TransferItemCapture],
    };
  }
}
