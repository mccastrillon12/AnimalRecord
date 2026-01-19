import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User } from '../../domain/user';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class UserFinder {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository
    ) { }

    async run(id: string): Promise<User> {
        const user = await this.userRepository.findById(new Uuid(id));
        if (!user) {
            throw new ResourceNotFoundError(`User with id ${id} not found`);
        }
        return user;
    }
}
