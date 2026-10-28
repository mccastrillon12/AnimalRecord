import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { IStorageService } from '../../../user/domain/ports/IStorageService';
import { InvalidArgumentError } from '../../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { AnimalMediaUploads } from '../../../animal-media/application/animal-media-uploads';
import {
  MediaConfirmationContext,
  mediaConfirmationContext,
} from '../../../animal-media/domain/media-confirmation-context';

@Injectable()
export class UpdateAnimalProfilePictureUseCase {
  constructor(
    @Inject('AnimalRepository')
    private readonly animalRepository: AnimalRepository,
    @Inject('IStorageService') private readonly storageService: IStorageService,
    private readonly uploads: AnimalMediaUploads,
  ) {}

  async run(
    animalId: string,
    finalUrl: string,
    context?: MediaConfirmationContext,
  ): Promise<void> {
    const confirmation =
      context !== undefined
        ? mediaConfirmationContext(context, {
            animalId,
            kind: 'PROFILE_CONFIRM',
          })
        : undefined;
    const animal = await this.animalRepository.findById(new Uuid(animalId));
    if (!animal) {
      throw new ResourceNotFoundError('Animal not found');
    }
    if (confirmation)
      mediaConfirmationContext(confirmation, {
        animalId,
        ownerId: animal.ownerId.value,
        kind: 'PROFILE_CONFIRM',
      });

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
    await this.uploads.confirm(
      animal.ownerId.value,
      animalId,
      finalUrl,
      undefined,
      undefined,
      previousUrl,
      ...(confirmation ? [confirmation] : []),
    );
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
