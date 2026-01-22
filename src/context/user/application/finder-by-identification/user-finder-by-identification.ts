import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User } from '../../domain/user';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class UserFinderByIdentification {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository
    ) { }

    async run(identificationNumber: string): Promise<User> {
        const user = await this.userRepository.findByIdentificationNumber(identificationNumber);
        if (!user) {
            throw new ResourceNotFoundError(`User with identification number ${identificationNumber} not found`);
        }
        return user;
    }
}
