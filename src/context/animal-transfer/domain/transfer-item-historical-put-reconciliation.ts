import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash, ObjectRevision } from './ownership-archive';
import {
  captureItemObjectRevision,
  buildItemStagingCopyIntent,
  isPinnedItemSourceVersion,
  ItemArchiveCopyIntent,
  ItemCopyIntentContext,
  ItemHistoricalPutStagingSource,
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
export type ItemStagingPutVersionEvidence = Omit<
  ItemHistoricalPutVersionEvidence,
  'protocol'
> &
  Readonly<{ protocol: 'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1' }>;
export type ItemRecipientFinalPutVersionEvidence = Omit<
  ItemHistoricalPutVersionEvidence,
  'protocol'
> &
  Readonly<{ protocol: 'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1' }>;
export type PublishedHistoryPutVersionEvidence = Omit<
  ItemHistoricalPutVersionEvidence,
  'protocol'
> &
  Readonly<{ protocol: 'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1' }>;
type PutVersionEvidence =
  | ItemHistoricalPutVersionEvidence
  | ItemStagingPutVersionEvidence
  | ItemRecipientFinalPutVersionEvidence
  | PublishedHistoryPutVersionEvidence;

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
    signal?: AbortSignal,
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
  return matchPutVersionEvidence(
    scope,
    raw,
    expectedEvidenceHash,
    'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1',
  );
}

export function matchStagingPutVersionEvidence(
  scope: ItemHistoricalPutVersionScope,
  raw: ItemStagingPutVersionEvidence | null,
  expectedEvidenceHash: string,
) {
  return matchPutVersionEvidence(
    scope,
    raw,
    expectedEvidenceHash,
    'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1',
  );
}

export function matchRecipientFinalPutVersionEvidence(
  scope: ItemHistoricalPutVersionScope,
  raw: ItemRecipientFinalPutVersionEvidence | null,
  expectedEvidenceHash: string,
) {
  return matchPutVersionEvidence(
    scope,
    raw,
    expectedEvidenceHash,
    'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1',
  );
}

export function matchPublishedHistoryPutVersionEvidence(
  scope: ItemHistoricalPutVersionScope,
  raw: PublishedHistoryPutVersionEvidence | null,
  expectedEvidenceHash: string,
) {
  return matchPutVersionEvidence(
    scope,
    raw,
    expectedEvidenceHash,
    'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1',
  );
}

function matchPutVersionEvidence<
  Protocol extends PutVersionEvidence['protocol'],
>(
  scope: ItemHistoricalPutVersionScope,
  raw: PutVersionEvidence | null,
  expectedEvidenceHash: string,
  protocol: Protocol,
) {
  if (!raw) throw invalid();
  const revision = captureItemObjectRevision(raw.revision);
  const evidence = {
    protocol,
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
  evidence: PutVersionEvidence,
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
  return buildPutVersionObservation(
    scope,
    evidence,
    evidenceHash,
    checkedAt,
    requiredThrough,
    'ITEM_HISTORICAL_PUT_VERSION_OBSERVATION_V1',
  );
}

export function buildStagingPutVersionObservation(
  scope: ItemHistoricalPutVersionScope,
  evidence: ItemStagingPutVersionEvidence,
  evidenceHash: string,
  checkedAt: number,
  requiredThrough: string,
) {
  return buildPutVersionObservation(
    scope,
    evidence,
    evidenceHash,
    checkedAt,
    requiredThrough,
    'ITEM_STAGING_PUT_VERSION_OBSERVATION_V1',
  );
}

export function buildRecipientFinalPutVersionObservation(
  scope: ItemHistoricalPutVersionScope,
  evidence: ItemRecipientFinalPutVersionEvidence,
  evidenceHash: string,
  checkedAt: number,
  requiredThrough: string,
) {
  return buildPutVersionObservation(
    scope,
    evidence,
    evidenceHash,
    checkedAt,
    requiredThrough,
    'ITEM_RECIPIENT_FINAL_PUT_VERSION_OBSERVATION_V1',
  );
}

function buildPutVersionObservation<Protocol extends string>(
  scope: ItemHistoricalPutVersionScope,
  evidence: PutVersionEvidence,
  evidenceHash: string,
  checkedAt: number,
  requiredThrough: string,
  protocol: Protocol,
) {
  assertHistoricalPutConservationWindow(
    evidence,
    historicalPutEvidenceTime(requiredThrough),
    checkedAt,
  );
  const observation = {
    protocol,
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

export function buildPublishedHistoryPutVersionObservation(
  scope: ItemHistoricalPutVersionScope,
  evidence: PublishedHistoryPutVersionEvidence,
  evidenceHash: string,
  checkedAt: number,
  requiredThrough: string,
) {
  return buildPutVersionObservation(
    scope,
    evidence,
    evidenceHash,
    checkedAt,
    requiredThrough,
    'PUBLISHED_HISTORY_PUT_VERSION_OBSERVATION_V1',
  );
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
  record: Readonly<{
    evidence: PutVersionEvidence;
    observation: Pick<
      ItemHistoricalPutVersionRecord['observation'],
      'checkedAt' | 'requiredThrough'
    >;
  }>,
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

/** Builds a distinct predecessor without synthesizing a legacy byte observation. */
export function buildStagingFromHistoricalPutVersion(
  context: ItemCopyIntentContext,
  historical: ItemArchiveCopyIntent,
  manifestHash: string,
  original: ItemHistoricalPutVersionContext,
  source: ItemHistoricalPutStagingSource,
) {
  const { definition, permission, versionRecord } = original;
  if (
    !versionRecord ||
    definition.id !== source.attemptId ||
    definition.definitionHash !== source.attemptDefinitionHash ||
    permission.authorizationId !== source.authorizationId ||
    permission.permissionHash !== source.permissionHash ||
    versionRecord.observation.observationHash !==
      source.versionObservationHash ||
    versionRecord.evidence.conservationControlsHash !==
      source.conservationControlsHash ||
    definition.manifestHash !== manifestHash ||
    definition.copyIntentId !== historical.id ||
    definition.copyIntentDefinitionHash !== historical.definitionHash ||
    archiveHash(definition.binding) !== archiveHash(historical.binding)
  )
    throw invalid();
  const { revision, scope } = versionRecord.observation;
  const intent = buildItemStagingCopyIntent(
    context,
    historical,
    {
      intentId: historical.id,
      intentDefinitionHash: historical.definitionHash,
      bucket: scope.target.bucket,
      key: scope.target.key,
      revision,
      sha256: scope.sha256,
    },
    source,
  );
  return Object.freeze({ intent, versionRecord });
}
