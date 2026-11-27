import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EnvironmentConfigModule } from './context/shared/infrastructure/config/environment/environment.module';
import { EnvironmentConfigService } from './context/shared/infrastructure/config/environment/environment.service';
import { UserModule } from './app/user/user.module';
import { AuthModule } from './app/auth/auth.module';
import { AnimalModule } from './app/animal/animal.module';
import { LocationModule } from './app/location/location.module';
import { MobileModule } from './app/mobile/mobile.module';
import { CatalogsModule } from './app/catalogs/catalogs.module';
import { DiaryModule } from './app/diary/diary.module';
import { MedicalDocumentModule } from './app/medical-document/medical-document.module';
import { AnimalTransferModule } from './app/animal-transfer/animal-transfer.module';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [EnvironmentConfigModule],
      useFactory: (configService: EnvironmentConfigService) => ({
        uri: configService.getMongoUri(),
        dbName: configService.getMongoDbName(),
      }),
      inject: [EnvironmentConfigService],
    }),
  ],
})
class ApplicationDatabaseModule {}

const applicationImports = [
  EnvironmentConfigModule,
  ApplicationDatabaseModule,
  UserModule,
  AuthModule,
  AnimalModule,
  LocationModule,
  MobileModule,
  CatalogsModule,
  DiaryModule,
  MedicalDocumentModule,
];

@Module({})
class AcceptanceAppModule {}

@Module({})
class PushAppModule {}

@Module({ imports: [...applicationImports, AnimalTransferModule] })
export class AppModule {
  static withTransferAcceptance(runtime: DynamicModule): DynamicModule {
    return {
      module: AcceptanceAppModule,
      imports: [
        ...applicationImports,
        AnimalTransferModule.withAcceptance(runtime),
      ],
    };
  }
  static withNotificationPush(
    push: DynamicModule,
    acceptance?: DynamicModule,
  ): DynamicModule {
    return {
      module: PushAppModule,
      imports: [
        ...applicationImports,
        acceptance
          ? AnimalTransferModule.withAcceptance(acceptance)
          : AnimalTransferModule,
        push,
      ],
    };
  }
}
