import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { AnimalTransferController } from './animal-transfer.controller';

@Module({
  imports: [AuthModule, UserModule],
  controllers: [AnimalTransferController],
})
export class AnimalTransferModule {}
