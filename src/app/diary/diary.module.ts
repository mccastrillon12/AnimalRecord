import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DiaryEntryEntity, DiaryEntrySchema } from '../../context/diary/infrastructure/persistence/mongo/diary-entry.schema';
import { MongoDiaryRepository } from '../../context/diary/infrastructure/persistence/mongo/mongo-diary-repository';
import { DiaryEntryCreator } from '../../context/diary/application/diary-entry-creator';
import { DiaryEntryFinder } from '../../context/diary/application/diary-entry-finder';
import { DiaryEntryUpdater } from '../../context/diary/application/diary-entry-updater';
import { DiaryEntryDeleter } from '../../context/diary/application/diary-entry-deleter';
import { DiaryAttachmentManager } from '../../context/diary/application/diary-attachment-manager';
import { DiaryController } from './diary.controller';
import { AwsS3StorageService } from '../../context/shared/infrastructure/storage/aws-s3-storage.service';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import { AnimalModule } from '../animal/animal.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: DiaryEntryEntity.name, schema: DiaryEntrySchema }
        ]),
        AuthModule,
        AnimalModule,
        EnvironmentConfigModule
    ],
    controllers: [DiaryController],
    providers: [
        {
            provide: 'DiaryRepository',
            useClass: MongoDiaryRepository
        },
        {
            provide: 'IStorageService',
            useClass: AwsS3StorageService
        },
        DiaryEntryCreator,
        DiaryEntryFinder,
        DiaryEntryUpdater,
        DiaryEntryDeleter,
        DiaryAttachmentManager
    ]
})
export class DiaryModule { }
