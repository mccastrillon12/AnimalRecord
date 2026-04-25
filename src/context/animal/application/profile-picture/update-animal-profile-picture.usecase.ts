import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { IStorageService } from '../../../user/domain/ports/IStorageService';

@Injectable()
export class UpdateAnimalProfilePictureUseCase {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository,
        @Inject('IStorageService') private readonly storageService: IStorageService
    ) { }

    async run(animalId: string, finalUrl: string): Promise<void> {
        const animal = await this.animalRepository.findById(new Uuid(animalId));
        if (!animal) {
            throw new ResourceNotFoundError('Animal not found');
        }

        // Auto-delete the old profile picture from S3 to save space
        if (animal.profilePictureUrl && animal.profilePictureUrl !== finalUrl) {
            if (animal.profilePictureUrl.includes('.amazonaws.com/')) {
                await this.storageService.deleteFile(animal.profilePictureUrl);
            }
        }

        animal.profilePictureUrl = finalUrl;

        await this.animalRepository.update(animal);
    }
}
