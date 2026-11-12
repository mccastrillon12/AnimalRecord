import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ArchiveFile, archiveHash } from './ownership-archive';
import type { PublishedHistoryCopyIntent } from './published-history-copy';
import {
  PublishedHistoryPutPermissionInput,
  publishedHistoryPutPermissionInput,
} from './published-history-put-permission';
import {
  PublishedHistoryPutVersionContext,
  matchPublishedHistoryPutVersionRecord,
} from './published-history-put-reconciliation';
import { sourceHashValid } from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';

const invalid = () =>
  new ConflictError(
    'The published history staging source does not match the reconciled historical version',
  );

export type PublishedHistoryStagingInput = Readonly<{
  selection: PublishedHistoryPutPermissionInput;
  expectedPermissionHash: string;
  expectedVersionObservationHash: string;
  requiredThrough: string;
}>;

export function publishedHistoryStagingInput(
  raw: PublishedHistoryStagingInput,
) {
  if (
    ![raw?.expectedPermissionHash, raw?.expectedVersionObservationHash].every(
      sourceHashValid,
    )
  )
    throw invalid();
  historicalPutEvidenceTime(raw.requiredThrough);
  return Object.freeze({
    selection: publishedHistoryPutPermissionInput(raw.selection),
    expectedPermissionHash: raw.expectedPermissionHash,
    expectedVersionObservationHash: raw.expectedVersionObservationHash,
    requiredThrough: raw.requiredThrough,
  });
}

export function buildPublishedHistoryStagingIntent(
  input: PublishedHistoryStagingInput,
  intent: PublishedHistoryCopyIntent,
  file: ArchiveFile,
  context: PublishedHistoryPutVersionContext,
) {
  const { permission, definition, versionRecord } = context;
  if (
    !versionRecord ||
    permission.permissionHash !== input.expectedPermissionHash ||
    definition.intentDefinitionHash !== intent.definitionHash ||
    file.definitionHash !== intent.fileDefinitionHash
  )
    throw invalid();
  const version = matchPublishedHistoryPutVersionRecord(context, versionRecord);
  const { observation } = version;
  const { target, sha256 } = observation.scope;
  if (
    observation.observationHash !== input.expectedVersionObservationHash ||
    historicalPutEvidenceTime(input.requiredThrough) >
      historicalPutEvidenceTime(observation.requiredThrough) ||
    target.bucket !== intent.source.bucket ||
    target.key !== intent.historicalKey ||
    target.expectedBucketOwner !== intent.source.expectedBucketOwner ||
    sha256 !== intent.source.sha256 ||
    observation.revision.size !== intent.source.revision.size ||
    target.key === file.recipientStagingKey
  )
    throw invalid();

  const protocol = 'PUBLISHED_HISTORY_STAGING_INTENT_V1' as const;
  const facts = {
    protocol,
    id: archiveHash([protocol, intent.definitionHash]),
    archiveId: intent.archiveId,
    fileId: intent.fileId,
    fileDefinitionHash: intent.fileDefinitionHash,
    reservationEpoch: intent.reservationEpoch,
    reservationBindingHash: intent.reservationBindingHash,
    historicalIntentHash: intent.definitionHash,
    predecessor: Object.freeze({
      authorizationId: permission.authorizationId,
      permissionHash: permission.permissionHash,
      versionObservationHash: observation.observationHash,
      conservationControlsHash: version.evidence.conservationControlsHash,
      requiredThrough: input.requiredThrough,
    }),
    source: Object.freeze({
      ...target,
      revision: observation.revision,
      sha256,
    }),
    destination: Object.freeze({
      bucket: target.bucket,
      key: file.recipientStagingKey,
      expectedBucketOwner: target.expectedBucketOwner,
      ifNoneMatch: '*' as const,
    }),
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type PublishedHistoryStagingIntent = ReturnType<
  typeof buildPublishedHistoryStagingIntent
>;
