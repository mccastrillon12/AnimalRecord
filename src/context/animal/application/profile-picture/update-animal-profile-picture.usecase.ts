import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { IStorageService } from '../../../user/domain/ports/IStorageService';
import { InvalidArgumentError } from '../../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';

@Injectable()
export class UpdateAnimalProfilePictureUseCase {
  constructor(
    @Inject('AnimalRepository')
    private readonly animalRepository: AnimalRepository,
    @Inject('IStorageService') private readonly storageService: IStorageService,
  ) {}

  async run(animalId: string, finalUrl: string): Promise<void> {
    const animal = await this.animalRepository.findById(new Uuid(animalId));
    if (!animal) {
      throw new ResourceNotFoundError('Animal not found');
    }

    const prefix = `users/${animal.ownerId.value}/animals/${animalId}/`;
    const key = this.storageService.getFileKey(finalUrl);
    if (
      !key?.startsWith(prefix) ||
      !/^profile_\d+\.(jpeg|png|webp)$/.test(key.slice(prefix.length))
    ) {
      throw new InvalidArgumentError(
        'The picture URL must belong to this animal and owner',
      );
    }
    const previousUrl = animal.profilePictureUrl;
    animal.profilePictureUrl = finalUrl;
    if (previousUrl === finalUrl) return;
    if (!(await this.animalRepository.update(animal)))
      throw new ConflictError('The animal picture could not be updated');
    const previousKey = previousUrl
      ? this.storageService.getFileKey(previousUrl)
      : undefined;
    if (
      previousUrl &&
      previousKey?.startsWith(prefix) &&
      /^profile_\d+\.(jpeg|png|webp)$/.test(previousKey.slice(prefix.length))
    ) {
      await this.storageService.deleteFile(previousUrl);
    }
  }
}
