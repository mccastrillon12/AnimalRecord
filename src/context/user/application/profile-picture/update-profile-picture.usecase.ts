import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { IStorageService } from '../../domain/ports/IStorageService';

@Injectable()
export class UpdateProfilePictureUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IStorageService') private readonly storageService: IStorageService
    ) { }

    async run(userId: string, finalUrl: string): Promise<void> {
        const user = await this.userRepository.findById(new Uuid(userId));
        if (!user) {
            throw new ResourceNotFoundError('User not found');
        }

        // Auto-delete the old profile picture from S3 to save space
        if (user.profilePictureUrl && user.profilePictureUrl !== finalUrl) {
            if (user.profilePictureUrl.includes('.amazonaws.com/')) {
                await this.storageService.deleteFile(user.profilePictureUrl);
            }
        }

        user.profilePictureUrl = finalUrl;

        await this.userRepository.update(user);
    }
}
