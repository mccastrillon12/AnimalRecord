import { Inject, Injectable } from '@nestjs/common';
import type { AnimalMediaDownloadStorage } from '../../../animal-media/domain/animal-media-download-storage';
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
    const prefix = `users/${animal.ownerId.value}/animals/${animal.id.value}/`;
    const key = animal.profilePictureUrl
      ? this.storage.getFileKey(animal.profilePictureUrl)
      : undefined;
    if (
      !key?.startsWith(prefix) ||
      !/^profile_\d+\.(jpeg|png|webp)$/.test(key.slice(prefix.length))
    )
      throw new ResourceNotFoundError('Animal profile picture not found');

    return this.storage.signAnimalMediaDownload(key);
  }
}
