import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import type { PublishedHistoryFinalPutAttempt } from './published-history-final';
import {
  PublishedHistoryFinalPutPermission,
  PublishedHistoryFinalPermissionInput,
  publishedHistoryFinalPermissionInput,
} from './published-history-final-permission';
import { sourceHashValid } from './transfer-item-historical-observation';
import {
  ItemHistoricalPutVersionScope,
  PublishedHistoryFinalVersionEvidence,
  buildPublishedHistoryFinalVersionObservation,
  historicalPutEvidenceTime,
  matchPublishedHistoryFinalVersionEvidence,
} from './transfer-item-historical-put-reconciliation';

const invalid = () =>
  new ConflictError(
    'The published history final PUT version does not match the original permission',
  );

export type PublishedHistoryFinalPutReconciliationInput = Readonly<{
  selection: PublishedHistoryFinalPermissionInput;
  expectedPermissionHash: string;
  expectedEvidenceHash: string;
  requiredThrough: string;
}>;

export function publishedHistoryFinalPutReconciliationInput(
  raw: PublishedHistoryFinalPutReconciliationInput,
) {
  if (
    ![raw?.expectedPermissionHash, raw?.expectedEvidenceHash].every(
      sourceHashValid,
    )
  )
    throw invalid();
  historicalPutEvidenceTime(raw.requiredThrough);
  return Object.freeze({
    selection: publishedHistoryFinalPermissionInput(raw.selection),
    expectedPermissionHash: raw.expectedPermissionHash,
    expectedEvidenceHash: raw.expectedEvidenceHash,
    requiredThrough: raw.requiredThrough,
  });
}

export type PublishedHistoryFinalPutVersionRecord = Readonly<{
  observation: ReturnType<typeof buildPublishedHistoryFinalVersionObservation>;
  evidence: PublishedHistoryFinalVersionEvidence;
}>;
export type PublishedHistoryFinalPutVersionContext = Readonly<{
  definition: PublishedHistoryFinalPutAttempt;
  permission: PublishedHistoryFinalPutPermission;
  versionRecord?: PublishedHistoryFinalPutVersionRecord;
}>;

export interface PublishedHistoryFinalVersionEvidenceReader {
  readVersionEvidence(
    scope: ItemHistoricalPutVersionScope,
    expectedHash: string,
  ): Promise<PublishedHistoryFinalVersionEvidence | null>;
}

export function publishedHistoryFinalPutVersionScope({
  definition,
  permission,
}: PublishedHistoryFinalPutVersionContext): ItemHistoricalPutVersionScope {
  const { permissionHash, ...marker } = permission;
  const { definitionHash, ...attempt } = definition;
  if (
    definition.protocol !== 'PUBLISHED_HISTORY_FINAL_PUT_ATTEMPT_V1' ||
    marker.protocol !== 'PUBLISHED_HISTORY_FINAL_PUT_PERMISSION_V1' ||
    marker.state !== 'MAY_RUN' ||
    marker.attemptId !== definition.id ||
    marker.attemptDefinitionHash !== definitionHash ||
    marker.artifact?.attemptDefinitionHash !== definitionHash ||
    marker.artifact.sha256 !== definition.read.sha256 ||
    archiveHash(attempt) !== definitionHash ||
    archiveHash(marker) !== permissionHash
  )
    throw invalid();
  const { bucket, key, expectedBucketOwner, contentLength } =
    definition.request;
  return Object.freeze({
    authorizationId: marker.authorizationId,
    permissionHash,
    target: Object.freeze({ bucket, key, expectedBucketOwner }),
    size: contentLength,
    sha256: definition.read.sha256,
  });
}

export function matchPublishedHistoryFinalPutVersionRecord(
  context: PublishedHistoryFinalPutVersionContext,
  raw: PublishedHistoryFinalPutVersionRecord,
) {
  if (!raw?.observation) throw invalid();
  const scope = publishedHistoryFinalPutVersionScope(context);
  const { evidenceHash, checkedAt, requiredThrough } = raw.observation;
  const checked = historicalPutEvidenceTime(checkedAt);
  if (checked < historicalPutEvidenceTime(context.permission.admittedAt))
    throw invalid();
  const evidence = matchPublishedHistoryFinalVersionEvidence(
    scope,
    raw.evidence,
    evidenceHash,
  );
  const observation = buildPublishedHistoryFinalVersionObservation(
    scope,
    evidence,
    evidenceHash,
    checked,
    requiredThrough,
  );
  const rebuilt = { observation, evidence };
  if (!isDeepStrictEqual(raw, rebuilt)) throw invalid();
  return Object.freeze(rebuilt);
}
