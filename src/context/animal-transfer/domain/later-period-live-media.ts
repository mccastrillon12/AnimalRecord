import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveGenerationKey } from './ownership-archive-generation';
import {
  archiveHash,
  type ArchiveFile,
  type ObjectRevision,
  type OwnershipArchive,
} from './ownership-archive';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from './transfer-item-copy-intent';
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import type { ItemHistoricalPutVersionScope } from './transfer-item-historical-put-reconciliation';
import { ITEM_COPY_RECORD_PROTOCOL } from './transfer-item-copy-record';

type LiveMediaVersion = Readonly<{
  target: ItemHistoricalPutVersionScope['target'];
  revision: Readonly<ObjectRevision>;
  sha256: string;
  provenanceEvidenceHash: string;
  conservationEvidenceHash: string;
  conservationControlsHash: string;
}>;

export type LaterPeriodLiveMediaEvidence = Readonly<{
  protocol: 'LATER_PERIOD_LIVE_MEDIA_EVIDENCE_V1';
  issuerId: string;
  scopeHash: string;
  copyEffectsEvidenceHash: string;
  copyPermissionHashes?: Readonly<{ historical: string; final: string }>;
  historical: LiveMediaVersion;
  final: LiveMediaVersion;
  validFrom: string;
  validUntil: string;
}>;

export type LaterPeriodLiveMediaSelection = Readonly<{
  fileId: string;
  expectedScopeHash: string;
  expectedEvidenceHash: string;
  expectedPreviousEvidenceHash: string | null;
  requiredThrough: string;
}>;

export function laterPeriodLiveMediaSelection(
  raw: LaterPeriodLiveMediaSelection,
) {
  if (
    !raw ||
    ![raw.fileId, raw.expectedScopeHash, raw.expectedEvidenceHash].every(
      sourceHashValid,
    ) ||
    (raw.expectedPreviousEvidenceHash !== null &&
      !sourceHashValid(raw.expectedPreviousEvidenceHash))
  )
    throw new ConflictError('Invalid later-period live media selection');
  historicalPutEvidenceTime(raw.requiredThrough);
  return Object.freeze({ ...raw });
}

export function laterPeriodLiveMediaScope(
  archive: OwnershipArchive,
  file: ArchiveFile,
) {
  return Object.freeze({
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    reservationBindingHash: archive.reservation!.bindingHash,
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    source: Object.freeze({
      key: file.sourceKey,
      revision: captureItemObjectRevision(file.source),
    }),
    historicalKey: file.historicalKey,
    finalKey: archiveGenerationKey(archive.id, file.id, file.recipientFinalKey),
  });
}

export type LaterPeriodLiveMediaScope = ReturnType<
  typeof laterPeriodLiveMediaScope
>;

