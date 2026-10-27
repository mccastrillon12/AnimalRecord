import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnimalWriteJournalModule } from '../animal-transfer/animal-write-journal.module';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import {
  ANIMAL_MEDIA_UPLOAD_MODEL,
  AnimalMediaUploadSchema,
} from '../../context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import {
  MEDIA_PROMOTION_RECORD_MODEL,
  MediaPromotionRecordSchema,
} from '../../context/animal-media/infrastructure/media-promotion-record.schema';
import { MongoMediaPromotionPersistence } from '../../context/animal-media/infrastructure/mongo-media-promotion-persistence';

/** Explicit opt-in module. Not imported by the current application graph. */
@Module({
  imports: [
    AnimalWriteJournalModule,
    MongooseModule.forFeature([
      {
        name: AnimalOwnershipControlEntity.name,
        schema: AnimalOwnershipControlSchema,
      },
      { name: ANIMAL_MEDIA_UPLOAD_MODEL, schema: AnimalMediaUploadSchema },
      {
        name: MEDIA_PROMOTION_RECORD_MODEL,
        schema: MediaPromotionRecordSchema,
      },
    ]),
  ],
  providers: [
    {
      provide: 'MediaPromotionPersistence',
      useClass: MongoMediaPromotionPersistence,
    },
  ],
  exports: ['MediaPromotionPersistence'],
})
export class MediaPromotionPersistenceModule {}
