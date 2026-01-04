import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User, UserPrimitiveType } from '../../domain/user';
import { IPasswordHasher } from '../../../shared/domain/IPasswordHasher';

@Injectable()
export class UserCreator {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher
    ) { }

    async run(data: UserPrimitiveType): Promise<User> {
        if (data.password) {
            data.password = await this.passwordHasher.hash(data.password);
        }
        const user = User.fromPrimitives(data);
        return await this.userRepository.insert(user);
    }
}
