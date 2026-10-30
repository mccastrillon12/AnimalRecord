import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransferAcceptancePreparation } from '../../context/animal-transfer/application/transfer-acceptance-preparation';
import { MongoTransferAcceptancePreparation } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-acceptance-preparation';
import {
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
  TransferRequestSchema,
  TransferRequestItemSchema,
  TransferRequestClaimSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import {
  AnimalEntity,
  AnimalSchema,
} from '../../context/animal/infrastructure/persistence/mongo/animal.schema';
import {
  MedicalDocumentEntity,
  MedicalDocumentSchema,
} from '../../context/medical-document/infrastructure/persistence/mongo/medical-document.schema';
import { Schema } from 'mongoose';
const readOnly = (schema: Schema) => {
  const cloned = schema.clone();
  cloned.set('autoCreate', false);
  cloned.set('autoIndex', false);
  return cloned;
};
/** Not imported by the app. Explicit observation module, no capture/lock/copy providers. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TRANSFER_REQUEST_MODEL, schema: readOnly(TransferRequestSchema) },
      {
        name: TRANSFER_REQUEST_ITEM_MODEL,
        schema: readOnly(TransferRequestItemSchema),
      },
      {
        name: TRANSFER_REQUEST_CLAIM_MODEL,
        schema: readOnly(TransferRequestClaimSchema),
      },
      { name: AnimalEntity.name, schema: readOnly(AnimalSchema) },
      {
        name: AnimalOwnershipControlEntity.name,
        schema: readOnly(AnimalOwnershipControlSchema),
      },
      {
        name: AnimalOwnershipPeriodEntity.name,
        schema: readOnly(AnimalOwnershipPeriodSchema),
      },
      {
        name: MedicalDocumentEntity.name,
        schema: readOnly(MedicalDocumentSchema),
      },
    ]),
  ],
  providers: [
    TransferAcceptancePreparation,
    {
      provide: 'AcceptancePreparationStore',
      useClass: MongoTransferAcceptancePreparation,
    },
  ],
  exports: [TransferAcceptancePreparation],
})
export class TransferAcceptancePreparationModule {}
