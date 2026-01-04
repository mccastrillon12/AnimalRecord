import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { EnvironmentConfigService } from './environment.service';
import { validate } from './environment.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
  ],
  providers: [EnvironmentConfigService],
  exports: [EnvironmentConfigService],
})
export class EnvironmentConfigModule {}
