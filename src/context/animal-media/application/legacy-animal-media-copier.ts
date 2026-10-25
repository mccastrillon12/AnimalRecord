import { Inject, Injectable } from '@nestjs/common';
import { v5 as uuidv5, validate as isUuid } from 'uuid';
import {
  AnimalMediaUpload,
  AnimalMediaUploadRepository,
  AnimalMediaUploadStorage,
} from '../domain/animal-media-upload';
import {
  LegacyMediaCopier,
  LegacyMediaReference,
  MediaMigration,
  sameMigration,
} from '../domain/legacy-media-migration';
import { ConflictError } from '../../shared/domain/errors/ConflictError';

const NAMESPACE = 'f228e092-6e6c-46cf-a38b-83f88c65cece';
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/x-m4a': 'm4a',
};

@Injectable()
export class LegacyAnimalMediaCopier implements LegacyMediaCopier {
  constructor(
    @Inject('AnimalMediaUploadRepository')
    private readonly uploads: AnimalMediaUploadRepository,
    @Inject('AnimalMediaUploadStorage')
    private readonly storage: AnimalMediaUploadStorage,
  ) {}

  async prepare(
    job: MediaMigration,
    reference: LegacyMediaReference,
  ): Promise<string> {
    const source = this.storage.keyFromUrl(reference.url);
    const prefix = `users/${job.ownerId}/animals/${job.animalId}/`;
    const relative = source?.startsWith(prefix)
      ? source.slice(prefix.length)
      : '';
    const profile = /^profile_\d+\.(jpeg|png|webp)$/.test(relative);
    const extension = relative.split('.').pop()!;
    const diary =
      reference.kind === 'DIARY' &&
      isUuid(reference.entryId ?? '') &&
      isUuid(reference.attachmentId ?? '') &&
      (relative ===
        `diary/${reference.entryId}/${reference.attachmentId}.${extension}` ||
        new RegExp(
          `^diary/${reference.entryId}/${reference.attachmentId}/sealed_[0-9a-f-]+\\.[a-z0-9]+$`,
        ).test(relative));
    if (!source || (reference.kind === 'PROFILE' ? !profile : !diary))
      throw new ConflictError(
        'Legacy media must belong to the expected owner, animal and resource',
      );
    if (
      reference.kind === 'DIARY' &&
      (!reference.mimeType ||
        EXTENSIONS[reference.mimeType] !== extension ||
        !Number.isSafeInteger(reference.size) ||
        reference.size! < 1)
    )
      throw new ConflictError(
        'The legacy attachment has invalid MIME, extension or size',
      );

    const current = await this.uploads.find(source);
    if (current) {
      if (
        !current.sealed ||
        !current.pinned ||
        current.ownerId !== job.ownerId ||
        current.animalId !== job.animalId
      )
        throw new ConflictError(
          'An issued but unconfirmed upload cannot be migrated as legacy',
        );
      this.assertMetadata(current, reference);
      await this.storage.verifyFinal(current);
      return reference.url;
    }
    const id = uuidv5(`${job.id}:${source}`, NAMESPACE);
    const finalKey =
      reference.kind === 'PROFILE'
        ? `${prefix}profile_${BigInt(`0x${id.replace(/-/g, '')}`).toString()}.${extension}`
        : `${prefix}diary/${reference.entryId}/${reference.attachmentId}/sealed_${id}.${extension}`;
    let upload = await this.uploads.find(finalKey);
    if (!upload) {
      const description = await this.storage.describeSource(source);
      const candidate: AnimalMediaUpload = {
        id,
        ownerId: job.ownerId,
        animalId: job.animalId,
        finalKey,
        stagingKey: source,
        ...description,
        createdAt: new Date().toISOString(),
        legacy: {
          migrationId: job.id,
          sourceUrl: reference.url,
          kind: reference.kind,
          entryId: reference.entryId,
          attachmentId: reference.attachmentId,
        },
      };
      this.assertMetadata(candidate, reference);
      if (
        reference.kind === 'PROFILE' &&
        description.mimeType !== `image/${extension}`
      )
        throw new ConflictError(
          'The legacy picture MIME does not match its URL',
        );
      try {
        await this.uploads.create(candidate);
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
      upload = await this.uploads.find(finalKey);
    }
    if (
      !upload ||
      !sameMigration(upload, job, reference) ||
      upload.stagingKey !== source
    )
      throw new ConflictError(
        'The legacy media already belongs to a different migration',
      );
    this.assertMetadata(upload, reference);
    if (!upload.pinned)
      upload = await this.uploads.pin(
        finalKey,
        await this.storage.pinSource(upload),
      );
    const revision = upload.sealed
      ? await this.storage.verifyFinal(upload)
      : await this.storage.promote(upload);
    await this.uploads.seal(finalKey, upload.pinned!.sha256, revision);
    return this.storage.urlForKey(finalKey);
  }

  private assertMetadata(
    upload: AnimalMediaUpload,
    reference: LegacyMediaReference,
  ): void {
    if (
      (reference.mimeType !== undefined &&
        upload.mimeType !== reference.mimeType) ||
      (reference.size !== undefined && upload.size !== reference.size)
    )
      throw new ConflictError(
        'Legacy attachment metadata does not match the stored bytes',
      );
  }
}
