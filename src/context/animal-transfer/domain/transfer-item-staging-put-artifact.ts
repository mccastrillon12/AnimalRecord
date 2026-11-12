import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import { sourceHashValid } from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import {
  ItemSourceArtifactIdentity,
  captureItemSourceArtifactIdentity,
} from './transfer-item-source-artifact';
import type { ItemStagingPutAttempt } from './transfer-item-staging-put-attempt';
import type { ItemRecipientFinalPutAttempt } from './transfer-item-recipient-final-put-attempt';

type VersionedArtifactFacts = ItemSourceArtifactIdentity &
  Readonly<{
    attemptDefinitionHash: string;
    readHash: string;
    versionObservationHash: string;
    protectionHash: string;
    observedAt: string;
    size: number;
    sha256: string;
  }>;

const invalid = () =>
  new ConflictError('The sealed versioned PUT artifact is inconsistent');

function sealVersionedArtifact<
  Protocol extends
    | 'ITEM_STAGING_PUT_ARTIFACT_V1'
    | 'ITEM_RECIPIENT_FINAL_PUT_ARTIFACT_V1',
>(facts: VersionedArtifactFacts, protocol: Protocol) {
  const {
    attemptDefinitionHash,
    readHash,
    versionObservationHash,
    protectionHash,
    observedAt,
    size,
    sha256,
  } = facts;
  if (
    ![
      attemptDefinitionHash,
      readHash,
      versionObservationHash,
      protectionHash,
      sha256,
    ].every(sourceHashValid) ||
    !Number.isSafeInteger(size) ||
    size < 1
  )
    throw invalid();
  historicalPutEvidenceTime(observedAt);
  const seal = {
    protocol,
    ...captureItemSourceArtifactIdentity(facts),
    attemptDefinitionHash,
    readHash,
    versionObservationHash,
    protectionHash,
    observedAt,
    size,
    sha256,
    reservation: 'OBSERVED_ONLY' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({ ...seal, artifactHash: archiveHash(seal) });
}

function versionedArtifactFacts(
  attempt: ItemStagingPutAttempt | ItemRecipientFinalPutAttempt,
  protectionHash: string,
  identity: ItemSourceArtifactIdentity,
  observedAt: string,
): VersionedArtifactFacts {
  const { definitionHash, ...definition } = attempt;
  if (
    archiveHash(definition) !== definitionHash ||
    historicalPutEvidenceTime(observedAt) >
      historicalPutEvidenceTime(attempt.predecessor.requiredThrough)
  )
    throw invalid();
  return {
    ...identity,
    attemptDefinitionHash: definitionHash,
    readHash: archiveHash(attempt.read),
    versionObservationHash: attempt.predecessor.versionObservationHash,
    protectionHash,
    observedAt,
    size: attempt.read.contentLength,
    sha256: attempt.read.sha256,
  };
}

export type ItemStagingPutArtifactSeal = ReturnType<
  typeof sealVersionedArtifact<'ITEM_STAGING_PUT_ARTIFACT_V1'>
>;

export function buildStagingPutArtifactSeal(
  attempt: ItemStagingPutAttempt,
  protectionHash: string,
  identity: ItemSourceArtifactIdentity,
  observedAt: string,
): ItemStagingPutArtifactSeal {
  if (attempt?.protocol !== 'ITEM_STAGING_PUT_ATTEMPT_V1') throw invalid();
  return sealVersionedArtifact(
    versionedArtifactFacts(attempt, protectionHash, identity, observedAt),
    'ITEM_STAGING_PUT_ARTIFACT_V1',
  );
}

export function captureStagingPutArtifactSeal(raw: ItemStagingPutArtifactSeal) {
  if (!raw) throw invalid();
  const seal = sealVersionedArtifact(raw, 'ITEM_STAGING_PUT_ARTIFACT_V1');
  if (!isDeepStrictEqual(raw, seal)) throw invalid();
  return seal;
}

export type ItemRecipientFinalPutArtifactSeal = ReturnType<
  typeof sealVersionedArtifact<'ITEM_RECIPIENT_FINAL_PUT_ARTIFACT_V1'>
>;

export function buildRecipientFinalPutArtifactSeal(
  attempt: ItemRecipientFinalPutAttempt,
  protectionHash: string,
  identity: ItemSourceArtifactIdentity,
  observedAt: string,
): ItemRecipientFinalPutArtifactSeal {
  if (attempt?.protocol !== 'ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1')
    throw invalid();
  return sealVersionedArtifact(
    versionedArtifactFacts(attempt, protectionHash, identity, observedAt),
    'ITEM_RECIPIENT_FINAL_PUT_ARTIFACT_V1',
  );
}

export function captureRecipientFinalPutArtifactSeal(
  raw: ItemRecipientFinalPutArtifactSeal,
) {
  if (!raw) throw invalid();
  const seal = sealVersionedArtifact(
    raw,
    'ITEM_RECIPIENT_FINAL_PUT_ARTIFACT_V1',
  );
  if (!isDeepStrictEqual(raw, seal)) throw invalid();
  return seal;
}
