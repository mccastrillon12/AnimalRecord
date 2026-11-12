import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
} from './ownership-archive';
import { archiveReservationEpoch } from './ownership-archive-reservation';
import type { PublishedHistoryFileVersion } from './published-ownership-history';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from './transfer-item-copy-intent';
import { sourceHashValid } from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';

export type PublishedHistoryCopyInput = Readonly<{
  archiveId: string;
  fileId: string;
  expectedFileDefinitionHash: string;
  expectedPublicationHash: string;
  expectedReservationEpoch: number;
  requiredThrough: string;
}>;

export function publishedHistoryCopyInput(raw: PublishedHistoryCopyInput) {
  if (
    !raw ||
    !isUuid(raw.archiveId) ||
    ![
      raw.fileId,
      raw.expectedFileDefinitionHash,
      raw.expectedPublicationHash,
    ].every(sourceHashValid) ||
    !Number.isSafeInteger(raw.expectedReservationEpoch) ||
    raw.expectedReservationEpoch < 1
  )
    throw new InvalidArgumentError('Invalid published history copy selection');
  historicalPutEvidenceTime(raw.requiredThrough);
  return Object.freeze({
    archiveId: raw.archiveId,
    fileId: raw.fileId,
    expectedFileDefinitionHash: raw.expectedFileDefinitionHash,
    expectedPublicationHash: raw.expectedPublicationHash,
    expectedReservationEpoch: raw.expectedReservationEpoch,
    requiredThrough: raw.requiredThrough,
  });
}

export function buildPublishedHistoryCopyIntent(
  input: PublishedHistoryCopyInput,
  archive: OwnershipArchive,
  file: ArchiveFile,
  version: PublishedHistoryFileVersion,
) {
  const { retained } = file;
  const source = captureItemObjectRevision(file.source);
  const definition = {
    id: file.id,
    archiveId: file.archiveId,
    sourceKey: file.sourceKey,
    relativeKey: file.relativeKey,
    historicalKey: file.historicalKey,
    recipientStagingKey: file.recipientStagingKey,
    recipientFinalKey: file.recipientFinalKey,
    source,
    retained,
  };
  const prefix = `users/${archive.ownerId}/animals/${archive.animalId}/`;
  const recipientPrefix = `users/${archive.recipientId}/animals/${archive.animalId}/`;
  if (
    !retained?.publishedSource ||
    archive.id !== input.archiveId ||
    archive.state !== 'COPYING' ||
    archive.capture !== undefined ||
    archive.history?.phase !== 'COMPLETE' ||
    archive.history.sourcePublicationHash !== input.expectedPublicationHash ||
    archiveReservationEpoch(archive) !== input.expectedReservationEpoch ||
    retained.sourceArchiveId !== archive.history.sourceArchiveId ||
    retained.rootArchiveId !== retained.sourceArchiveId ||
    retained.rootFileId !== retained.sourceFileId ||
    retained.publishedSource.publicationHash !==
      input.expectedPublicationHash ||
    file.archiveId !== archive.id ||
    file.id !== input.fileId ||
    file.state !== 'PENDING' ||
    file.id !== archiveHash([archive.id, file.sourceKey]) ||
    file.definitionHash !== input.expectedFileDefinitionHash ||
    archiveHash(definition) !== file.definitionHash ||
    typeof retained.relativeKey !== 'string' ||
    /[\\\r\n\0]/.test(retained.relativeKey) ||
    retained.relativeKey
      .split('/')
      .some((part) => !part || part === '.' || part === '..') ||
    file.relativeKey !==
      `retained-history/${retained.rootArchiveId}/${retained.rootFileId}/${retained.relativeKey}` ||
    file.historicalKey !==
      `${prefix}ownership-archives/${archive.id}/${file.relativeKey}` ||
    file.recipientStagingKey !==
      `${recipientPrefix}transfer-preparations/${archive.id}/${file.relativeKey}` ||
    file.recipientFinalKey !== `${recipientPrefix}${file.relativeKey}` ||
    version.requiredThrough !== input.requiredThrough ||
    version.fileDefinitionHash !== retained.sourceDefinitionHash ||
    version.target.key !== file.sourceKey ||
    version.target.bucket !== retained.publishedSource.bucket ||
    version.target.expectedBucketOwner !==
      retained.publishedSource.expectedBucketOwner ||
    version.sha256 !== retained.sha256 ||
    !isPinnedItemSourceVersion(source.versionId) ||
    archiveHash(version.revision) !== archiveHash(source)
  )
    throw new ConflictError(
      'The retained copy does not match the sealed archive and published version',
    );
  const facts = {
    protocol: 'PUBLISHED_HISTORY_COPY_INTENT_V1' as const,
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    reservationEpoch: input.expectedReservationEpoch,
    reservationBindingHash: archive.reservation!.bindingHash,
    publicationHash: input.expectedPublicationHash,
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    source: Object.freeze({
      ...version.target,
      revision: source,
      sha256: version.sha256,
    }),
    historicalKey: file.historicalKey,
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type PublishedHistoryCopyIntent = ReturnType<
  typeof buildPublishedHistoryCopyIntent
>;
