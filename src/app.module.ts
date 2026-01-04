import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EnvironmentConfigModule } from './context/shared/infrastructure/config/environment/environment.module';
import { EnvironmentConfigService } from './context/shared/infrastructure/config/environment/environment.service';
import { UserModule } from './app/user/user.module';

@Module({
  imports: [
    EnvironmentConfigModule,
    MongooseModule.forRootAsync({
      imports: [EnvironmentConfigModule],
      useFactory: async (configService: EnvironmentConfigService) => ({
        uri: configService.getMongooseURI(),
        dbName: configService.getMongooseDBName(),
      }),
      inject: [EnvironmentConfigService],
    }),
    UserModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
