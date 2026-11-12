import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import type { PublishedHistoryPutAttempt } from './published-history-copy';
import {
  PublishedHistoryPutPermission,
  PublishedHistoryPutPermissionInput,
  publishedHistoryPutPermissionInput,
} from './published-history-put-permission';
import { sourceHashValid } from './transfer-item-historical-observation';
import {
  ItemHistoricalPutVersionScope,
  PublishedHistoryPutVersionEvidence,
  buildPublishedHistoryPutVersionObservation,
  historicalPutEvidenceTime,
  matchPublishedHistoryPutVersionEvidence,
} from './transfer-item-historical-put-reconciliation';

const invalid = () =>
  new ConflictError(
    'The published history PUT version does not match the original permission',
  );

export type PublishedHistoryPutReconciliationInput = Readonly<{
  selection: PublishedHistoryPutPermissionInput;
  expectedPermissionHash: string;
  expectedEvidenceHash: string;
  requiredThrough: string;
}>;

export function publishedHistoryPutReconciliationInput(
  raw: PublishedHistoryPutReconciliationInput,
) {
  if (
    ![raw?.expectedPermissionHash, raw?.expectedEvidenceHash].every(
      sourceHashValid,
    )
  )
    throw invalid();
  historicalPutEvidenceTime(raw.requiredThrough);
  return Object.freeze({
    selection: publishedHistoryPutPermissionInput(raw.selection),
    expectedPermissionHash: raw.expectedPermissionHash,
    expectedEvidenceHash: raw.expectedEvidenceHash,
    requiredThrough: raw.requiredThrough,
  });
}

export type PublishedHistoryPutVersionRecord = Readonly<{
  observation: ReturnType<typeof buildPublishedHistoryPutVersionObservation>;
  evidence: PublishedHistoryPutVersionEvidence;
}>;
export type PublishedHistoryPutVersionContext = Readonly<{
  definition: PublishedHistoryPutAttempt;
  permission: PublishedHistoryPutPermission;
  versionRecord?: PublishedHistoryPutVersionRecord;
}>;

export interface PublishedHistoryPutVersionEvidenceReader {
  readVersionEvidence(
    scope: ItemHistoricalPutVersionScope,
    expectedHash: string,
  ): Promise<PublishedHistoryPutVersionEvidence | null>;
}

export function publishedHistoryPutVersionScope({
  definition,
  permission,
}: PublishedHistoryPutVersionContext): ItemHistoricalPutVersionScope {
  const { permissionHash, ...marker } = permission;
  const { definitionHash, ...attempt } = definition;
  if (
    definition.protocol !== 'PUBLISHED_HISTORY_PUT_ATTEMPT_V1' ||
    marker.protocol !== 'PUBLISHED_HISTORY_PUT_PERMISSION_V1' ||
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

export function matchPublishedHistoryPutVersionRecord(
  context: PublishedHistoryPutVersionContext,
  raw: PublishedHistoryPutVersionRecord,
) {
  if (!raw?.observation) throw invalid();
  const scope = publishedHistoryPutVersionScope(context);
  const { evidenceHash, checkedAt, requiredThrough } = raw.observation;
  const checked = historicalPutEvidenceTime(checkedAt);
  if (checked < historicalPutEvidenceTime(context.permission.admittedAt))
    throw invalid();
  const evidence = matchPublishedHistoryPutVersionEvidence(
    scope,
    raw.evidence,
    evidenceHash,
  );
  const observation = buildPublishedHistoryPutVersionObservation(
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
