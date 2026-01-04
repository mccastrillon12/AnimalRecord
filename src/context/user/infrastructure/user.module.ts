import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEntity, UserSchema } from './persistence/mongo/user.schema';
import { MongoUserRepository } from './persistence/mongo/mongo-user-repository';
import { CreateUserUseCase } from '../application/create/create-user.usecase';
import { FindUserUseCase } from '../application/find/find-user.usecase';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }])
    ],
    providers: [
        {
            provide: 'UserRepository',
            useClass: MongoUserRepository
        },
        CreateUserUseCase,
        FindUserUseCase
    ],
    exports: [
        CreateUserUseCase,
        FindUserUseCase,
        'UserRepository'
    ]
})
export class UserModule { }
