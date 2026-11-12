import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  PublishedHistoryPutReadInput,
  PublishedHistoryPutDeclaration,
  publishedHistoryPutReadInput,
} from './published-history-copy';
import { sourceHashValid } from './transfer-item-historical-observation';
import {
  protectPublishedHistoryPutDestination,
  putDestinationAdmissionWindowContains,
} from './transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import type { ItemPutTransportReturn } from './transfer-item-historical-put-transport';
import {
  PublishedHistoryPutArtifactSeal,
  buildPublishedHistoryPutArtifactSeal,
  capturePublishedHistoryPutArtifactSeal,
} from './transfer-item-staging-put-artifact';

const invalid = () =>
  new ConflictError(
    'The first published history PUT permission is inconsistent',
  );

export type PublishedHistoryPutPermissionInput = PublishedHistoryPutReadInput &
  Readonly<{ expectedArtifactHash: string; transportRequestHash: string }>;

export function publishedHistoryPutPermissionInput(
  raw: PublishedHistoryPutPermissionInput,
) {
  if (
    ![raw?.expectedArtifactHash, raw?.transportRequestHash].every(
      sourceHashValid,
    )
  )
    throw invalid();
  return Object.freeze({
    ...publishedHistoryPutReadInput(raw),
    expectedArtifactHash: raw.expectedArtifactHash,
    transportRequestHash: raw.transportRequestHash,
  });
}

export type PublishedHistoryPutHeldEvidence = Readonly<{
  openedArtifactSeal: PublishedHistoryPutArtifactSeal;
  transportRequestHash: string;
}>;

export function buildPublishedHistoryPutPermission(
  input: PublishedHistoryPutPermissionInput,
  declaration: PublishedHistoryPutDeclaration,
  evidence: PublishedHistoryPutHeldEvidence,
  source: Readonly<{
    versionObservationHash: string;
    conservationControlsHash: string;
  }>,
  admittedAt: string,
) {
  const { attempt } = declaration;
  const protection = protectPublishedHistoryPutDestination(
    attempt,
    input.expectedControlsHash,
    input.expectedAccreditationHash,
    declaration.accreditation,
  );
  const artifact = capturePublishedHistoryPutArtifactSeal(
    evidence.openedArtifactSeal,
  );
  const rebuilt = buildPublishedHistoryPutArtifactSeal(
    attempt,
    protection.protectionHash,
    artifact,
    artifact.observedAt,
    source.versionObservationHash,
    input.requiredThrough,
  );
  const admitted = historicalPutEvidenceTime(admittedAt);
  if (
    declaration.state !== 'INTENDED' ||
    archiveHash(declaration.protection) !== archiveHash(protection) ||
    attempt.definitionHash !== input.expectedAttemptDefinitionHash ||
    attempt.intentDefinitionHash !== input.expectedIntentHash ||
    attempt.dispatcherInstanceId !== input.dispatcherInstanceId ||
    protection.protectionHash !== input.expectedProtectionHash ||
    !sourceHashValid(source.conservationControlsHash) ||
    artifact.artifactHash !== input.expectedArtifactHash ||
    artifact.artifactHash !== rebuilt.artifactHash ||
    evidence.transportRequestHash !== input.transportRequestHash ||
    !sourceHashValid(evidence.transportRequestHash) ||
    admitted < historicalPutEvidenceTime(artifact.observedAt) ||
    admitted > historicalPutEvidenceTime(input.requiredThrough) ||
    !putDestinationAdmissionWindowContains(protection, admitted)
  )
    throw invalid();

  const protocol = 'PUBLISHED_HISTORY_PUT_PERMISSION_V1' as const;
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
    versionObservationHash: source.versionObservationHash,
    conservationControlsHash: source.conservationControlsHash,
    artifact,
    transportRequestHash: input.transportRequestHash,
    requiredThrough: input.requiredThrough,
    admittedAt,
  };
  return Object.freeze({ ...facts, permissionHash: archiveHash(facts) });
}

export type PublishedHistoryPutPermission = ReturnType<
  typeof buildPublishedHistoryPutPermission
>;

export type PublishedHistoryPutTransportObservationInput = Readonly<{
  selection: PublishedHistoryPutPermissionInput;
  expectedPermissionHash: string;
  localReturn: ItemPutTransportReturn;
}>;
