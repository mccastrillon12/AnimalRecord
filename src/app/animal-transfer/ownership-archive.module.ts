import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnimalModule } from '../animal/animal.module';
import { AnimalMediaModule } from '../animal-media/animal-media.module';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import { AwsS3StorageService } from '../../context/shared/infrastructure/storage/aws-s3-storage.service';
import { OwnershipArchivePreparer } from '../../context/animal-transfer/application/ownership-archive-preparer';
import { OwnershipArchiveCapture } from '../../context/animal-transfer/application/ownership-archive-capture';
import { OwnershipArchiveHistoryImporter } from '../../context/animal-transfer/application/ownership-archive-history-importer';
import { OwnershipArchiveReferencePlanner } from '../../context/animal-transfer/application/ownership-archive-reference-planner';
import { OwnershipArchiveMaterializer } from '../../context/animal-transfer/application/ownership-archive-materializer';
import { OwnershipArchiveMediaRegistrar } from '../../context/animal-transfer/application/ownership-archive-media-registrar';
import { OwnershipArchiveMetadataRevalidator } from '../../context/animal-transfer/application/ownership-archive-metadata-revalidator';
import { MongoOwnershipArchiveMetadataRevalidation } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-metadata-revalidation';
import {
  OWNERSHIP_ARCHIVE_METADATA_REVALIDATION_MODEL,
  OwnershipArchiveMetadataRevalidationSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-metadata-revalidation.schema';
import { MongoOwnershipArchiveMediaRegistration } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-media-registration';
import {
  OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
  OwnershipArchiveMediaRegistrationSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-media-registration.schema';
import { MongoOwnershipArchiveMaterialization } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-materialization';
import { AwsOwnershipArchiveMaterializationStorage } from '../../context/animal-transfer/infrastructure/storage/aws-ownership-archive-materialization-storage';
import { MongoOwnershipArchiveReferencePlan } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-reference-plan';
import { MongoOwnershipArchiveHistory } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { MongoOwnershipArchiveSource } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-source';
import {
  AnimalEntity,
  AnimalSchema,
} from '../../context/animal/infrastructure/persistence/mongo/animal.schema';
import {
  DiaryEntryEntity,
  DiaryEntrySchema,
} from '../../context/diary/infrastructure/persistence/mongo/diary-entry.schema';
import {
  MedicalDocumentEntity,
  MedicalDocumentSchema,
} from '../../context/medical-document/infrastructure/persistence/mongo/medical-document.schema';
import { MongoOwnershipArchiveRepository } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-repository';
import { AwsOwnershipArchiveStorage } from '../../context/animal-transfer/infrastructure/storage/aws-ownership-archive-storage';
import {
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
  OwnershipArchiveSchema,
  OwnershipArchiveEntrySchema,
  OwnershipArchiveFileSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';

@Module({
  imports: [
    AnimalModule,
    AnimalMediaModule,
    EnvironmentConfigModule,
    MongooseModule.forFeature([
      {
        name: OWNERSHIP_ARCHIVE_METADATA_REVALIDATION_MODEL,
        schema: OwnershipArchiveMetadataRevalidationSchema,
      },
      {
        name: OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL,
        schema: OwnershipArchiveMediaRegistrationSchema,
      },
      { name: AnimalEntity.name, schema: AnimalSchema },
      { name: DiaryEntryEntity.name, schema: DiaryEntrySchema },
      { name: MedicalDocumentEntity.name, schema: MedicalDocumentSchema },
      { name: OWNERSHIP_ARCHIVE_MODEL, schema: OwnershipArchiveSchema },
      {
        name: AnimalOwnershipControlEntity.name,
        schema: AnimalOwnershipControlSchema,
      },
      {
        name: OWNERSHIP_ARCHIVE_ENTRY_MODEL,
        schema: OwnershipArchiveEntrySchema,
      },
      {
        name: OWNERSHIP_ARCHIVE_FILE_MODEL,
        schema: OwnershipArchiveFileSchema,
      },
      {
        name: AnimalOwnershipPeriodEntity.name,
        schema: AnimalOwnershipPeriodSchema,
      },
    ]),
  ],
  providers: [
    OwnershipArchiveMetadataRevalidator,
    {
      provide: 'OwnershipArchiveMetadataRevalidationRepository',
      useClass: MongoOwnershipArchiveMetadataRevalidation,
    },
    OwnershipArchiveMediaRegistrar,
    {
      provide: 'OwnershipArchiveMediaRegistrationRepository',
      useClass: MongoOwnershipArchiveMediaRegistration,
    },
    OwnershipArchivePreparer,
    OwnershipArchiveCapture,
    OwnershipArchiveHistoryImporter,
    OwnershipArchiveReferencePlanner,
    OwnershipArchiveMaterializer,
    {
      provide: 'OwnershipArchiveMaterializationRepository',
      useClass: MongoOwnershipArchiveMaterialization,
    },
    {
      provide: 'OwnershipArchiveMaterializationStorage',
      useClass: AwsOwnershipArchiveMaterializationStorage,
    },
    {
      provide: 'OwnershipArchiveReferencePlanRepository',
      useClass: MongoOwnershipArchiveReferencePlan,
    },
    {
      provide: 'OwnershipArchiveHistoryRepository',
      useClass: MongoOwnershipArchiveHistory,
    },
    {
      provide: 'OwnershipArchiveSource',
      useClass: MongoOwnershipArchiveSource,
    },
    AwsS3StorageService,
    {
      provide: 'OwnershipArchiveRepository',
      useClass: MongoOwnershipArchiveRepository,
    },
    {
      provide: 'OwnershipArchiveStorage',
      useClass: AwsOwnershipArchiveStorage,
    },
  ],
  exports: [
    OwnershipArchiveMetadataRevalidator,
    OwnershipArchiveMediaRegistrar,
    OwnershipArchivePreparer,
    OwnershipArchiveCapture,
    OwnershipArchiveHistoryImporter,
    OwnershipArchiveReferencePlanner,
    OwnershipArchiveMaterializer,
  ],
})
export class OwnershipArchiveModule {}
