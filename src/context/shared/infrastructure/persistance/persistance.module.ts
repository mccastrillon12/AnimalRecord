// import { Module } from '@nestjs/common';
// import { TypeOrmModule } from '@nestjs/typeorm';

// import { EnvironmentConfigService } from '../config/environment/environment.service';
// import { EnvironmentConfigModule } from '../config/environment/environment.module';
// import { getTypeOrmOptions } from './typeorm.config';

// @Module({
//   imports: [
//     TypeOrmModule.forRootAsync({
//       imports: [EnvironmentConfigModule],
//       inject: [EnvironmentConfigService],
//       useFactory: getTypeOrmOptions,
//     }),
//   ],
// })
// export class PersistanceModule {}
