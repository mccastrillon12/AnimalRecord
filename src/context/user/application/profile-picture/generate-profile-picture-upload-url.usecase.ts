import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { IStorageService } from '../../domain/ports/IStorageService';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../shared/domain/value-object/Uuid';

@Injectable()
export class GenerateProfilePictureUploadUrlUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IStorageService') private readonly storageService: IStorageService
    ) { }

    async run(userId: string, mimeType: string, fileSize: number): Promise<{ uploadUrl: string, finalUrl: string }> {
        const user = await this.userRepository.findById(new Uuid(userId));
        if (!user) {
            throw new ResourceNotFoundError('User not found');
        }

        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
            throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed.');
        }

        // Validate size (max 2MB)
        if (fileSize > 2 * 1024 * 1024) {
            throw new BadRequestException('File is too large. Max size is 2MB.');
        }

        const extension = mimeType.split('/')[1];
        const timestamp = Date.now();
        const fileName = `users/${userId}/profile_${timestamp}.${extension}`;

        return this.storageService.generatePreSignedUploadUrl(fileName, mimeType, fileSize);
    }
}
