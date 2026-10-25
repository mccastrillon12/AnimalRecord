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

@Module({
  imports: [
    EnvironmentConfigModule,
    MongooseModule.forFeature([
      { name: ANIMAL_MEDIA_UPLOAD_MODEL, schema: AnimalMediaUploadSchema },
    ]),
  ],
  providers: [
    AnimalMediaUploads,
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
  exports: [AnimalMediaUploads],
})
export class AnimalMediaModule {}
