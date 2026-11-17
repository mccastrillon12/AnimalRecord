import { Inject, Injectable } from '@nestjs/common';
import { v5 as uuidv5, validate as isUuid } from 'uuid';
import {
  AnimalMediaUpload,
  AnimalMediaUploadRepository,
  AnimalMediaUploadStorage,
  PinnedMedia,
  isReservedArchiveGenerationKey,
  validMediaMigrationRetention,
  versionedMedia,
} from '../domain/animal-media-upload';
import {
  LegacyMediaCopier,
  LegacyMediaReference,
  MediaMigration,
  sameMigration,
} from '../domain/legacy-media-migration';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  buildLegacyMedicalDocumentStorageKeys,
  buildMedicalDocumentLocations,
  buildMedicalDocumentReplacementLocations,
  getMedicalDocumentSourceFileName,
} from '../../medical-document/application/medical-document-storage-key';
import { MedicalDocumentType } from '../../medical-document/domain/medical-document';

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
    const retention = job.retention;
    const retained = this.storage.verifyMigrationRetention?.bind(this.storage);
    if (retention && (!validMediaMigrationRetention(retention) || !retained))
      throw new ConflictError('Retained media migration is not configured');
    const expectedOwner = retention?.expectedBucketOwner;
    const source = this.storage.keyFromUrl(reference.url);
    if (source && isReservedArchiveGenerationKey(source))
      throw new ConflictError(
        'Archive generation media cannot be migrated as legacy',
      );
    const prefix = `users/${job.ownerId}/animals/${job.animalId}/`;
    const relative = source?.startsWith(prefix)
      ? source.slice(prefix.length)
      : '';
    const medical = reference.kind === 'MEDICAL_DOCUMENT';
    const id = uuidv5(`${job.id}:${source}`, NAMESPACE);
    const medicalDestination =
      medical && source
        ? this.medicalDestination(job, reference, source, id)
        : undefined;
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
    if (
      !source ||
      !(medical
        ? medicalDestination
        : reference.kind === 'PROFILE'
          ? profile
          : diary)
    )
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

    let upload = medicalDestination
      ? await this.uploads.find(medicalDestination)
      : null;
    if (medical && !upload) {
      if (!this.storage.hasRetainedMigrationSource)
        throw new ConflictError(
          'Medical source retention inspection is not configured',
        );
      if (
        await this.storage.hasRetainedMigrationSource(
          source,
          { mimeType: reference.mimeType!, size: reference.size! },
          retention!,
        )
      )
        return reference.url;
    }
    const current = upload ? null : await this.uploads.find(source);
    let previousPin: PinnedMedia | undefined;
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
      const revision = retention
        ? await this.storage.verifyFinal(current, expectedOwner)
        : await this.storage.verifyFinal(current);
      if (!retention) return reference.url;
      const previousRetention = current.legacy?.retention;
      if (
        previousRetention &&
        previousRetention.expectedBucketOwner === expectedOwner &&
        previousRetention.retainUntil >= retention.retainUntil
      ) {
        await retained!(source, revision, retention);
        return reference.url;
      }
      previousPin = {
        ...revision,
        versionId: revision.versionId ?? 'null',
        sha256: current.pinned.sha256,
      };
    }
    const finalKey =
      medicalDestination ??
      (reference.kind === 'PROFILE'
        ? `${prefix}profile_${BigInt(`0x${id.replace(/-/g, '')}`).toString()}.${extension}`
        : `${prefix}diary/${reference.entryId}/${reference.attachmentId}/sealed_${id}.${extension}`);
    if (!medical) upload = await this.uploads.find(finalKey);
    if (!upload) {
      const description =
        current ??
        (retention
          ? await this.storage.describeSource(source, expectedOwner)
          : await this.storage.describeSource(source));
      const candidate: AnimalMediaUpload = {
        id,
        ownerId: job.ownerId,
        animalId: job.animalId,
        finalKey,
        stagingKey: source,
        mimeType: description.mimeType,
        size: description.size,
        createdAt: new Date().toISOString(),
        legacy: {
          migrationId: job.id,
          sourceUrl: reference.url,
          kind: reference.kind,
          entryId: reference.entryId,
          attachmentId: reference.attachmentId,
          ...(medical && {
            documentId: reference.documentId,
            documentVersion: reference.documentVersion,
          }),
          ...(retention && { retention }),
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
        previousPin ?? (await this.storage.pinSource(upload)),
      );
    if (
      previousPin &&
      (upload.pinned!.etag !== previousPin.etag ||
        upload.pinned!.size !== previousPin.size ||
        upload.pinned!.versionId !== previousPin.versionId ||
        upload.pinned!.sha256 !== previousPin.sha256)
    )
      throw new ConflictError('The sealed migration source revision changed');
    const revision = upload.sealed
      ? await this.storage.verifyFinal(upload)
      : await this.storage.promote(upload);
    if (retention) {
      if (!versionedMedia(revision.versionId))
        throw new ConflictError(
          'The retained migration copy has no fixed version',
        );
      await retained!(finalKey, revision, retention);
    }
    await this.uploads.seal(finalKey, upload.pinned!.sha256, revision);
    return this.storage.urlForKey(finalKey);
  }

  private medicalDestination(
    job: MediaMigration,
    reference: LegacyMediaReference,
    source: string,
    copyId: string,
  ) {
    const { documentId, documentVersion, finalCategory, mimeType, size } =
      reference;
    const filename = getMedicalDocumentSourceFileName(source);
    if (
      job.scope !== 'MEDICAL_DOCUMENTS' ||
      job.phase !== 'MEDICAL_DOCUMENTS' ||
      !job.retention ||
      !documentId ||
      !isUuid(documentId) ||
      !Number.isSafeInteger(documentVersion) ||
      documentVersion! < 1 ||
      !finalCategory ||
      !Object.values(MedicalDocumentType).includes(finalCategory) ||
      !mimeType ||
      !Number.isSafeInteger(size) ||
      size! < 1 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(pdf|jpe?g|png|tiff?)$/i.test(filename)
    )
      throw new ConflictError('The accepted medical source is invalid');
    const { ownerId, animalId } = job;
    const canonical = buildMedicalDocumentLocations(
      ownerId,
      [animalId],
      finalCategory,
      documentId,
      filename,
    )[0].storageKey;
    const [legacy] = buildLegacyMedicalDocumentStorageKeys(
      ownerId,
      [animalId],
      documentId,
      filename,
    );
    if (source !== canonical && source !== legacy) {
      const revisionPrefix =
        canonical.slice(0, -filename.length) + 'revisions/';
      const revision = source.startsWith(revisionPrefix)
        ? source.slice(revisionPrefix.length, -(filename.length + 1))
        : '';
      if (
        !isUuid(revision) ||
        source !== `${revisionPrefix}${revision}/${filename}`
      )
        throw new ConflictError(
          'The medical source is outside its document location',
        );
    }
    return buildMedicalDocumentReplacementLocations(
      ownerId,
      [animalId],
      finalCategory,
      documentId,
      copyId,
      filename,
    )[0].storageKey;
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
