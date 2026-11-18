import { Inject, Injectable } from '@nestjs/common';
import {
  animalProfilePictureKey,
  type AnimalMediaDownloadStorage,
} from '../../../animal-media/domain/animal-media-download-storage';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { AnimalAccessPolicy } from '../animal-access-policy';

@Injectable()
export class AnimalProfilePictureDownload {
  constructor(
    private readonly access: AnimalAccessPolicy,
    @Inject('IStorageService')
    private readonly storage: AnimalMediaDownloadStorage,
  ) {}

  async run(animalId: string, actorId: string) {
    const animal = await this.access.findOwnedAnimal(animalId, actorId);
    const key = animalProfilePictureKey(
      this.storage,
      animal.ownerId.value,
      animal.id.value,
      animal.profilePictureUrl,
    );
    if (!key)
      throw new ResourceNotFoundError('Animal profile picture not found');

    return this.storage.signAnimalMediaDownload(key);
  }
}
