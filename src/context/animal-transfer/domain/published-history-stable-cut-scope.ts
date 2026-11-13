import { archiveHash } from './ownership-archive';
import type { ItemHistoricalPutVersionScope } from './transfer-item-historical-put-reconciliation';
import type { ObjectRevision } from './ownership-archive';

export const PUBLISHED_HISTORY_STABLE_CUT_SCOPE_PROTOCOL =
  'PUBLISHED_HISTORY_STABLE_CUT_SCOPE_V1' as const;

export type PublishedHistoryStableCutAttempt = Readonly<{
  attemptDefinitionHash: string;
  protectionHash: string;
  authorizationId: string;
  permissionHash: string;
}>;

export type PublishedHistoryStableCutVersion = Readonly<{
  observationHash: string;
  target: ItemHistoricalPutVersionScope['target'];
  revision: Readonly<ObjectRevision>;
  sha256: string;
  conservationControlsHash: string;
}>;

export type PublishedHistoryStableCutFile = Readonly<{
  fileId: string;
  fileDefinitionHash: string;
  sourceFileId: string;
  attempts: readonly [
    PublishedHistoryStableCutAttempt,
    PublishedHistoryStableCutAttempt,
    PublishedHistoryStableCutAttempt,
  ];
  historical: PublishedHistoryStableCutVersion;
  final: PublishedHistoryStableCutVersion;
}>;

export function buildPublishedHistoryStableCutScope(
  binding: Readonly<{
    archiveId: string;
    archiveDefinitionHash: string;
    reservationEpoch: number;
    reservationBindingHash: string;
    sourceArchiveId: string;
    publicationHash: string;
    sourceManifestHash: string;
    preparedCoverageHash: string;
    projectionHash: string;
    requiredThrough: string;
  }>,
  files: readonly PublishedHistoryStableCutFile[],
) {
  const protocol = PUBLISHED_HISTORY_STABLE_CUT_SCOPE_PROTOCOL;
  let attemptsDigest = archiveHash([protocol, 'COPY_ATTEMPTS']);
  let versionsDigest = archiveHash([protocol, 'RETAINED_VERSIONS']);
  const controls = new Set<string>();
  for (const {
    fileId,
    fileDefinitionHash,
    sourceFileId,
    attempts,
    historical,
    final,
  } of files) {
    const identity = { fileId, fileDefinitionHash, sourceFileId };
    attemptsDigest = archiveHash({
      previous: attemptsDigest,
      ...identity,
      attempts,
    });
    versionsDigest = archiveHash({
      previous: versionsDigest,
      ...identity,
      historical,
      final,
    });
    controls.add(historical.conservationControlsHash);
    controls.add(final.conservationControlsHash);
  }
  const scope = {
    protocol,
    binding: Object.freeze({
      archiveId: binding.archiveId,
      archiveDefinitionHash: binding.archiveDefinitionHash,
      reservationEpoch: binding.reservationEpoch,
      reservationBindingHash: binding.reservationBindingHash,
      sourceArchiveId: binding.sourceArchiveId,
      publicationHash: binding.publicationHash,
      sourceManifestHash: binding.sourceManifestHash,
      preparedCoverageHash: binding.preparedCoverageHash,
      projectionHash: binding.projectionHash,
      requiredThrough: binding.requiredThrough,
    }),
    copyInventory: Object.freeze({
      attemptCount: files.length * 3,
      permissionCount: files.length * 3,
      attemptsDigest,
    }),
    retained: Object.freeze({
      fileCount: files.length,
      versionsDigest,
      conservationControlsHashes: Object.freeze([...controls].sort()),
    }),
    stableCut: 'NOT_ASSESSED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({ ...scope, scopeHash: archiveHash(scope) });
}
