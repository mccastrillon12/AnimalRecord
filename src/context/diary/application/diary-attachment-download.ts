import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import type { AnimalMediaDownloadStorage } from '../../animal-media/domain/animal-media-download-storage';
import { AnimalAccessPolicy } from '../../animal/application/animal-access-policy';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { DiaryEntryFinder } from './diary-entry-finder';

// A second transfer can add another generation before the original filename.
const generations = '(?:transfer-generations/[a-f0-9-]{36}/[a-f0-9]{64}/)*';

@Injectable()
export class DiaryAttachmentDownload {
  constructor(
    private readonly access: AnimalAccessPolicy,
    private readonly entries: DiaryEntryFinder,
    @Inject('IStorageService')
    private readonly storage: AnimalMediaDownloadStorage,
  ) {}

  async run(
    animalId: string,
    entryId: string,
    attachmentId: string,
    actorId: string,
  ) {
    const animal = await this.access.findOwnedAnimal(animalId, actorId);
    const entry = await this.entries.findById(entryId);
    if (entry.animalId.value !== animal.id.value)
      throw new ResourceNotFoundError('Diary entry not found for this animal');

    const attachment = entry.attachments.find(({ id }) => id === attachmentId);
    if (!attachment || !isUuid(attachment.id))
      throw new ResourceNotFoundError('Diary attachment not found');
    const prefix = `users/${animal.ownerId.value}/animals/${animal.id.value}/diary/${entry.id.value}/`;
    const filePath = new RegExp(
      `^(?:${generations}${attachment.id}\\.[a-z0-9]+|${attachment.id}/${generations}sealed_[0-9a-f-]+\\.[a-z0-9]+)$`,
    );
    const key = this.storage.getFileKey(attachment.url);
    if (!key?.startsWith(prefix) || !filePath.test(key.slice(prefix.length)))
      throw new ResourceNotFoundError('Diary attachment not found');

    return this.storage.signAnimalMediaDownload(key);
  }
}
