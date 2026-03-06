import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../shared/domain/value-object/Uuid';

@Injectable()
export class UpdateProfilePictureUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository
    ) { }

    async run(userId: string, finalUrl: string): Promise<void> {
        const user = await this.userRepository.findById(new Uuid(userId));
        if (!user) {
            throw new ResourceNotFoundError('User not found');
        }

        user.profilePictureUrl = finalUrl;

        await this.userRepository.update(user);
    }
}
