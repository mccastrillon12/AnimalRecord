import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import { EnvironmentConfigService } from '../../context/shared/infrastructure/config/environment/environment.service';
import { BcryptPasswordHasher } from '../../context/shared/infrastructure/security/bcrypt-password-hasher';
import { TransferOtp } from '../../context/animal-transfer/application/transfer-otp';
import {
  MongoTransferOtp,
  TRANSFER_OTP_MODEL,
  TransferOtpSchema,
} from '../../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-otp';
import { TransferOtpController } from './transfer-otp.controller';

@Module({
  imports: [
    AuthModule,
    UserModule,
    EnvironmentConfigModule,
    MongooseModule.forFeature([
      { name: TRANSFER_OTP_MODEL, schema: TransferOtpSchema },
    ]),
  ],
  controllers: [TransferOtpController],
  providers: [
    TransferOtp,
    { provide: 'TransferOtpStore', useClass: MongoTransferOtp },
    { provide: 'TransferOtpHasher', useClass: BcryptPasswordHasher },
    { provide: 'TransferOtpClock', useValue: () => new Date() },
    {
      provide: 'TransferOtpPolicy',
      inject: [EnvironmentConfigService, ConfigService],
      useFactory: (
        registration: EnvironmentConfigService,
        config: ConfigService,
      ) => {
        const number = (name: string, fallback: number) =>
          Number(config.get<string | number>(name) ?? fallback);
        return {
          codeMinutes: registration.getVerificationCodeExpirationTime(),
          proofMinutes: number('TRANSFER_OTP_PROOF_MINUTES', 10),
          maxAttempts: number('TRANSFER_OTP_MAX_ATTEMPTS', 5),
          resendSeconds: number('TRANSFER_OTP_RESEND_SECONDS', 60),
          maxSends: number('TRANSFER_OTP_MAX_SENDS', 3),
          windowMinutes: number('TRANSFER_OTP_WINDOW_MINUTES', 15),
        };
      },
    },
  ],
  exports: [TransferOtp],
})
export class TransferOtpModule {}
