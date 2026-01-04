import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User } from '../../domain/user';

@Injectable()
export class FindAllUsersUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository
    ) { }

    async run(): Promise<User[]> {
        return await this.userRepository.findAll();
    }
}
