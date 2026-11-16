import { DomainError } from '../../shared/domain/DomainError';
import type { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import { archiveHash, type ObjectRevision } from '../domain/ownership-archive';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from '../domain/transfer-item-copy-intent';
import {
  profileIdValid,
  sourceHashValid,
  type ItemSourceRetentionReader,
} from '../domain/transfer-item-historical-observation';
import {
  putDestinationWriterCoverageValid,
  putDestinationWritersValid,
} from '../domain/transfer-item-historical-put-destination-protection';
import {
  historicalPutEvidenceTime,
  matchPutVersionEvidence,
  type ItemHistoricalPutVersionReader,
  type ItemHistoricalPutVersionScope,
  type PutVersionEvidence,
} from '../domain/transfer-item-historical-put-reconciliation';
import type { StableCutWriterCoverage } from '../domain/transfer-item-stable-cut-evidence';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

export type StableCutVersionStorage = ItemSourceRetentionReader &
  ItemHistoricalPutVersionReader;
type VersionPin = Readonly<{
  target: ItemHistoricalPutVersionScope['target'];
  revision: Readonly<ObjectRevision>;
  sha256: string;
  conservationControlsHash: string;
}>;

export type StableCutPutVersionEvidenceReader = Readonly<{
  readVersionEvidence(
    scope: ItemHistoricalPutVersionScope,
    hash: string,
  ): Promise<PutVersionEvidence | null>;
}>;

export async function readStableCutPutFinding(
  reader: StableCutPutVersionEvidenceReader,
  storage: StableCutVersionStorage,
  observation: Readonly<{
    scope: ItemHistoricalPutVersionScope;
    revision: Readonly<ObjectRevision>;
    evidenceHash: string;
    observationHash: string;
    conservationControlsHash: string;
  }>,
  protocol: PutVersionEvidence['protocol'],
  horizon: number,
  invalid: () => ConflictError,
  unavailable: string,
) {
  const { scope, revision, evidenceHash, conservationControlsHash } =
    observation;
  const report = matchPutVersionEvidence(
    scope,
    await reader.readVersionEvidence(scope, evidenceHash),
    evidenceHash,
    protocol,
  );
  const validFrom = historicalPutEvidenceTime(report.validFrom);
  const validUntil = historicalPutEvidenceTime(report.validUntil);
  if (
    validFrom > horizon ||
    validUntil <= horizon ||
    archiveHash(report.revision) !== archiveHash(revision) ||
    report.conservationControlsHash !== conservationControlsHash
  )
    throw invalid();

  const version = await verifyStableCutVersion(
    storage,
    {
      target: scope.target,
      revision,
      sha256: scope.sha256,
      conservationControlsHash,
    },
    horizon,
    invalid,
    unavailable,
  );
  if (historicalPutEvidenceTime(version.retainUntil) < validUntil)
    throw invalid();
  return {
    permissionHash: scope.permissionHash,
    evidenceHash: archiveHash({
      observationHash: observation.observationHash,
      evidenceHash,
    }),
    validFrom,
    validUntil,
  };
}

export function assertStableCutWriterCoverage(
  coverage: StableCutWriterCoverage | null,
  scopeHash: string,
  startedAt: number,
  horizon: number,
  invalid: () => ConflictError,
): asserts coverage is StableCutWriterCoverage {
  if (
    !coverage ||
    coverage.scopeHash !== scopeHash ||
    !profileIdValid(coverage.issuerId) ||
    ![coverage.controlsHash, coverage.writerInventoryHash].every(
      sourceHashValid,
    ) ||
    !putDestinationWriterCoverageValid(coverage.copyEffects) ||
    !putDestinationWritersValid(coverage.writers) ||
    historicalPutEvidenceTime(coverage.validFrom) > startedAt ||
    historicalPutEvidenceTime(coverage.validUntil) <= horizon
  )
    throw invalid();
}

export async function verifyStableCutVersion(
  storage: StableCutVersionStorage,
  version: VersionPin,
  horizon: number,
  invalid: () => ConflictError,
  unavailable: string,
) {
  const { target, sha256 } = version;
  const revision = captureItemObjectRevision(version.revision);
  const { versionId } = revision;
  if (!isPinnedItemSourceVersion(versionId) || !sourceHashValid(sha256))
    throw invalid();
  try {
    const retention = await storage.readSourceRetention({
      bucket: target.bucket,
      key: target.key,
      versionId,
    });
    if (
      retention.expectedBucketOwner !== target.expectedBucketOwner ||
      retention.mode !== 'COMPLIANCE' ||
      historicalPutEvidenceTime(retention.reportedRetainUntil) <= horizon
    )
      throw invalid();
    await verifyHistoricalObjectBytes(
      await storage.readVersion(target, revision),
      revision,
      sha256,
      invalid,
    );
    return Object.freeze({
      pinHash: archiveHash(version),
      retainUntil: retention.reportedRetainUntil,
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new ExternalServiceError(unavailable);
  }
}
