import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { IStorageService } from '../../../user/domain/ports/IStorageService';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../shared/domain/value-object/Uuid';

@Injectable()
export class GenerateAnimalProfilePictureUploadUrlUseCase {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository,
        @Inject('IStorageService') private readonly storageService: IStorageService
    ) { }

    async run(animalId: string, mimeType: string, fileSize: number): Promise<{ uploadUrl: string, finalUrl: string }> {
        const animal = await this.animalRepository.findById(new Uuid(animalId));
        if (!animal) {
            throw new ResourceNotFoundError('Animal not found');
        }

        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
            throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed.');
        }

        // Validate size (max 2MB)
        if (fileSize > 2 * 1024 * 1024) {
            throw new BadRequestException('File is too large. Max size is 2MB.');
        }

        const ownerId = animal.ownerId.value;
        const extension = mimeType.split('/')[1];
        const timestamp = Date.now();
        const fileName = `users/${ownerId}/animals/${animalId}/profile_${timestamp}.${extension}`;

        return this.storageService.generatePreSignedUploadUrl(fileName, mimeType, fileSize);
    }
}
