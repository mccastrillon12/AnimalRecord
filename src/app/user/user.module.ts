import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEntity, UserSchema } from '../../context/user/infrastructure/persistence/mongo/user.schema';
import { MongoUserRepository } from '../../context/user/infrastructure/persistence/mongo/mongo-user-repository';
import { UserCreator } from '../../context/user/application/creator/user-creator';
import { UserFinder } from '../../context/user/application/finder/user-finder';
import { UserFinderAll } from '../../context/user/application/finder-all/user-finder-all';
import { UserUpdater } from '../../context/user/application/updater/user-updater';
import { UserController } from './user.controller';

import { BcryptPasswordHasher } from '../../context/shared/infrastructure/security/bcrypt-password-hasher';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }])
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
        UserCreator,
        UserFinder,
        UserFinderAll,
        UserUpdater
    ],
    exports: [
        UserCreator,
        UserFinder,
        UserFinderAll,
        UserUpdater,
        'UserRepository'
    ]
})
export class UserModule { }
