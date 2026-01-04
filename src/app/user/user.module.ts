import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEntity, UserSchema } from '../../context/user/infrastructure/persistence/mongo/user.schema';
import { MongoUserRepository } from '../../context/user/infrastructure/persistence/mongo/mongo-user-repository';
import { CreateUserUseCase } from '../../context/user/application/create/create-user.usecase';
import { FindUserUseCase } from '../../context/user/application/find/find-user.usecase';
import { FindAllUsersUseCase } from '../../context/user/application/findall/find-all-users.usecase';
import { UpdateUserUseCase } from '../../context/user/application/update/update-user.usecase';
import { UserController } from './user.controller';

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
        CreateUserUseCase,
        FindUserUseCase,
        FindAllUsersUseCase,
        UpdateUserUseCase
    ],
    exports: [
        CreateUserUseCase,
        FindUserUseCase,
        FindAllUsersUseCase,
        UpdateUserUseCase,
        'UserRepository'
    ]
})
export class UserModule { }
