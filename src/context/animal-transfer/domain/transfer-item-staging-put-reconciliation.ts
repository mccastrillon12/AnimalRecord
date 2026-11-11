import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemCopyIntentContext,
  ItemPutVersionSource,
  buildItemRecipientFinalCopyIntent,
} from './transfer-item-copy-intent';
import { persistedItemStagingIntent } from './transfer-item-historical-observation';
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

export function buildFinalFromStagingPutVersion(
  context: ItemCopyIntentContext,
  manifestHash: string,
  original: ItemStagingPutVersionContext,
  source: ItemPutVersionSource,
) {
  const { definition, permission, versionRecord } = original;
  const staging = persistedItemStagingIntent(context);
  const historical = staging.predecessor?.historicalPutVersion;
  if (
    !historical ||
    !versionRecord ||
    definition.id !== source.attemptId ||
    definition.definitionHash !== source.attemptDefinitionHash ||
    permission.authorizationId !== source.authorizationId ||
    permission.permissionHash !== source.permissionHash ||
    definition.manifestHash !== manifestHash ||
    definition.copyIntentId !== staging.id ||
    definition.copyIntentDefinitionHash !== staging.definitionHash ||
    !isDeepStrictEqual(definition.binding, staging.binding) ||
    !isDeepStrictEqual(definition.predecessor, historical)
  )
    throw invalid();
  const record = matchStagingPutVersionRecord(original, versionRecord);
  const { observationHash, revision, scope } = record.observation;
  if (
    observationHash !== source.versionObservationHash ||
    record.evidence.conservationControlsHash !==
      source.conservationControlsHash ||
    scope.target.bucket !== staging.bucket
  )
    throw invalid();
  const intent = buildItemRecipientFinalCopyIntent(
    context.file,
    staging,
    manifestHash,
    {
      key: scope.target.key,
      expectedBucketOwner: scope.target.expectedBucketOwner,
      revision,
      sha256: scope.sha256,
    },
    source,
  );
  return Object.freeze({ intent, versionRecord: record });
}