export function matchLaterPeriodLiveMediaEvidence(
  scope: LaterPeriodLiveMediaScope,
  raw: LaterPeriodLiveMediaEvidence | null | undefined,
  requiredThrough: string,
  checkedAt: number,
) {
  const invalid = () =>
    new ConflictError(
      'The later-period live copies lack matching version and conservation evidence',
    );
  const horizon = historicalPutEvidenceTime(requiredThrough);
  const permissions = raw?.copyPermissionHashes;
  if (
    raw?.protocol !== 'LATER_PERIOD_LIVE_MEDIA_EVIDENCE_V1' ||
    Object.keys(raw).sort().join(',') !==
      (permissions === undefined
        ? 'copyEffectsEvidenceHash,final,historical,issuerId,protocol,scopeHash,validFrom,validUntil'
        : 'copyEffectsEvidenceHash,copyPermissionHashes,final,historical,issuerId,protocol,scopeHash,validFrom,validUntil') ||
    (permissions !== undefined &&
      (!permissions ||
        Object.keys(permissions).sort().join(',') !== 'final,historical' ||
        ![permissions.final, permissions.historical].every(sourceHashValid))) ||
    !profileIdValid(raw.issuerId) ||
    raw.scopeHash !== archiveHash(scope) ||
    !sourceHashValid(raw.copyEffectsEvidenceHash) ||
    !isPinnedItemSourceVersion(scope.source.revision.versionId) ||
    !Number.isSafeInteger(checkedAt) ||
    !(
      historicalPutEvidenceTime(raw.validFrom) <= checkedAt &&
      checkedAt <= horizon &&
      horizon < historicalPutEvidenceTime(raw.validUntil)
    )
  )
    throw invalid();
  const matchVersion = (version: LiveMediaVersion, key: string) => {
    const revision = captureItemObjectRevision(version?.revision);
    if (
      Object.keys(version).sort().join(',') !==
        'conservationControlsHash,conservationEvidenceHash,provenanceEvidenceHash,revision,sha256,target' ||
      version.target?.key !== key ||
      Object.keys(version.target).sort().join(',') !==
        'bucket,expectedBucketOwner,key' ||
      typeof version.target.bucket !== 'string' ||
      typeof version.target.expectedBucketOwner !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(version.target.bucket) ||
      !/^[0-9]{12}$/.test(version.target.expectedBucketOwner) ||
      !isPinnedItemSourceVersion(revision.versionId) ||
      revision.size !== scope.source.revision.size ||
      ![
        version.sha256,
        version.provenanceEvidenceHash,
        version.conservationEvidenceHash,
        version.conservationControlsHash,
      ].every(sourceHashValid)
    )
      throw invalid();
    return Object.freeze({
      ...version,
      target: Object.freeze({ ...version.target }),
      revision,
    });
  };
  const historical = matchVersion(raw.historical, scope.historicalKey);
  const final = matchVersion(raw.final, scope.finalKey);
  if (historical.sha256 !== final.sha256) throw invalid();
  return Object.freeze({
    ...raw,
    ...(permissions
      ? { copyPermissionHashes: Object.freeze({ ...permissions }) }
      : {}),
    historical,
    final,
  });
}

export function laterPeriodLiveMediaRecordId(scope: LaterPeriodLiveMediaScope) {
  return archiveHash(['LATER_PERIOD_LIVE_MEDIA_RECORD_V1', archiveHash(scope)]);
}

export function buildLaterPeriodLiveMediaRecord(
  scope: LaterPeriodLiveMediaScope,
  evidence: LaterPeriodLiveMediaEvidence,
  recordedAt: string,
) {
  const at = historicalPutEvidenceTime(recordedAt);
  const checked = matchLaterPeriodLiveMediaEvidence(
    scope,
    evidence,
    recordedAt,
    at,
  );
  const id = laterPeriodLiveMediaRecordId(scope);
  const record = {
    protocol: ITEM_COPY_RECORD_PROTOCOL,
    row: 'LATER_PERIOD_LIVE_MEDIA_EVIDENCE' as const,
    state: 'RECORDED' as const,
    id,
    gateId: archiveHash([
      'LATER_PERIOD_LIVE_MEDIA_RECORDS_V1',
      scope.archiveId,
      scope.reservationBindingHash,
    ]),
    identityIds: [id],
    scope,
    liveMediaEvidence: checked,
    accreditationHash: archiveHash(checked),
    recordedAt,
  };
  return { ...record, definitionHash: archiveHash(record) };
}

export type LaterPeriodLiveMediaRecord = ReturnType<
  typeof buildLaterPeriodLiveMediaRecord
>;

export function assertSameLaterPeriodLiveCopies(
  previous: LaterPeriodLiveMediaEvidence,
  next: LaterPeriodLiveMediaEvidence,
) {
  const identity = ({
    target,
    revision,
    sha256,
    provenanceEvidenceHash,
  }: LiveMediaVersion) => ({
    target,
    revision,
    sha256,
    provenanceEvidenceHash,
  });
  if (
    previous.copyEffectsEvidenceHash !== next.copyEffectsEvidenceHash ||
    archiveHash(previous.copyPermissionHashes) !==
      archiveHash(next.copyPermissionHashes) ||
    archiveHash(identity(previous.historical)) !==
      archiveHash(identity(next.historical)) ||
    archiveHash(identity(previous.final)) !== archiveHash(identity(next.final))
  )
    throw new ConflictError(
      'Renewal requires the same live copy versions and provenance',
    );
}
