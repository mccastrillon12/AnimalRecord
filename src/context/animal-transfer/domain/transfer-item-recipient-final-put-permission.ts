import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  ItemCopyGateRecord,
  ItemRecipientFinalPutAttemptRecord,
  buildItemCopyGateDefinition,
  captureItemCopyGate,
  nextCopyGateRevision,
} from './transfer-item-copy-record';
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import {
  protectRecipientFinalPutDestinationFromAccreditation,
  putDestinationAdmissionWindowContains,
} from './transfer-item-historical-put-destination-protection';
import {
  assertHistoricalPutVersionUsable,
  historicalPutEvidenceTime,
} from './transfer-item-historical-put-reconciliation';
import {
  ItemRecipientFinalPutArtifactSeal,
  buildRecipientFinalPutArtifactSeal,
  captureRecipientFinalPutArtifactSeal,
} from './transfer-item-staging-put-artifact';
import {
  ItemStagingPutVersionContext,
  matchStagingPutVersionRecord,
} from './transfer-item-staging-put-reconciliation';

type PermissionFacts = Readonly<{
  authorizationId: string;
  expectedGateRevision: number;
  transportRequestHash: string;
  artifact: ItemRecipientFinalPutArtifactSeal;
  admittedAt: string;
}>;

const invalid = () =>
  new ConflictError('The first recipient final PUT permission is inconsistent');

function recipientFinalPermissionRecord(
  gate: ItemCopyGateRecord,
  attempt: ItemRecipientFinalPutAttemptRecord,
  original: ItemStagingPutVersionContext,
  facts: PermissionFacts,
) {
  const { definition, destinationProtection, finalDestinationAccreditation } =
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
    attempt.row !== 'ATTEMPT' ||
    attempt.id !== definition.id ||
    attempt.copyIntentId !== definition.copyIntentId ||
    attempt.ordinal !== definition.ordinal ||
    attempt.state !== 'INTENDED' ||
    definition.origin !== 'INITIAL' ||
    definition.ordinal !== 1 ||
    !profileIdValid(authorizationId) ||
    [
      definition.id,
      definition.dispatcherInstanceId,
      original.definition.id,
      original.definition.dispatcherInstanceId,
      original.permission.authorizationId,
      original.definition.predecessor.attemptId,
      original.definition.predecessor.authorizationId,
    ].includes(authorizationId) ||
    !sourceHashValid(transportRequestHash) ||
    !sourceHashValid(destinationProtection?.accreditationHash) ||
    !original.versionRecord
  )
    throw invalid();

  const protection = protectRecipientFinalPutDestinationFromAccreditation(
    definition,
    destinationProtection.controlsHash,
    destinationProtection.accreditationHash,
    finalDestinationAccreditation,
  );
  const artifact = captureRecipientFinalPutArtifactSeal(facts.artifact);
  const expectedSeal = buildRecipientFinalPutArtifactSeal(
    definition,
    protection.protectionHash,
    artifact,
    artifact.observedAt,
  );
  const version = matchStagingPutVersionRecord(
    original,
    original.versionRecord,
  );
  const { revision, scope, observationHash, checkedAt } = version.observation;
  const admitted = historicalPutEvidenceTime(admittedAt);
  const observed = historicalPutEvidenceTime(artifact.observedAt);
  if (
    !isDeepStrictEqual(destinationProtection, protection) ||
    expectedSeal.artifactHash !== artifact.artifactHash ||
    predecessor.attemptId !== original.definition.id ||
    predecessor.attemptDefinitionHash !== original.definition.definitionHash ||
    predecessor.authorizationId !== original.permission.authorizationId ||
    predecessor.permissionHash !== original.permission.permissionHash ||
    predecessor.versionObservationHash !== observationHash ||
    predecessor.conservationControlsHash !==
      version.evidence.conservationControlsHash ||
    definition.manifestHash !== original.definition.manifestHash ||
    !isDeepStrictEqual(definition.binding, original.definition.binding) ||
    !isDeepStrictEqual(definition.read, {
      ...scope.target,
      versionId: revision.versionId,
      ifMatch: revision.etag,
      contentLength: revision.size,
      sha256: scope.sha256,
    }) ||
    observed < historicalPutEvidenceTime(checkedAt) ||
    admitted < observed ||
    !putDestinationAdmissionWindowContains(protection, admitted)
  )
    throw invalid();
  assertHistoricalPutVersionUsable(
    version,
    predecessor.requiredThrough,
    admitted,
  );

  const marker = {
    protocol: 'ITEM_RECIPIENT_FINAL_PUT_PERMISSION_V1' as const,
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
    stagingPermissionHash: predecessor.permissionHash,
    versionObservationHash: observationHash,
    conservationControlsHash: predecessor.conservationControlsHash,
    destinationControlsHash: protection.controlsHash,
    admittedAt,
  };
  return Object.freeze({ ...marker, permissionHash: archiveHash(marker) });
}

export type ItemRecipientFinalPutPermission = ReturnType<
  typeof recipientFinalPermissionRecord
>;

export type ItemRecipientFinalPutPermissionInput = Readonly<{
  authorizationId: string;
  expectedGateRevision: number;
  transportRequestHash: string;
  expectedArtifactHash: string;
  openedArtifactSeal: ItemRecipientFinalPutArtifactSeal;
  checkedAt: number;
}>;

/** A first permit requires an open gate and the held artifact for this exact attempt. */
export function buildInitialRecipientFinalPutPermission(
  gate: ItemCopyGateRecord,
  attempt: ItemRecipientFinalPutAttemptRecord,
  original: ItemStagingPutVersionContext,
  input: ItemRecipientFinalPutPermissionInput,
) {
  if (
    gate.state !== 'OPEN' ||
    gate.revision !== input.expectedGateRevision ||
    attempt.permission !== undefined ||
    !sourceHashValid(input.expectedArtifactHash) ||
    input.openedArtifactSeal?.artifactHash !== input.expectedArtifactHash ||
    !putDestinationAdmissionWindowContains(
      attempt.destinationProtection,
      input.checkedAt,
    )
  )
    throw invalid();
  return recipientFinalPermissionRecord(gate, attempt, original, {
    authorizationId: input.authorizationId,
    expectedGateRevision: input.expectedGateRevision,
    transportRequestHash: input.transportRequestHash,
    artifact: input.openedArtifactSeal,
    admittedAt: new Date(input.checkedAt).toISOString(),
  });
}

export function observeInitialRecipientFinalPutPermission(
  gate: ItemCopyGateRecord,
  attempt: ItemRecipientFinalPutAttemptRecord,
  original: ItemStagingPutVersionContext,
  stored: ItemRecipientFinalPutPermission,
  expectedAuthorizationId: string,
) {
  if (!stored) throw invalid();
  const permission = recipientFinalPermissionRecord(
    gate,
    attempt,
    original,
    stored,
  );
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
