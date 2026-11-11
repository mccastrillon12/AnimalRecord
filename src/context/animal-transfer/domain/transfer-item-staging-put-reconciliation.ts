import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemHistoricalPutVersionScope,
  ItemStagingPutVersionEvidence,
  buildStagingPutVersionObservation,
  historicalPutEvidenceTime,
  matchStagingPutVersionEvidence,
} from './transfer-item-historical-put-reconciliation';
import type { ItemStagingPutAttempt } from './transfer-item-staging-put-attempt';
import type { ItemStagingPutPermission } from './transfer-item-staging-put-permission';

export type ItemStagingPutVersionRecord = Readonly<{
  observation: ReturnType<typeof buildStagingPutVersionObservation>;
  evidence: ItemStagingPutVersionEvidence;
}>;

export type ItemStagingPutVersionContext = Readonly<{
  definition: ItemStagingPutAttempt;
  permission: ItemStagingPutPermission;
  versionRecord?: ItemStagingPutVersionRecord;
}>;

export interface ItemStagingPutVersionEvidenceReader {
  readStagingVersionEvidence(
    scope: ItemHistoricalPutVersionScope,
    expectedEvidenceHash: string,
  ): Promise<ItemStagingPutVersionEvidence | null>;
}

const invalid = () =>
  new ConflictError('The staging PUT version evidence is inconsistent');

export function stagingPutVersionScope({
  definition,
  permission,
}: ItemStagingPutVersionContext): ItemHistoricalPutVersionScope {
  const { permissionHash, ...marker } = permission;
  const { definitionHash, ...attempt } = definition;
  const { bucket, key, expectedBucketOwner, contentLength, checksumSHA256 } =
    definition.request;
  if (
    marker.protocol !== 'ITEM_STAGING_PUT_PERMISSION_V1' ||
    marker.state !== 'MAY_RUN' ||
    marker.attemptId !== definition.id ||
    marker.attemptDefinitionHash !== definitionHash ||
    marker.artifact.attemptDefinitionHash !== definitionHash ||
    marker.artifact.size !== contentLength ||
    marker.artifact.sha256 !== definition.read.sha256 ||
    Buffer.from(marker.artifact.sha256, 'hex').toString('base64') !==
      checksumSHA256 ||
    archiveHash(attempt) !== definitionHash ||
    archiveHash(marker) !== permissionHash
  )
    throw invalid();
  return Object.freeze({
    authorizationId: marker.authorizationId,
    permissionHash,
    target: Object.freeze({ bucket, key, expectedBucketOwner }),
    size: contentLength,
    sha256: marker.artifact.sha256,
  });
}

export function matchStagingPutVersionRecord(
  context: ItemStagingPutVersionContext,
  raw: ItemStagingPutVersionRecord,
): ItemStagingPutVersionRecord {
  if (!raw?.observation) throw invalid();
  const checkedAt = historicalPutEvidenceTime(raw.observation.checkedAt);
  if (checkedAt < historicalPutEvidenceTime(context.permission.admittedAt))
    throw invalid();
  const scope = stagingPutVersionScope(context);
  const evidence = matchStagingPutVersionEvidence(
    scope,
    raw.evidence,
    raw.observation.evidenceHash,
  );
  const observation = buildStagingPutVersionObservation(
    scope,
    evidence,
    raw.observation.evidenceHash,
    checkedAt,
    raw.observation.requiredThrough,
  );
  const record = { observation, evidence };
  if (!isDeepStrictEqual(raw, record)) throw invalid();
  return Object.freeze(record);
}
