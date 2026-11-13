import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  PublishedHistoryStagingPutDeclaration,
  PublishedHistoryStagingReadInput,
  publishedHistoryStagingReadInput,
} from './published-history-staging';
import { sourceHashValid } from './transfer-item-historical-observation';
import {
  protectPublishedHistoryStagingPutDestination,
  putDestinationAdmissionWindowContains,
} from './transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import type { ItemPutTransportReturn } from './transfer-item-historical-put-transport';
import {
  PublishedHistoryStagingPutArtifactSeal,
  buildPublishedHistoryStagingPutArtifactSeal,
  capturePublishedHistoryStagingPutArtifactSeal,
} from './transfer-item-staging-put-artifact';

const invalid = () =>
  new ConflictError(
    'The first published history staging PUT permission is inconsistent',
  );

export type PublishedHistoryStagingPermissionInput =
  PublishedHistoryStagingReadInput &
    Readonly<{ expectedArtifactHash: string; transportRequestHash: string }>;

export function publishedHistoryStagingPermissionInput(
  raw: PublishedHistoryStagingPermissionInput,
) {
  if (
    ![raw?.expectedArtifactHash, raw?.transportRequestHash].every(
      sourceHashValid,
    )
  )
    throw invalid();
  return Object.freeze({
    ...publishedHistoryStagingReadInput(raw),
    expectedArtifactHash: raw.expectedArtifactHash,
    transportRequestHash: raw.transportRequestHash,
  });
}

export type PublishedHistoryStagingHeldEvidence = Readonly<{
  openedArtifactSeal: PublishedHistoryStagingPutArtifactSeal;
  transportRequestHash: string;
}>;

export function buildPublishedHistoryStagingPermission(
  input: PublishedHistoryStagingPermissionInput,
  declaration: PublishedHistoryStagingPutDeclaration,
  evidence: PublishedHistoryStagingHeldEvidence,
  admittedAt: string,
) {
  const { attempt } = declaration;
  const { predecessor } = attempt;
  const protection = protectPublishedHistoryStagingPutDestination(
    attempt,
    input.expectedControlsHash,
    input.expectedAccreditationHash,
    declaration.accreditation,
  );
  const artifact = capturePublishedHistoryStagingPutArtifactSeal(
    evidence.openedArtifactSeal,
  );
  const rebuilt = buildPublishedHistoryStagingPutArtifactSeal(
    attempt,
    protection.protectionHash,
    artifact,
    artifact.observedAt,
  );
  const admitted = historicalPutEvidenceTime(admittedAt);
  if (
    declaration.state !== 'INTENDED' ||
    archiveHash(declaration.protection) !== archiveHash(protection) ||
    attempt.definitionHash !== input.expectedAttemptDefinitionHash ||
    attempt.intentDefinitionHash !== input.expectedStagingIntentHash ||
    attempt.dispatcherInstanceId !== input.dispatcherInstanceId ||
    predecessor.permissionHash !== input.expectedPermissionHash ||
    predecessor.versionObservationHash !==
      input.expectedVersionObservationHash ||
    predecessor.requiredThrough !== input.requiredThrough ||
    !sourceHashValid(predecessor.conservationControlsHash) ||
    protection.protectionHash !== input.expectedProtectionHash ||
    artifact.artifactHash !== input.expectedArtifactHash ||
    artifact.artifactHash !== rebuilt.artifactHash ||
    evidence.transportRequestHash !== input.transportRequestHash ||
    !sourceHashValid(evidence.transportRequestHash) ||
    admitted < historicalPutEvidenceTime(artifact.observedAt) ||
    admitted > historicalPutEvidenceTime(input.requiredThrough) ||
    !putDestinationAdmissionWindowContains(protection, admitted)
  )
    throw invalid();

  const protocol = 'PUBLISHED_HISTORY_STAGING_PUT_PERMISSION_V1' as const;
  const facts = {
    protocol,
    state: 'MAY_RUN' as const,
    authorizationId: archiveHash([protocol, attempt.id]),
    selectionHash: archiveHash(input),
    attemptId: attempt.id,
    attemptDefinitionHash: attempt.definitionHash,
    dispatcherInstanceId: attempt.dispatcherInstanceId,
    protectionHash: protection.protectionHash,
    destinationControlsHash: protection.controlsHash,
    accreditationHash: input.expectedAccreditationHash,
    historicalPermissionHash: predecessor.permissionHash,
    versionObservationHash: predecessor.versionObservationHash,
    conservationControlsHash: predecessor.conservationControlsHash,
    artifact,
    transportRequestHash: input.transportRequestHash,
    requiredThrough: input.requiredThrough,
    admittedAt,
  };
  return Object.freeze({ ...facts, permissionHash: archiveHash(facts) });
}

export type PublishedHistoryStagingPutPermission = ReturnType<
  typeof buildPublishedHistoryStagingPermission
>;

export type PublishedHistoryStagingTransportInput = Readonly<{
  selection: PublishedHistoryStagingPermissionInput;
  expectedPermissionHash: string;
  localReturn: ItemPutTransportReturn;
}>;
