import { createHash } from 'crypto';
import { validate as isUuid } from 'uuid';
import {
  AnimalWriteJournal,
  ANIMAL_WRITE_PROTOCOL,
} from '../../animal-transfer/domain/animal-write-journal';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  AnimalMediaUpload,
  isReservedArchiveGenerationKey,
} from './animal-media-upload';

export const MEDIA_PROMOTION_PROTOCOL =
  'MEDIA_PROMOTION_EFFECT_MODEL_V1' as const;
export type MediaPromotionScope = {
  operationId: string;
  instanceId: string;
  animalId: string;
  ownerId: string;
  ownershipVersion: number;
  kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM';
};
export type MediaPromotionDefinition = {
  bucket: string;
  uploadId: string;
  source: {
    key: string;
    etag: string;
    versionId?: string;
    size: number;
    sha256: string;
  };
  destinationKey: string;
  mimeType: string;
  destinationIfNoneMatch: '*';
};

export function promotionId(value: string): string {
  if (
    typeof value !== 'string' ||
    !isUuid(value) ||
    value !== value.toLowerCase()
  )
    throw new InvalidArgumentError('A canonical promotion UUID is required');
  return value;
}

export function promotionEvidenceRef(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 200 ||
    !/^[a-zA-Z0-9]/.test(value) ||
    /[^a-zA-Z0-9._:-]/.test(value)
  )
    throw new InvalidArgumentError(
      'An opaque promotion evidence reference is required',
    );
  return value;
}

/** A local binding only. Persistence must acquire its own journal/control fence. */
export function promotionScope(
  journal: AnimalWriteJournal,
  animalId: string,
): MediaPromotionScope {
  const scope = promotionJournalBinding(journal, animalId);
  if (
    journal.lifecycle !== 'OPEN' ||
    journal.callback !== 'MAY_RUN' ||
    !journal.callbackPermittedAt ||
    !Number.isFinite(Date.parse(journal.callbackPermittedAt)) ||
    journal.claims[0].state !== 'ACQUIRED'
  )
    throw new InvalidArgumentError(
      'A permitted ordinary media confirmation journal is required',
    );
  return scope;
}

/** Identity for a tombstone is not callback or dispatch permission. */
export function promotionJournalBinding(
  journal: AnimalWriteJournal,
  animalId: string,
): MediaPromotionScope {
  if (!Array.isArray(journal.claims))
    throw new InvalidArgumentError('Invalid promotion journal claims');
  const claim = journal.claims[0];
  if (
    journal.protocol !== ANIMAL_WRITE_PROTOCOL ||
    !['OPEN', 'LOCALLY_FINISHED', 'RECOVERED_BEFORE_CALLBACK'].includes(
      journal.lifecycle,
    ) ||
    !['NOT_STARTED', 'MAY_RUN', 'RETURNED', 'THREW', 'NOT_INVOKED'].includes(
      journal.callback,
    ) ||
    journal.issuesUploadUrl !== false ||
    (journal.kind !== 'PROFILE_CONFIRM' &&
      journal.kind !== 'ATTACHMENT_CONFIRM') ||
    journal.claims.length !== 1 ||
    claim?.animalId !== animalId ||
    ![
      'NOT_ATTEMPTED',
      'INTENT',
      'ACQUIRED',
      'NOT_ACQUIRED',
      'ACQUIRE_UNKNOWN',
      'RELEASED',
      'RELEASE_UNKNOWN',
      'RECOVERED',
    ].includes(claim.state) ||
    !Number.isSafeInteger(claim.ownershipVersion) ||
    claim.ownershipVersion! < 1
  )
    throw new InvalidArgumentError(
      'A permitted ordinary media confirmation journal is required',
    );
  return {
    operationId: promotionId(journal.id),
    instanceId: promotionId(journal.instanceId),
    animalId: promotionId(animalId),
    ownerId: promotionId(journal.actorId),
    ownershipVersion: claim.ownershipVersion!,
    kind: journal.kind,
  };
}

