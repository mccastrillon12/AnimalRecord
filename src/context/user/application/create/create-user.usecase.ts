import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User, UserPrimitiveType } from '../../domain/user';

@Injectable()
export class CreateUserUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository
    ) { }

    async run(data: UserPrimitiveType): Promise<User> {
        const user = User.fromPrimitives(data);
        return await this.userRepository.insert(user);
    }
}
