import type { LaterPeriodLiveMediaEvidence } from './later-period-live-media';
import { archiveHash } from './ownership-archive';
import {
  buildPublishedHistoryStableCutScope,
  type PublishedHistoryStableCutFile,
  type PublishedHistoryStableCutScope,
} from './published-history-stable-cut-scope';
import { sourceHashValid } from './transfer-item-historical-observation';
import type { LaterPeriodStableCutScope } from './transfer-item-stable-cut-evidence';

export type LaterPeriodStableCutCopyEvidence = Readonly<{
  retainedBinding: PublishedHistoryStableCutScope['binding'];
  retainedFiles: readonly PublishedHistoryStableCutFile[];
  liveMedia: readonly Readonly<{
    fileId: string;
    evidence: LaterPeriodLiveMediaEvidence;
  }>[];
}>;

export function laterPeriodLiveMediaReference(
  fileId: string,
  evidence: LaterPeriodLiveMediaEvidence,
) {
  const evidenceHash = archiveHash(evidence);
  return Object.freeze({
    id: archiveHash([
      'LATER_PERIOD_LIVE_MEDIA_REFERENCE_V1',
      fileId,
      evidenceHash,
    ]),
    fileId,
    key: evidence.final.target.key,
    evidenceHash,
    historical: evidence.historical,
    final: evidence.final,
  });
}

function hasLength(entries: unknown, count: number) {
  return Array.isArray(entries) && entries.length === count;
}

/** Rebuilds the selected copy pins. Their permission hashes still require independent findings. */
export function matchLaterPeriodStableCutCopyPermissionIdentities(
  scope: LaterPeriodStableCutScope,
  raw: unknown,
) {
  if (
    raw === undefined &&
    scope.retainedFileCount === 0 &&
    scope.liveManifest?.fileCount === 0 &&
    scope.liveMediaDigest === archiveHash([])
  )
    return [];

  const proof = raw as LaterPeriodStableCutCopyEvidence | null | undefined;
  if (
    !proof?.retainedBinding ||
    !hasLength(proof.retainedFiles, scope.retainedFileCount) ||
    !hasLength(proof.liveMedia, scope.liveManifest?.fileCount) ||
    proof.retainedBinding.archiveId !== scope.archiveId ||
    proof.retainedBinding.projectionHash !== scope.retainedProjectionHash ||
    proof.retainedBinding.requiredThrough !== scope.requiredThrough
  )
    return null;

  const { retainedBinding, retainedFiles, liveMedia } = proof;
  const identities: string[] = [];
  for (const file of retainedFiles) {
    if (
      !file ||
      !hasLength(file.attempts, 3) ||
      !file.historical ||
      !file.final
    )
      return null;
    for (const attempt of file.attempts) {
      if (!sourceHashValid(attempt?.permissionHash)) return null;
      identities.push(attempt.permissionHash);
    }
  }
  if (
    buildPublishedHistoryStableCutScope(retainedBinding, retainedFiles)
      .scopeHash !== scope.retainedScopeHash
  )
    return null;

  const references: ReturnType<typeof laterPeriodLiveMediaReference>[] = [];
  for (const item of liveMedia) {
    const evidence = item?.evidence;
    const permissions = evidence?.copyPermissionHashes;
    if (
      !sourceHashValid(item?.fileId) ||
      evidence?.protocol !== 'LATER_PERIOD_LIVE_MEDIA_EVIDENCE_V1' ||
      !evidence.historical ||
      !evidence.final?.target ||
      !sourceHashValid(permissions?.historical) ||
      !sourceHashValid(permissions?.final)
    )
      return null;
    identities.push(permissions.historical, permissions.final);
    references.push(laterPeriodLiveMediaReference(item.fileId, evidence));
  }

  return archiveHash(references) === scope.liveMediaDigest &&
    new Set(identities).size === identities.length
    ? Object.freeze(identities)
    : null;
}