export function promotionDefinition(
  scope: MediaPromotionScope,
  upload: AnimalMediaUpload,
  bucket: string,
): MediaPromotionDefinition {
  const prefix = `users/${scope.ownerId}/animals/${scope.animalId}/`;
  const relative = upload.finalKey.slice(prefix.length);
  const pinned = upload.pinned;
  const profile = /^profile_\d+\.(jpeg|png|webp)$/.exec(relative);
  const diary = /^diary\/([^/]+)\/([^/.]+)\.[a-z0-9]+$/.exec(relative);
  if (
    typeof bucket !== 'string' ||
    bucket.length < 3 ||
    bucket.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) ||
    /\s/.test(bucket) ||
    upload.ownerId !== scope.ownerId ||
    upload.animalId !== scope.animalId ||
    upload.legacy !== undefined ||
    upload.sealed !== undefined ||
    !pinned ||
    !upload.finalKey.startsWith(prefix) ||
    /[\r\n]/.test(upload.finalKey) ||
    upload.finalKey.includes('\0') ||
    isReservedArchiveGenerationKey(upload.finalKey) ||
    upload.stagingKey !==
      `${prefix}upload-intake/${promotionId(upload.id)}/source` ||
    (scope.kind === 'PROFILE_CONFIRM'
      ? !profile || upload.mimeType !== `image/${profile[1]}`
      : !diary) ||
    !Number.isSafeInteger(upload.size) ||
    upload.size < 1 ||
    upload.size > 5 * 1024 ** 3 ||
    pinned.size !== upload.size ||
    pinned.sha256.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(pinned.sha256) ||
    !validRevisionText(pinned.etag) ||
    (pinned.versionId !== undefined && !validRevisionText(pinned.versionId)) ||
    typeof upload.mimeType !== 'string' ||
    /[\r\n]/.test(upload.mimeType) ||
    upload.mimeType.includes('\0') ||
    !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(upload.mimeType)
  )
    throw new InvalidArgumentError(
      'A pinned ordinary upload of the matching resource is required',
    );
  if (diary) {
    promotionId(diary[1]);
    promotionId(diary[2]);
  }
  return {
    bucket,
    uploadId: upload.id,
    source: {
      key: upload.stagingKey,
      etag: pinned.etag,
      size: pinned.size,
      sha256: pinned.sha256,
      ...(pinned.versionId === undefined
        ? {}
        : { versionId: pinned.versionId }),
    },
    destinationKey: upload.finalKey,
    mimeType: upload.mimeType,
    destinationIfNoneMatch: '*',
  };
}

export function validRevisionText(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\r\n]/.test(value) &&
    !value.includes('\0')
  );
}

/** Canonical allowlist; unrelated upload/journal fields are never hashed or copied. */
export function promotionDefinitionHash(
  scope: MediaPromotionScope,
  effectId: string,
  definition: MediaPromotionDefinition,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocol: MEDIA_PROMOTION_PROTOCOL,
        scope: {
          operationId: scope.operationId,
          instanceId: scope.instanceId,
          animalId: scope.animalId,
          ownerId: scope.ownerId,
          ownershipVersion: scope.ownershipVersion,
          kind: scope.kind,
        },
        effectId: promotionId(effectId),
        definition: {
          bucket: definition.bucket,
          uploadId: definition.uploadId,
          source: {
            key: definition.source.key,
            etag: definition.source.etag,
            size: definition.source.size,
            sha256: definition.source.sha256,
            ...(definition.source.versionId === undefined
              ? {}
              : { versionId: definition.source.versionId }),
          },
          destinationKey: definition.destinationKey,
          mimeType: definition.mimeType,
          destinationIfNoneMatch: definition.destinationIfNoneMatch,
        },
      }),
    )
    .digest('hex');
}
