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

type StagingArtifactFacts = ItemSourceArtifactIdentity &
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
  new ConflictError('The sealed staging PUT artifact is inconsistent');

function sealStagingArtifact(facts: StagingArtifactFacts) {
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
    protocol: 'ITEM_STAGING_PUT_ARTIFACT_V1' as const,
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

export type ItemStagingPutArtifactSeal = ReturnType<typeof sealStagingArtifact>;

export function buildStagingPutArtifactSeal(
  attempt: ItemStagingPutAttempt,
  protectionHash: string,
  identity: ItemSourceArtifactIdentity,
  observedAt: string,
): ItemStagingPutArtifactSeal {
  const { definitionHash, ...definition } = attempt;
  if (
    definition.protocol !== 'ITEM_STAGING_PUT_ATTEMPT_V1' ||
    archiveHash(definition) !== definitionHash ||
    historicalPutEvidenceTime(observedAt) >
      historicalPutEvidenceTime(attempt.predecessor.requiredThrough)
  )
    throw invalid();
  return sealStagingArtifact({
    ...identity,
    attemptDefinitionHash: definitionHash,
    readHash: archiveHash(attempt.read),
    versionObservationHash: attempt.predecessor.versionObservationHash,
    protectionHash,
    observedAt,
    size: attempt.read.contentLength,
    sha256: attempt.read.sha256,
  });
}

export function captureStagingPutArtifactSeal(raw: ItemStagingPutArtifactSeal) {
  if (!raw) throw invalid();
  const seal = sealStagingArtifact(raw);
  if (!isDeepStrictEqual(raw, seal)) throw invalid();
  return seal;
}
