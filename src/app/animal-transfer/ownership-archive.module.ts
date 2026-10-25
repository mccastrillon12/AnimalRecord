import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnimalModule } from '../animal/animal.module';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import { AwsS3StorageService } from '../../context/shared/infrastructure/storage/aws-s3-storage.service';
import { OwnershipArchivePreparer } from '../../context/animal-transfer/application/ownership-archive-preparer';
import { MongoOwnershipArchiveRepository } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-repository';
import { AwsOwnershipArchiveStorage } from '../../context/animal-transfer/infrastructure/storage/aws-ownership-archive-storage';
import {
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
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
    EnvironmentConfigModule,
    MongooseModule.forFeature([
      { name: OWNERSHIP_ARCHIVE_MODEL, schema: OwnershipArchiveSchema },
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
    OwnershipArchivePreparer,
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
  exports: [OwnershipArchivePreparer],
})
export class OwnershipArchiveModule {}
