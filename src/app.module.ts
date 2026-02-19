import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EnvironmentConfigModule } from './context/shared/infrastructure/config/environment/environment.module';
import { EnvironmentConfigService } from './context/shared/infrastructure/config/environment/environment.service';
import { UserModule } from './app/user/user.module';
import { AuthModule } from './app/auth/auth.module';
import { AnimalModule } from './app/animal/animal.module';
import { LocationModule } from './app/location/location.module';
import { MobileModule } from './app/mobile/mobile.module';

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
    AuthModule,
    AnimalModule,
    LocationModule,
    MobileModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }

