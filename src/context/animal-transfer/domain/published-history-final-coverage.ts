import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import type { ArchiveFile } from './ownership-archive';
import { publishedHistoryFinalPermissionInput } from './published-history-final-permission';
import { sourceHashValid } from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import type { ItemRecipientFinalCoverageFile } from './transfer-item-recipient-final-coverage';

export type PublishedHistoryFinalCoverageInput = Readonly<{
  archiveId: string;
  expectedArchiveDefinitionHash: string;
  expectedReservationEpoch: number;
  expectedPublicationHash: string;
  expectedSourceManifestHash: string;
  requiredThrough: string;
}>;

export type PublishedHistoryFinalCoveragePageInput =
  PublishedHistoryFinalCoverageInput & Readonly<{ afterSourceFileId?: string }>;

export type PublishedHistoryFinalMediaRegistrationInput =
  PublishedHistoryFinalCoverageInput &
    Readonly<{
      fileId: string;
      expectedFileDefinitionHash: string;
      expectedVersionObservationHash: string;
    }>;

export function publishedHistoryFinalMediaRegistrationInput(
  raw: PublishedHistoryFinalMediaRegistrationInput,
) {
  if (
    ![
      raw?.fileId,
      raw?.expectedFileDefinitionHash,
      raw?.expectedVersionObservationHash,
    ].every(sourceHashValid)
  )
    throw new ConflictError(
      'Invalid published history final media registration identity',
    );
  return Object.freeze({
    ...publishedHistoryFinalCoverageInput(raw),
    fileId: raw.fileId,
    expectedFileDefinitionHash: raw.expectedFileDefinitionHash,
    expectedVersionObservationHash: raw.expectedVersionObservationHash,
  });
}

export type PublishedHistoryFinalCoverageRow = ItemRecipientFinalCoverageFile &
  Readonly<{ sourceFileId: string; sourceDefinitionHash: string }>;

export type PublishedHistoryFinalCoveragePage = Readonly<{
  archiveDefinitionHash: string;
  reservationBindingHash: string;
  sourceArchiveId: string;
  publicationHash: string;
  sourceManifestHash: string;
  sourceFileCount: number;
  sourceFilesDigest: string;
  rows: readonly PublishedHistoryFinalCoverageRow[];
}>;

export type PublishedHistoryPreparedCoveragePage = Omit<
  PublishedHistoryFinalCoveragePage,
  'rows'
> &
  Readonly<{
    rows: readonly (PublishedHistoryFinalCoverageRow &
      Readonly<{ registrationDefinitionHash: string }>)[];
  }>;

export type PublishedHistoryRetainedEntryPage = Readonly<{
  reservationBindingHash: string;
  sourceArchiveId: string;
  sourceEntryCount: number;
  sourceEntriesDigest: string;
  rows: readonly Readonly<{
    sourceEntryId: string;
    sourceContentHash: string;
    entryId: string;
    contentHash: string;
  }>[];
}>;

export type PublishedHistoryRetainedEntryPageInput =
  PublishedHistoryFinalCoverageInput &
    Readonly<{ afterSourceEntryId?: string }>;

export function publishedHistoryFinalCoverageInput(
  raw: PublishedHistoryFinalCoveragePageInput,
): PublishedHistoryFinalCoveragePageInput {
  if (
    !raw ||
    !isUuid(raw.archiveId) ||
    ![
      raw.expectedArchiveDefinitionHash,
      raw.expectedPublicationHash,
      raw.expectedSourceManifestHash,
    ].every(sourceHashValid) ||
    !Number.isSafeInteger(raw.expectedReservationEpoch) ||
    raw.expectedReservationEpoch < 1 ||
    (raw.afterSourceFileId !== undefined &&
      !sourceHashValid(raw.afterSourceFileId))
  )
    throw new ConflictError(
      'Invalid published history final coverage selection',
    );
  historicalPutEvidenceTime(raw.requiredThrough);
  return Object.freeze({
    archiveId: raw.archiveId,
    expectedArchiveDefinitionHash: raw.expectedArchiveDefinitionHash,
    expectedReservationEpoch: raw.expectedReservationEpoch,
    expectedPublicationHash: raw.expectedPublicationHash,
    expectedSourceManifestHash: raw.expectedSourceManifestHash,
    requiredThrough: raw.requiredThrough,
    afterSourceFileId: raw.afterSourceFileId,
  });
}

/** Recreates the original selections. The repository must still verify all records. */
export function publishedHistoryFinalCoverageSelection(
  input: PublishedHistoryFinalCoverageInput,
  file: ArchiveFile,
) {
  const historical = file.publishedHistoryPutPermission;
  const staging = file.publishedHistoryStagingPutPermission;
  const final = file.publishedHistoryFinalPutPermission;
  if (!historical?.artifact || !staging?.artifact || !final?.artifact)
    throw new ConflictError(
      'The retained file has an incomplete copy permission chain',
    );
  return publishedHistoryFinalPermissionInput({
    staging: {
      selection: {
        archiveId: input.archiveId,
        fileId: file.id,
        expectedFileDefinitionHash: file.definitionHash,
        expectedPublicationHash: input.expectedPublicationHash,
        expectedReservationEpoch: input.expectedReservationEpoch,
        expectedIntentHash:
          file.publishedHistoryCopyIntent?.definitionHash ?? '',
        dispatcherInstanceId: historical.dispatcherInstanceId,
        expectedControlsHash: historical.destinationControlsHash,
        expectedAccreditationHash: historical.accreditationHash,
        expectedAttemptDefinitionHash: historical.attemptDefinitionHash,
        expectedProtectionHash: historical.protectionHash,
        expectedArtifactHash: historical.artifact.artifactHash,
        transportRequestHash: historical.transportRequestHash,
        requiredThrough: historical.requiredThrough,
      },
      expectedPermissionHash: staging.historicalPermissionHash,
      expectedVersionObservationHash: staging.versionObservationHash,
      expectedStagingIntentHash:
        file.publishedHistoryStagingIntent?.definitionHash ?? '',
      dispatcherInstanceId: staging.dispatcherInstanceId,
      expectedControlsHash: staging.destinationControlsHash,
      expectedAccreditationHash: staging.accreditationHash,
      expectedAttemptDefinitionHash: staging.attemptDefinitionHash,
      expectedProtectionHash: staging.protectionHash,
      expectedArtifactHash: staging.artifact.artifactHash,
      transportRequestHash: staging.transportRequestHash,
      requiredThrough: staging.requiredThrough,
    },
    expectedStagingPermissionHash: final.stagingPermissionHash,
    expectedStagingVersionObservationHash: final.versionObservationHash,
    expectedFinalIntentHash:
      file.publishedHistoryFinalIntent?.definitionHash ?? '',
    dispatcherInstanceId: final.dispatcherInstanceId,
    expectedControlsHash: final.destinationControlsHash,
    expectedAccreditationHash: final.accreditationHash,
    expectedAttemptDefinitionHash: final.attemptDefinitionHash,
    expectedProtectionHash: final.protectionHash,
    expectedArtifactHash: final.artifact.artifactHash,
    transportRequestHash: final.transportRequestHash,
    requiredThrough: final.requiredThrough,
  });
}
