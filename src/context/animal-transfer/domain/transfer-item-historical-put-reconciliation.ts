import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash, ObjectRevision } from './ownership-archive';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from './transfer-item-copy-intent';
import {
  HistoricalObjectRead,
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import type { ItemHistoricalPutAttemptV2 } from './transfer-item-historical-put-attempt';
import type { ItemHistoricalPutPermission } from './transfer-item-historical-put-permission';

export type ItemHistoricalPutReconciliationContext = Readonly<{
  definition: ItemHistoricalPutAttemptV2;
  permission: ItemHistoricalPutPermission;
}>;

const invalid = () =>
  new ConflictError('The historical PUT version evidence is inconsistent');

export function historicalPutVersionScope({
  definition,
  permission,
}: ItemHistoricalPutReconciliationContext) {
  const { permissionHash, ...marker } = permission;
  if (
    marker.state !== 'MAY_RUN' ||
    marker.attemptId !== definition.id ||
    marker.attemptDefinitionHash !== definition.definitionHash ||
    marker.artifactHash !== definition.artifact.artifactHash ||
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
    sha256: definition.artifact.sha256,
  });
}

export type ItemHistoricalPutVersionScope = ReturnType<
  typeof historicalPutVersionScope
>;

export type ItemHistoricalPutVersionEvidence = Readonly<{
  protocol: 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1';
  issuerId: string;
  scopeHash: string;
  revision: Readonly<ObjectRevision>;
  provenanceEvidenceHash: string;
  conservationEvidenceHash: string;
  conservationControlsHash: string;
  validFrom: string;
  validUntil: string;
}>;

/** Verifies provenance from the exact effect and independently accredits conservation of that version. */
export interface ItemHistoricalPutVersionEvidenceReader {
  readVersionEvidence(
    scope: ItemHistoricalPutVersionScope,
    expectedEvidenceHash: string,
  ): Promise<ItemHistoricalPutVersionEvidence | null>;
}

/** Read-only adapter must enforce the expected bucket owner and exact version/revision. */
export interface ItemHistoricalPutVersionReader {
  readVersion(
    target: ItemHistoricalPutVersionScope['target'],
    revision: Readonly<ObjectRevision>,
  ): Promise<HistoricalObjectRead>;
}

export function historicalPutEvidenceTime(value: string) {
  if (typeof value !== 'string') throw invalid();
  const at = Date.parse(value);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value)
    throw invalid();
  return at;
}

export function matchHistoricalPutVersionEvidence(
  scope: ItemHistoricalPutVersionScope,
  raw: ItemHistoricalPutVersionEvidence | null,
  expectedEvidenceHash: string,
) {
  if (!raw) throw invalid();
  const revision = captureItemObjectRevision(raw.revision);
  const evidence = {
    protocol: 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1' as const,
    issuerId: raw.issuerId,
    scopeHash: archiveHash(scope),
    revision,
    provenanceEvidenceHash: raw.provenanceEvidenceHash,
    conservationEvidenceHash: raw.conservationEvidenceHash,
    conservationControlsHash: raw.conservationControlsHash,
    validFrom: raw.validFrom,
    validUntil: raw.validUntil,
  };
  if (
    !isPinnedItemSourceVersion(revision.versionId) ||
    revision.size !== scope.size ||
    !profileIdValid(evidence.issuerId) ||
    ![
      evidence.provenanceEvidenceHash,
      evidence.conservationEvidenceHash,
      evidence.conservationControlsHash,
      expectedEvidenceHash,
    ].every(sourceHashValid) ||
    historicalPutEvidenceTime(evidence.validFrom) >=
      historicalPutEvidenceTime(evidence.validUntil) ||
    !isDeepStrictEqual(raw, evidence) ||
    archiveHash(evidence) !== expectedEvidenceHash
  )
    throw invalid();
  return Object.freeze(evidence);
}

export function assertHistoricalPutConservationWindow(
  evidence: ItemHistoricalPutVersionEvidence,
  requiredThrough: number,
  checkedAt: number,
) {
  if (
    !Number.isSafeInteger(checkedAt) ||
    !(
      historicalPutEvidenceTime(evidence.validFrom) <= checkedAt &&
      checkedAt <= requiredThrough &&
      requiredThrough < historicalPutEvidenceTime(evidence.validUntil)
    )
  )
    throw new ConflictError(
      'The historical PUT conservation window does not cover the required horizon',
    );
}

export function buildHistoricalPutVersionObservation(
  scope: ItemHistoricalPutVersionScope,
  evidence: ItemHistoricalPutVersionEvidence,
  evidenceHash: string,
  checkedAt: number,
  requiredThrough: string,
) {
  assertHistoricalPutConservationWindow(
    evidence,
    historicalPutEvidenceTime(requiredThrough),
    checkedAt,
  );
  const observation = {
    protocol: 'ITEM_HISTORICAL_PUT_VERSION_OBSERVATION_V1' as const,
    scope,
    revision: evidence.revision,
    evidenceHash,
    conservationControlsHash: evidence.conservationControlsHash,
    checkedAt: new Date(checkedAt).toISOString(),
    requiredThrough,
    bytes: 'MATCH' as const,
    conservation: 'ACCREDITED_FOR_HORIZON' as const,
    stableCut: 'NOT_ASSESSED' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({
    ...observation,
    observationHash: archiveHash(observation),
  });
}

export type ItemHistoricalPutVersionRecord = Readonly<{
  observation: ReturnType<typeof buildHistoricalPutVersionObservation>;
  evidence: ItemHistoricalPutVersionEvidence;
}>;
export type ItemHistoricalPutVersionContext =
  ItemHistoricalPutReconciliationContext &
    Readonly<{ versionRecord?: ItemHistoricalPutVersionRecord }>;

export function matchHistoricalPutVersionRecord(
  context: ItemHistoricalPutReconciliationContext,
  raw: ItemHistoricalPutVersionRecord,
): ItemHistoricalPutVersionRecord {
  if (!raw?.observation) throw invalid();
  const scope = historicalPutVersionScope(context);
  const evidence = matchHistoricalPutVersionEvidence(
    scope,
    raw.evidence,
    raw.observation.evidenceHash,
  );
  const observation = buildHistoricalPutVersionObservation(
    scope,
    evidence,
    raw.observation.evidenceHash,
    historicalPutEvidenceTime(raw.observation.checkedAt),
    raw.observation.requiredThrough,
  );
  const record = { observation, evidence };
  if (!isDeepStrictEqual(raw, record)) throw invalid();
  return Object.freeze(record);
}

/** Local time guard for a revalidated record. Its generation must be fenced in the caller transaction. */
export function assertHistoricalPutVersionUsable(
  record: ItemHistoricalPutVersionRecord,
  requiredThrough: string,
  checkedAt: number,
) {
  const horizon = historicalPutEvidenceTime(requiredThrough);
  if (
    checkedAt < historicalPutEvidenceTime(record.observation.checkedAt) ||
    horizon > historicalPutEvidenceTime(record.observation.requiredThrough)
  )
    throw invalid();
  assertHistoricalPutConservationWindow(record.evidence, horizon, checkedAt);
}
