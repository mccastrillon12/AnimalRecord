import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EnvironmentConfigModule } from './context/shared/infrastructure/config/environment/environment.module';
import { EnvironmentConfigService } from './context/shared/infrastructure/config/environment/environment.service';
import { UserModule } from './app/user/user.module';
import { AuthModule } from './app/auth/auth.module';

@Module({
  imports: [
    EnvironmentConfigModule,
    MongooseModule.forRootAsync({
      imports: [EnvironmentConfigModule],
      useFactory: (configService: EnvironmentConfigService) => ({
        uri: configService.getMongoUri(),
        dbName: configService.getMongoDbName(),
      }),
      inject: [EnvironmentConfigService],
    }),
    UserModule,
    AuthModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
