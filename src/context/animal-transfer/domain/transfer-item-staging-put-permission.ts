import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemCopyGateRecord,
  ItemStagingPutAttemptRecord,
  buildItemCopyGateDefinition,
  captureItemCopyGate,
  nextCopyGateRevision,
} from './transfer-item-copy-record';
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import {
  protectStagingPutDestinationFromAccreditation,
  putDestinationAdmissionWindowContains,
} from './transfer-item-historical-put-destination-protection';
import {
  ItemHistoricalPutVersionContext,
  assertHistoricalPutVersionUsable,
  historicalPutEvidenceTime,
  matchHistoricalPutVersionRecord,
} from './transfer-item-historical-put-reconciliation';
import {
  ItemStagingPutArtifactSeal,
  buildStagingPutArtifactSeal,
  captureStagingPutArtifactSeal,
} from './transfer-item-staging-put-artifact';

type PermissionFacts = Readonly<{
  authorizationId: string;
  expectedGateRevision: number;
  transportRequestHash: string;
  artifact: ItemStagingPutArtifactSeal;
  admittedAt: string;
}>;

const invalid = () =>
  new ConflictError('The first staging PUT permission is inconsistent');

function stagingPermissionRecord(
  gate: ItemCopyGateRecord,
  attempt: ItemStagingPutAttemptRecord,
  historical: ItemHistoricalPutVersionContext,
  facts: PermissionFacts,
) {
  const { definition, destinationProtection, stagingDestinationAccreditation } =
    attempt;
  const {
    authorizationId,
    expectedGateRevision,
    transportRequestHash,
    admittedAt,
  } = facts;
  const { predecessor } = definition;
  const { transferId, itemId, requestVersion, observedSeal, observedSealHash } =
    definition.binding;
  const originalGate = buildItemCopyGateDefinition({
    transferId,
    itemId,
    requestVersion,
    observedSeal,
    observedSealHash,
  });
  captureItemCopyGate(gate, originalGate);
  if (
    attempt.gateId !== originalGate.id ||
    attempt.state !== 'INTENDED' ||
    definition.origin !== 'INITIAL' ||
    definition.ordinal !== 1 ||
    !profileIdValid(authorizationId) ||
    [
      definition.id,
      definition.dispatcherInstanceId,
      predecessor.attemptId,
      predecessor.authorizationId,
    ].includes(authorizationId) ||
    !sourceHashValid(transportRequestHash) ||
    !sourceHashValid(destinationProtection?.accreditationHash) ||
    !historical.versionRecord
  )
    throw invalid();
  const protection = protectStagingPutDestinationFromAccreditation(
    definition,
    destinationProtection.controlsHash,
    destinationProtection.accreditationHash,
    stagingDestinationAccreditation,
  );
  const artifact = captureStagingPutArtifactSeal(facts.artifact);
  const expectedSeal = buildStagingPutArtifactSeal(
    definition,
    protection.protectionHash,
    artifact,
    artifact.observedAt,
  );
  const version = matchHistoricalPutVersionRecord(
    historical,
    historical.versionRecord,
  );
  const {
    revision,
    scope,
    observationHash,
    checkedAt: versionObservedAt,
  } = version.observation;
  const admitted = historicalPutEvidenceTime(admittedAt);
  const observed = historicalPutEvidenceTime(artifact.observedAt);
  if (
    !isDeepStrictEqual(destinationProtection, protection) ||
    expectedSeal.artifactHash !== artifact.artifactHash ||
    predecessor.attemptId !== historical.definition.id ||
    predecessor.attemptDefinitionHash !==
      historical.definition.definitionHash ||
    predecessor.authorizationId !== historical.permission.authorizationId ||
    predecessor.permissionHash !== historical.permission.permissionHash ||
    predecessor.versionObservationHash !== observationHash ||
    predecessor.conservationControlsHash !==
      version.evidence.conservationControlsHash ||
    !isDeepStrictEqual(definition.read, {
      ...scope.target,
      versionId: revision.versionId,
      ifMatch: revision.etag,
      contentLength: revision.size,
      sha256: scope.sha256,
    }) ||
    observed < historicalPutEvidenceTime(versionObservedAt) ||
    admitted < observed ||
    !putDestinationAdmissionWindowContains(protection, admitted)
  )
    throw invalid();
  assertHistoricalPutVersionUsable(
    version,
    predecessor.requiredThrough,
    admitted,
  );

  const record = {
    protocol: 'ITEM_STAGING_PUT_PERMISSION_V1' as const,
    state: 'MAY_RUN' as const,
    authorizationId,
    gateId: gate.id,
    gateDefinitionHash: gate.definitionHash,
    expectedGateRevision,
    gateRevision: nextCopyGateRevision(expectedGateRevision),
    attemptId: definition.id,
    attemptDefinitionHash: definition.definitionHash,
    dispatcherInstanceId: definition.dispatcherInstanceId,
    artifact,
    transportRequestHash,
    protectionHash: protection.protectionHash,
    accreditationHash: protection.accreditationHash,
    historicalPermissionHash: predecessor.permissionHash,
    versionObservationHash: observationHash,
    conservationControlsHash: predecessor.conservationControlsHash,
    destinationControlsHash: protection.controlsHash,
    admittedAt,
  };
  return Object.freeze({ ...record, permissionHash: archiveHash(record) });
}

export type ItemStagingPutPermission = ReturnType<
  typeof stagingPermissionRecord
>;

export type ItemStagingPutPermissionInput = Readonly<{
  authorizationId: string;
  expectedGateRevision: number;
  transportRequestHash: string;
  expectedArtifactHash: string;
  openedArtifactSeal: ItemStagingPutArtifactSeal;
  checkedAt: number;
}>;

/** Proposes a marker for the caller's transaction. The held reader and physical request are caller-owned. */
export function buildInitialStagingPutPermission(
  gate: ItemCopyGateRecord,
  attempt: ItemStagingPutAttemptRecord,
  historical: ItemHistoricalPutVersionContext,
  input: ItemStagingPutPermissionInput,
): ItemStagingPutPermission {
  if (
    gate.state !== 'OPEN' ||
    gate.revision !== input.expectedGateRevision ||
    !sourceHashValid(input.expectedArtifactHash) ||
    input.openedArtifactSeal?.artifactHash !== input.expectedArtifactHash ||
    !putDestinationAdmissionWindowContains(
      attempt.destinationProtection,
      input.checkedAt,
    )
  )
    throw invalid();
  return stagingPermissionRecord(gate, attempt, historical, {
    authorizationId: input.authorizationId,
    expectedGateRevision: input.expectedGateRevision,
    transportRequestHash: input.transportRequestHash,
    artifact: input.openedArtifactSeal,
    admittedAt: new Date(input.checkedAt).toISOString(),
  });
}

/** A historical read preserves MAY_RUN even after revocation and grants no delegation. */
export function observeInitialStagingPutPermission(
  gate: ItemCopyGateRecord,
  attempt: ItemStagingPutAttemptRecord,
  historical: ItemHistoricalPutVersionContext,
  stored: ItemStagingPutPermission,
  expectedAuthorizationId: string,
) {
  if (!stored) throw invalid();
  const permission = stagingPermissionRecord(gate, attempt, historical, stored);
  if (
    permission.authorizationId !== expectedAuthorizationId ||
    gate.revision < permission.gateRevision ||
    (gate.state === 'REVOKED' && gate.revision === permission.gateRevision) ||
    !isDeepStrictEqual(stored, permission)
  )
    throw invalid();
  return Object.freeze({
    permission,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  });
}
