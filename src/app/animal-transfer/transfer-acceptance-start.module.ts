import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Schema } from 'mongoose';
import { TransferAcceptanceStart } from '../../context/animal-transfer/application/transfer-acceptance-start';
import { AcceptanceArchiveKeyResolver } from '../../context/animal-transfer/domain/transfer-acceptance-start';
import { MongoTransferAcceptanceStart } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-acceptance-start';
import { MongoOwnershipArchiveHistory } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { MongoTransferItemCapture } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import {
  TRANSFER_REQUEST_MODEL,
  TRANSFER_REQUEST_ITEM_MODEL,
  TRANSFER_REQUEST_CLAIM_MODEL,
  TRANSFER_EVENT_MODEL,
  TransferRequestSchema,
  TransferRequestItemSchema,
  TransferRequestClaimSchema,
  TransferEventSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import {
  AnimalEntity,
  AnimalSchema,
} from '../../context/animal/infrastructure/persistence/mongo/animal.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import {
  MedicalDocumentEntity,
  MedicalDocumentSchema,
} from '../../context/medical-document/infrastructure/persistence/mongo/medical-document.schema';
import {
  DiaryEntryEntity,
  DiaryEntrySchema,
} from '../../context/diary/infrastructure/persistence/mongo/diary-entry.schema';
import {
  UserEntity,
  UserSchema,
} from '../../context/user/infrastructure/persistence/mongo/user.schema';
import {
  ANIMAL_MEDIA_UPLOAD_MODEL,
  AnimalMediaUploadSchema,
} from '../../context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
  OwnershipArchiveSchema,
  OwnershipArchiveEntrySchema,
  OwnershipArchiveFileSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import {
  ITEM_COPY_RECORD_MODEL,
  ItemCopyRecordSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/transfer-item-copy-record.schema';
import {
  OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
  OwnershipArchiveMediaRegistrationSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-media-registration.schema';

/** Outside the app graph. Explicit pure bucket/origin resolver required. No SDK. */
@Module({})
export class TransferAcceptanceStartModule {
  static register(
    keys: AcceptanceArchiveKeyResolver,
    options?: Readonly<{ publishedHistory: true }>,
  ): DynamicModule {
    if (!keys || typeof keys.keyFromUrl !== 'function')
      throw new Error('A pure archive key resolver is required');
    const publishedHistory = options?.publishedHistory === true;
    const models: Array<{ name: string; schema: Schema }> = [
      { name: TRANSFER_REQUEST_MODEL, schema: TransferRequestSchema },
      { name: TRANSFER_REQUEST_ITEM_MODEL, schema: TransferRequestItemSchema },
      {
        name: TRANSFER_REQUEST_CLAIM_MODEL,
        schema: TransferRequestClaimSchema,
      },
      { name: TRANSFER_EVENT_MODEL, schema: TransferEventSchema },
      { name: AnimalEntity.name, schema: AnimalSchema },
      {
        name: AnimalOwnershipControlEntity.name,
        schema: AnimalOwnershipControlSchema,
      },
      {
        name: AnimalOwnershipPeriodEntity.name,
        schema: AnimalOwnershipPeriodSchema,
      },
      { name: MedicalDocumentEntity.name, schema: MedicalDocumentSchema },
      { name: DiaryEntryEntity.name, schema: DiaryEntrySchema },
      { name: ANIMAL_MEDIA_UPLOAD_MODEL, schema: AnimalMediaUploadSchema },
      { name: OWNERSHIP_ARCHIVE_MODEL, schema: OwnershipArchiveSchema },
      { name: UserEntity.name, schema: UserSchema },
      ...(publishedHistory
        ? [
            {
              name: OWNERSHIP_ARCHIVE_ENTRY_MODEL,
              schema: OwnershipArchiveEntrySchema,
            },
            {
              name: OWNERSHIP_ARCHIVE_FILE_MODEL,
              schema: OwnershipArchiveFileSchema,
            },
            { name: ITEM_COPY_RECORD_MODEL, schema: ItemCopyRecordSchema },
            {
              name: OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
              schema: OwnershipArchiveMediaRegistrationSchema,
            },
          ]
        : []),
    ].map(({ name, schema }) => {
      const cloned = schema.clone();
      cloned.set('autoCreate', false);
      cloned.set('autoIndex', false);
      return { name, schema: cloned };
    });
    return {
      module: TransferAcceptanceStartModule,
      imports: [MongooseModule.forFeature(models)],
      providers: [
        TransferAcceptanceStart,
        {
          provide: 'AcceptanceStartStore',
          useClass: MongoTransferAcceptanceStart,
        },
        {
          provide: 'AcceptanceArchiveKeyResolver',
          useValue: Object.freeze({ keyFromUrl: keys.keyFromUrl.bind(keys) }),
        },
        ...(publishedHistory
          ? [
              {
                provide: 'AcceptancePublishedHistory',
                useClass: MongoOwnershipArchiveHistory,
              },
              {
                provide: 'PublishedOwnershipPredecessor',
                useClass: MongoTransferItemCapture,
              },
            ]
          : []),
      ],
      exports: [TransferAcceptanceStart],
    };
  }
}
