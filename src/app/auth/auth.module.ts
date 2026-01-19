import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { LoginUseCase } from '../../context/auth/application/login.usecase';
import { JwtStrategy } from './jwt.strategy';
import { JwtTokenGenerator } from '../../context/shared/infrastructure/security/jwt-token-generator';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import { EnvironmentConfigService } from '../../context/shared/infrastructure/config/environment/environment.service';
import { BcryptPasswordHasher } from '../../context/shared/infrastructure/security/bcrypt-password-hasher';

import { RefreshTokenUseCase } from '../../context/auth/application/refresh-token.usecase';
import { VerifyUserEmail } from '../../context/user/application/verify/verify-user-email';

@Module({
    imports: [
        UserModule,
        PassportModule,
        EnvironmentConfigModule,
        JwtModule.registerAsync({
            imports: [EnvironmentConfigModule],
            useFactory: async (configService: EnvironmentConfigService) => ({
                secret: configService.getJwtSecret(),
                signOptions: { expiresIn: configService.getJwtExpirationTime() as any },
            }),
            inject: [EnvironmentConfigService],
        }),
    ],
    controllers: [AuthController],
    providers: [
        LoginUseCase,
        VerifyUserEmail,
        RefreshTokenUseCase,
        JwtStrategy,
        {
            provide: 'ITokenGenerator',
            useClass: JwtTokenGenerator
        },
        {
            provide: 'IPasswordHasher',
            useClass: BcryptPasswordHasher
        }
    ],
    exports: [LoginUseCase]
})
export class AuthModule { }
