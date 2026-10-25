import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  AnimalMediaUpload,
  AnimalMediaUploadRepository,
  AnimalMediaUploadStorage,
  MediaRevision,
} from '../domain/animal-media-upload';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';

@Injectable()
export class AnimalMediaUploads {
  constructor(
    @Inject('AnimalMediaUploadRepository')
    private readonly repository: AnimalMediaUploadRepository,
    @Inject('AnimalMediaUploadStorage')
    private readonly storage: AnimalMediaUploadStorage,
  ) {}

  async issue(
    ownerId: string,
    animalId: string,
    finalKey: string,
    mimeType: string,
    size: number,
  ): Promise<{ uploadUrl: string; finalUrl: string }> {
    const prefix = `users/${ownerId}/animals/${animalId}/`;
    if (
      !finalKey.startsWith(prefix) ||
      !/^(profile_\d+\.(jpeg|png|webp)|diary\/[0-9a-fA-F-]+\/[0-9a-fA-F-]+\.[a-z0-9]+)$/.test(
        finalKey.slice(prefix.length),
      ) ||
      !Number.isSafeInteger(size) ||
      size < 1
    ) {
      throw new InvalidArgumentError(
        'Invalid animal upload destination or size',
      );
    }
    const id = uuidv4();
    const upload: AnimalMediaUpload = {
      id,
      ownerId,
      animalId,
      finalKey,
      stagingKey: `${prefix}upload-intake/${id}/source`,
      mimeType,
      size,
      createdAt: new Date().toISOString(),
    };
    // Unique, majority-acknowledged issuance before exposing the signed URL.
    await this.repository.create(upload);
    return {
      uploadUrl: await this.storage.signStaging(upload),
      finalUrl: this.storage.urlForKey(finalKey),
    };
  }

  async confirm(
    ownerId: string,
    animalId: string,
    finalUrl: string,
    mimeType?: string,
    size?: number,
    currentUrl?: string,
  ): Promise<void> {
    const key = this.storage.keyFromUrl(finalUrl);
    if (!key?.startsWith(`users/${ownerId}/animals/${animalId}/`))
      throw new InvalidArgumentError(
        'The upload must belong to this animal and owner',
      );
    if (await this.repository.findLegacySource(key))
      throw new ConflictError(
        'The media URL was migrated; refresh before confirming',
      );
    let upload = await this.repository.find(key);
    // Preserve old confirmations during rollout, but never claim transfer safety.
    if (!upload) return;
    // Migration copies are activated ONLY by the fenced page transaction. A
    // late worker may finish an orphan copy after STOPPED; knowing its URL must
    // not turn an ordinary confirmation into an alternative activation path.
    if (upload.legacy && currentUrl !== finalUrl)
      throw new ConflictError(
        'The migration copy is not the current media; refresh before confirming',
      );
    if (
      upload.ownerId !== ownerId ||
      upload.animalId !== animalId ||
      (mimeType !== undefined && mimeType !== upload.mimeType) ||
      (size !== undefined && size !== upload.size)
    ) {
      throw new InvalidArgumentError(
        'Upload metadata does not match the issued URL',
      );
    }
    if (!upload.pinned)
      upload = await this.repository.pin(
        key,
        await this.storage.pinSource(upload),
      );
    // A concurrent confirmation may have sealed the ticket while source pinning
    // was in flight. Recheck after the atomic pin, not only after the first read.
    if (upload.sealed) {
      await this.storage.verifyFinal(upload); // Never resurrect an already deleted final.
      return;
    }
    const revision = await this.storage.promote(upload);
    await this.repository.seal(key, upload.pinned!.sha256, revision);
  }

  async assertRegisteredSealed(finalKey: string): Promise<void> {
    const upload = await this.repository.find(finalKey);
    if (!upload?.pinned || !upload.sealed)
      throw new ConflictError(
        'Legacy or unconfirmed animal media must be migrated before transfer capture',
      );
  }

  async inspectSealed(finalKey: string): Promise<MediaRevision> {
    const upload = await this.repository.find(finalKey);
    if (!upload?.pinned || !upload.sealed)
      throw new ConflictError(
        'Legacy or unconfirmed animal media must be migrated before transfer capture',
      );
    return this.storage.verifyFinal(upload);
  }
}
