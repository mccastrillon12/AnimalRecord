import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AnimalEntity,
  AnimalSchema,
} from '../../context/animal/infrastructure/persistence/mongo/animal.schema';
import { MongoAnimalRepository } from '../../context/animal/infrastructure/persistence/mongo/mongo-animal-repository';
import { AnimalCreator } from '../../context/animal/application/creator/animal-creator';
import { AnimalFinder } from '../../context/animal/application/finder/animal-finder';
import { AnimalFinderAll } from '../../context/animal/application/finder-all/animal-finder-all';
import { AnimalFinderByOwner } from '../../context/animal/application/finder-by-owner/animal-finder-by-owner';
import { AnimalUpdater } from '../../context/animal/application/updater/animal-updater';
import { AnimalController } from './animal.controller';
import {
  CounterEntity,
  CounterSchema,
} from '../../context/shared/infrastructure/persistence/mongo/counter.schema';
import { MongoCounterRepository } from '../../context/shared/infrastructure/persistence/mongo/mongo-counter-repository';
import { AnimalCodeGenerator } from '../../context/animal/application/generators/animal-code-generator';
import { GenerateAnimalProfilePictureUploadUrlUseCase } from '../../context/animal/application/profile-picture/generate-animal-profile-picture-upload-url.usecase';
import { UpdateAnimalProfilePictureUseCase } from '../../context/animal/application/profile-picture/update-animal-profile-picture.usecase';
import { AwsS3StorageService } from '../../context/shared/infrastructure/storage/aws-s3-storage.service';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import { AnimalFinderWithFilters } from '../../context/animal/application/finder-with-filters/animal-finder-with-filters';

import { AuthModule } from '../auth/auth.module';
import { AnimalAccessPolicy } from '../../context/animal/application/animal-access-policy';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { MongoAnimalOwnershipRepository } from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import { AnimalOwnershipInitializer } from '../../context/animal-transfer/application/animal-ownership-initializer';
import { AnimalWriteCoordinator } from '../../context/animal-transfer/application/animal-write-coordinator';
import { AnimalMediaModule } from '../animal-media/animal-media.module';
import { AnimalWriteJournalModule } from '../animal-transfer/animal-write-journal.module';
import { AnimalWriteRecovery } from '../../context/animal-transfer/application/animal-write-recovery';

@Module({
  imports: [
    AnimalWriteJournalModule,
    AnimalMediaModule,
    MongooseModule.forFeature([
      { name: AnimalEntity.name, schema: AnimalSchema },
      { name: CounterEntity.name, schema: CounterSchema },
      {
        name: AnimalOwnershipPeriodEntity.name,
        schema: AnimalOwnershipPeriodSchema,
      },
      {
        name: AnimalOwnershipControlEntity.name,
        schema: AnimalOwnershipControlSchema,
      },
    ]),
    AuthModule,
    EnvironmentConfigModule,
  ],
  controllers: [AnimalController],
  providers: [
    {
      provide: 'AnimalRepository',
      useClass: MongoAnimalRepository,
    },
    AnimalCreator,
    AnimalAccessPolicy,
    AnimalWriteCoordinator,
    AnimalWriteRecovery,
    AnimalOwnershipInitializer,
    {
      provide: 'AnimalOwnershipRepository',
      useClass: MongoAnimalOwnershipRepository,
    },
    AnimalFinder,
    AnimalFinderAll,
    AnimalFinderByOwner,
    AnimalUpdater,
    AnimalFinderWithFilters,
    MongoCounterRepository,
    AnimalCodeGenerator,
    {
      provide: 'IStorageService',
      useClass: AwsS3StorageService,
    },
    GenerateAnimalProfilePictureUploadUrlUseCase,
    UpdateAnimalProfilePictureUseCase,
  ],
  exports: [
    AnimalWriteJournalModule,
    AnimalWriteCoordinator,
    AnimalWriteRecovery,
    AnimalAccessPolicy,
    AnimalCreator,
    AnimalFinder,
    AnimalFinderAll,
    AnimalFinderByOwner,
    AnimalUpdater,
    AnimalFinderWithFilters,
    'AnimalRepository',
    'AnimalOwnershipRepository',
  ],
})
export class AnimalModule {}
