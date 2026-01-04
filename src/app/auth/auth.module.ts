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

@Module({
    imports: [
        UserModule,
        PassportModule,
        EnvironmentConfigModule,
        JwtModule.register({
            secret: 'secretKey', // In production use configService.getJwtSecret()
            signOptions: { expiresIn: '60m' },
        }),
    ],
    controllers: [AuthController],
    providers: [
        LoginUseCase,
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
