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
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import type { ItemHistoricalPutAttemptV2 } from './transfer-item-historical-put-attempt';

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
  const intent = publishedHistoryCopyIntentDefinition(input, archive, file);
  if (
    version.requiredThrough !== input.requiredThrough ||
    version.fileDefinitionHash !== file.retained!.sourceDefinitionHash ||
    version.target.key !== intent.source.key ||
    version.target.bucket !== intent.source.bucket ||
    version.target.expectedBucketOwner !== intent.source.expectedBucketOwner ||
    version.sha256 !== intent.source.sha256 ||
    archiveHash(version.revision) !== archiveHash(intent.source.revision)
  )
    throw new ConflictError('The published source version changed');
  return intent;
}

/** Rebuilds local identity only. Storage evidence is checked by the consuming leg. */
export function publishedHistoryCopyIntentDefinition(
  input: PublishedHistoryCopyInput,
  archive: OwnershipArchive,
  file: ArchiveFile,
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
    !sourceHashValid(retained.sha256) ||
    !isPinnedItemSourceVersion(source.versionId)
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
      bucket: retained.publishedSource.bucket,
      key: file.sourceKey,
      expectedBucketOwner: retained.publishedSource.expectedBucketOwner,
      revision: source,
      sha256: retained.sha256,
    }),
    historicalKey: file.historicalKey,
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type PublishedHistoryCopyIntent = ReturnType<
  typeof buildPublishedHistoryCopyIntent
>;

export type PublishedHistoryCopyAttemptInput = PublishedHistoryCopyInput &
  Readonly<{
    expectedIntentHash: string;
    dispatcherInstanceId: string;
  }>;

export function publishedHistoryCopyAttemptInput(
  raw: PublishedHistoryCopyAttemptInput,
) {
  if (
    !sourceHashValid(raw?.expectedIntentHash) ||
    !profileIdValid(raw?.dispatcherInstanceId)
  )
    throw new InvalidArgumentError(
      'Invalid published history copy attempt selection',
    );
  return Object.freeze({
    ...publishedHistoryCopyInput(raw),
    expectedIntentHash: raw.expectedIntentHash,
    dispatcherInstanceId: raw.dispatcherInstanceId,
  });
}

export type PublishedHistoryCopyRepresentation = Pick<
  ItemHistoricalPutAttemptV2['request'],
  'contentType' | 'contentEncoding' | 'contentLanguage' | 'contentDisposition'
>;

export function buildPublishedHistoryPutAttempt(
  intent: PublishedHistoryCopyIntent,
  input: PublishedHistoryCopyAttemptInput,
  representation: PublishedHistoryCopyRepresentation,
) {
  const { definitionHash, ...intentFacts } = intent;
  const { source } = intent;
  const { versionId, etag, size } = source.revision;
  if (
    definitionHash !== input.expectedIntentHash ||
    archiveHash(intentFacts) !== definitionHash ||
    !isPinnedItemSourceVersion(versionId)
  )
    throw new ConflictError(
      'The published history copy attempt requires its original intent',
    );
  const protocol = 'PUBLISHED_HISTORY_PUT_ATTEMPT_V1' as const;
  const { contentType, contentEncoding, contentLanguage, contentDisposition } =
    representation;
  const facts = {
    protocol,
    id: archiveHash([protocol, definitionHash, 1]),
    ordinal: 1 as const,
    operation: 'PUT_OBJECT' as const,
    intentDefinitionHash: definitionHash,
    dispatcherInstanceId: input.dispatcherInstanceId,
    read: Object.freeze({
      bucket: source.bucket,
      key: source.key,
      expectedBucketOwner: source.expectedBucketOwner,
      versionId,
      ifMatch: etag,
      contentLength: size,
      sha256: source.sha256,
    }),
    request: Object.freeze({
      bucket: source.bucket,
      key: intent.historicalKey,
      expectedBucketOwner: source.expectedBucketOwner,
      ifNoneMatch: '*' as const,
      contentLength: size,
      checksumSHA256: Buffer.from(source.sha256, 'hex').toString('base64'),
      contentType,
      ...(contentEncoding === undefined ? {} : { contentEncoding }),
      ...(contentLanguage === undefined ? {} : { contentLanguage }),
      ...(contentDisposition === undefined ? {} : { contentDisposition }),
      cacheControl: 'private, no-store' as const,
    }),
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type PublishedHistoryPutAttempt = ReturnType<
  typeof buildPublishedHistoryPutAttempt
>;

export type PublishedHistoryPutDeclarationInput =
  PublishedHistoryCopyAttemptInput &
    Readonly<{
      expectedControlsHash: string;
      expectedAccreditationHash: string;
    }>;

export type PublishedHistoryPutReadInput = PublishedHistoryPutDeclarationInput &
  Readonly<{
    expectedAttemptDefinitionHash: string;
    expectedProtectionHash: string;
  }>;

export function publishedHistoryPutReadInput(
  raw: PublishedHistoryPutReadInput,
) {
  if (
    ![
      raw?.expectedAttemptDefinitionHash,
      raw?.expectedProtectionHash,
      raw?.expectedControlsHash,
      raw?.expectedAccreditationHash,
    ].every(sourceHashValid)
  )
    throw new InvalidArgumentError(
      'Invalid published history PUT declaration pins',
    );
  return Object.freeze({
    ...publishedHistoryCopyAttemptInput(raw),
    expectedAttemptDefinitionHash: raw.expectedAttemptDefinitionHash,
    expectedProtectionHash: raw.expectedProtectionHash,
    expectedControlsHash: raw.expectedControlsHash,
    expectedAccreditationHash: raw.expectedAccreditationHash,
  });
}

export type PublishedHistoryPutDeclaration = Readonly<{
  state: 'INTENDED';
  attempt: PublishedHistoryPutAttempt;
  accreditation: import('./transfer-item-historical-put-destination-protection').PublishedHistoryPutDestinationAccreditation;
  protection: ReturnType<
    typeof import('./transfer-item-historical-put-destination-protection').protectPublishedHistoryPutDestination
  >;
}>;
