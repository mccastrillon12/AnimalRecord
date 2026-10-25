import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnimalMediaUploads } from '../../context/animal-media/application/animal-media-uploads';
import {
  ANIMAL_MEDIA_UPLOAD_MODEL,
  AnimalMediaUploadSchema,
  MongoAnimalMediaUploadRepository,
} from '../../context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import { AwsAnimalMediaUploadStorage } from '../../context/animal-media/infrastructure/aws-animal-media-upload-storage';
import { AwsS3StorageService } from '../../context/shared/infrastructure/storage/aws-s3-storage.service';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import { LegacyAnimalMediaMigration } from '../../context/animal-media/application/legacy-animal-media-migration';
import { LegacyAnimalMediaCopier } from '../../context/animal-media/application/legacy-animal-media-copier';
import {
  LEGACY_MEDIA_MIGRATION_MODEL,
  LegacyMediaMigrationSchema,
  MongoLegacyMediaMigrationRepository,
} from '../../context/animal-media/infrastructure/mongo-legacy-media-migration-repository';
import {
  AnimalEntity,
  AnimalSchema,
} from '../../context/animal/infrastructure/persistence/mongo/animal.schema';
import {
  DiaryEntryEntity,
  DiaryEntrySchema,
} from '../../context/diary/infrastructure/persistence/mongo/diary-entry.schema';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';

@Module({
  imports: [
    EnvironmentConfigModule,
    MongooseModule.forFeature([
      { name: ANIMAL_MEDIA_UPLOAD_MODEL, schema: AnimalMediaUploadSchema },
      {
        name: LEGACY_MEDIA_MIGRATION_MODEL,
        schema: LegacyMediaMigrationSchema,
      },
      { name: AnimalEntity.name, schema: AnimalSchema },
      { name: DiaryEntryEntity.name, schema: DiaryEntrySchema },
      {
        name: AnimalOwnershipControlEntity.name,
        schema: AnimalOwnershipControlSchema,
      },
      {
        name: AnimalOwnershipPeriodEntity.name,
        schema: AnimalOwnershipPeriodSchema,
      },
    ]),
  ],
  providers: [
    AnimalMediaUploads,
    LegacyAnimalMediaMigration,
    {
      provide: 'LegacyMediaMigrationRepository',
      useClass: MongoLegacyMediaMigrationRepository,
    },
    { provide: 'LegacyMediaCopier', useClass: LegacyAnimalMediaCopier },
    AwsS3StorageService,
    {
      provide: 'AnimalMediaUploadRepository',
      useClass: MongoAnimalMediaUploadRepository,
    },
    {
      provide: 'AnimalMediaUploadStorage',
      useClass: AwsAnimalMediaUploadStorage,
    },
  ],
  exports: [AnimalMediaUploads, LegacyAnimalMediaMigration],
})
export class AnimalMediaModule {}
