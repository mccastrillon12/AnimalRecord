import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  PublishedHistoryFinalPutDeclaration,
  PublishedHistoryFinalReadInput,
  publishedHistoryFinalReadInput,
} from './published-history-final';
import { sourceHashValid } from './transfer-item-historical-observation';
import {
  protectPublishedHistoryFinalPutDestination,
  putDestinationAdmissionWindowContains,
} from './transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import type { ItemPutTransportReturn } from './transfer-item-historical-put-transport';
import {
  PublishedHistoryFinalPutArtifactSeal,
  buildPublishedHistoryFinalPutArtifactSeal,
  capturePublishedHistoryFinalPutArtifactSeal,
} from './transfer-item-staging-put-artifact';

const invalid = () =>
  new ConflictError(
    'The first published history final PUT permission is inconsistent',
  );

export type PublishedHistoryFinalPermissionInput =
  PublishedHistoryFinalReadInput &
    Readonly<{ expectedArtifactHash: string; transportRequestHash: string }>;

export function publishedHistoryFinalPermissionInput(
  raw: PublishedHistoryFinalPermissionInput,
) {
  if (
    ![raw?.expectedArtifactHash, raw?.transportRequestHash].every(
      sourceHashValid,
    )
  )
    throw invalid();
  return Object.freeze({
    ...publishedHistoryFinalReadInput(raw),
    expectedArtifactHash: raw.expectedArtifactHash,
    transportRequestHash: raw.transportRequestHash,
  });
}

export type PublishedHistoryFinalHeldEvidence = Readonly<{
  openedArtifactSeal: PublishedHistoryFinalPutArtifactSeal;
  transportRequestHash: string;
}>;

export function buildPublishedHistoryFinalPermission(
  input: PublishedHistoryFinalPermissionInput,
  declaration: PublishedHistoryFinalPutDeclaration,
  evidence: PublishedHistoryFinalHeldEvidence,
  admittedAt: string,
) {
  const { attempt } = declaration;
  const { predecessor } = attempt;
  const protection = protectPublishedHistoryFinalPutDestination(
    attempt,
    input.expectedControlsHash,
    input.expectedAccreditationHash,
    declaration.accreditation,
  );
  const artifact = capturePublishedHistoryFinalPutArtifactSeal(
    evidence.openedArtifactSeal,
  );
  const rebuilt = buildPublishedHistoryFinalPutArtifactSeal(
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
    attempt.intentDefinitionHash !== input.expectedFinalIntentHash ||
    attempt.dispatcherInstanceId !== input.dispatcherInstanceId ||
    predecessor.permissionHash !== input.expectedStagingPermissionHash ||
    predecessor.versionObservationHash !==
      input.expectedStagingVersionObservationHash ||
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

  const protocol = 'PUBLISHED_HISTORY_FINAL_PUT_PERMISSION_V1' as const;
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
    stagingPermissionHash: predecessor.permissionHash,
    versionObservationHash: predecessor.versionObservationHash,
    conservationControlsHash: predecessor.conservationControlsHash,
    artifact,
    transportRequestHash: input.transportRequestHash,
    requiredThrough: input.requiredThrough,
    admittedAt,
  };
  return Object.freeze({ ...facts, permissionHash: archiveHash(facts) });
}

export type PublishedHistoryFinalPutPermission = ReturnType<
  typeof buildPublishedHistoryFinalPermission
>;

export type PublishedHistoryFinalTransportInput = Readonly<{
  selection: PublishedHistoryFinalPermissionInput;
  expectedPermissionHash: string;
  localReturn: ItemPutTransportReturn;
}>;
