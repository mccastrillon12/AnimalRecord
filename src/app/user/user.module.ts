import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEntity, UserSchema } from '../../context/user/infrastructure/persistence/mongo/user.schema';
import { MongoUserRepository } from '../../context/user/infrastructure/persistence/mongo/mongo-user-repository';
import { UserCreator } from '../../context/user/application/creator/user-creator';
import { UserFinder } from '../../context/user/application/finder/user-finder';
import { UserFinderAll } from '../../context/user/application/finder-all/user-finder-all';
import { UserFinderByIdentification } from '../../context/user/application/finder-by-identification/user-finder-by-identification';
import { UserUpdater } from '../../context/user/application/updater/user-updater';
import { UserController } from './user.controller';
import { NodemailerEmailSender } from '../../context/user/infrastructure/email/nodemailer-email-sender';

import { UserCodeSender } from '../../context/user/application/sender/user-code-sender';
import { UserResetPasswordSender } from '../../context/user/application/sender/user-reset-password-sender';
import { AwsSnsSmsSender } from '../../context/user/infrastructure/sms/aws-sns-sms-sender';
import { UserResetPinSender } from '../../context/user/application/sender/user-reset-pin-sender';
import { BcryptPasswordHasher } from '../../context/shared/infrastructure/security/bcrypt-password-hasher';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';

import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
        EnvironmentConfigModule,
        forwardRef(() => AuthModule)
    ],
    controllers: [UserController],
    providers: [
        {
            provide: 'UserRepository',
            useClass: MongoUserRepository
        },
        {
            provide: 'IPasswordHasher',
            useClass: BcryptPasswordHasher
        },
        {
            provide: 'IEmailSender',
            useClass: NodemailerEmailSender
        },
        {
            provide: 'ISmsSender',
            useClass: AwsSnsSmsSender
        },
        UserCreator,
        UserFinder,
        UserFinderAll,
        UserFinderAll,
        UserFinderByIdentification,
        UserUpdater,
        UserCodeSender,
        UserResetPasswordSender,
        UserResetPinSender
    ],
    exports: [
        UserCreator,
        UserFinder,
        UserFinderAll,
        UserFinderByIdentification,
        UserUpdater,
        UserCodeSender,
        UserResetPasswordSender,
        UserResetPinSender,
        'UserRepository'
    ]
})
export class UserModule { }
