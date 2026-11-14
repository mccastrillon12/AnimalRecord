import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import type { LaterPeriodLiveMediaScope } from './later-period-live-media';
import { isPinnedItemSourceVersion } from './transfer-item-copy-intent';
import { ITEM_COPY_RECORD_PROTOCOL } from './transfer-item-copy-record';
import { publishedHistoryPutRequests } from './published-history-copy';
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import {
  captureItemSourceRepresentation,
  ItemSourceRepresentation,
} from './transfer-item-source-artifact-metadata';
import {
  captureItemSourceArtifactIdentity,
  ItemArtifactSeal,
} from './transfer-item-source-artifact';
import {
  LaterPeriodLivePutDestinationAccreditation,
  protectLaterPeriodLivePutDestination,
  putDestinationAdmissionWindowContains,
} from './transfer-item-historical-put-destination-protection';

const invalid = () =>
  new ConflictError(
    'The later-period live PUT selection or evidence is inconsistent',
  );

export type LaterPeriodLivePutKey = Readonly<{
  fileId: string;
  expectedScopeHash: string;
  leg: 'HISTORICAL' | 'FINAL';
}>;

export function laterPeriodLivePutKey(
  raw: LaterPeriodLivePutKey,
): LaterPeriodLivePutKey {
  if (
    !raw ||
    ![raw.fileId, raw.expectedScopeHash].every(sourceHashValid) ||
    !['HISTORICAL', 'FINAL'].includes(raw.leg)
  )
    throw invalid();
  return Object.freeze({
    fileId: raw.fileId,
    expectedScopeHash: raw.expectedScopeHash,
    leg: raw.leg,
  });
}

/** Independently verified for the exact sealed source version and access window. */
export type LaterPeriodLivePutSourceReport = Readonly<{
  protocol: 'LATER_PERIOD_LIVE_PUT_SOURCE_V1';
  issuerId: string;
  scopeHash: string;
  bucket: string;
  expectedBucketOwner: string;
  sha256: string;
  representation: ItemSourceRepresentation;
  controlsHash: string;
  validFrom: string;
  validUntil: string;
}>;

export function laterPeriodLivePutId(
  scope: LaterPeriodLiveMediaScope,
  leg: LaterPeriodLivePutKey['leg'],
) {
  return archiveHash([
    'LATER_PERIOD_LIVE_PUT_V1',
    scope.archiveId,
    scope.reservationBindingHash,
    scope.fileId,
    leg,
  ]);
}

export function buildLaterPeriodLivePutAttempt(
  scope: LaterPeriodLiveMediaScope,
  selection: LaterPeriodLivePutKey,
  dispatcherInstanceId: string,
  report: LaterPeriodLivePutSourceReport,
) {
  const { fileId, leg, expectedScopeHash } = laterPeriodLivePutKey(selection);
  const scopeHash = archiveHash(scope);
  if (
    fileId !== scope.fileId ||
    expectedScopeHash !== scopeHash ||
    !isPinnedItemSourceVersion(scope.source.revision.versionId) ||
    !profileIdValid(dispatcherInstanceId) ||
    report?.protocol !== 'LATER_PERIOD_LIVE_PUT_SOURCE_V1' ||
    Object.keys(report).sort().join(',') !==
      'bucket,controlsHash,expectedBucketOwner,issuerId,protocol,representation,scopeHash,sha256,validFrom,validUntil' ||
    !profileIdValid(report.issuerId) ||
    report.scopeHash !== scopeHash ||
    ![report.sha256, report.controlsHash].every(sourceHashValid) ||
    typeof report.bucket !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(report.bucket) ||
    typeof report.expectedBucketOwner !== 'string' ||
    !/^\d{12}$/.test(report.expectedBucketOwner) ||
    historicalPutEvidenceTime(report.validFrom) >=
      historicalPutEvidenceTime(report.validUntil)
  )
    throw invalid();
  const { bucket, expectedBucketOwner, sha256 } = report;
  const facts = {
    protocol: 'LATER_PERIOD_LIVE_PUT_ATTEMPT_V1' as const,
    id: laterPeriodLivePutId(scope, leg),
    operation: 'PUT_OBJECT' as const,
    leg,
    scopeHash,
    dispatcherInstanceId,
    sourceReportHash: archiveHash(report),
    ...publishedHistoryPutRequests(
      { ...scope.source, bucket, expectedBucketOwner, sha256 },
      {
        bucket,
        expectedBucketOwner,
        key: leg === 'HISTORICAL' ? scope.historicalKey : scope.finalKey,
        ifNoneMatch: '*',
      },
      captureItemSourceRepresentation(report.representation),
    ),
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type LaterPeriodLivePutAttempt = ReturnType<
  typeof buildLaterPeriodLivePutAttempt
>;

export function buildLaterPeriodLivePutDeclaration(
  attempt: LaterPeriodLivePutAttempt,
  source: LaterPeriodLivePutSourceReport,
  destination: LaterPeriodLivePutDestinationAccreditation,
) {
  if (archiveHash(source) !== attempt.sourceReportHash) throw invalid();
  const protection = protectLaterPeriodLivePutDestination(
    attempt,
    destination.scope.controlsHash,
    archiveHash(destination),
    destination,
  );
  return { attempt, source, destination, protection };
}

type LaterPeriodLivePutDeclaration = ReturnType<
  typeof buildLaterPeriodLivePutDeclaration
>;

export function assertLaterPeriodLivePutWindow(
  declaration: LaterPeriodLivePutDeclaration,
  at: number,
) {
  if (
    !putDestinationAdmissionWindowContains(declaration.protection, at) ||
    !putDestinationAdmissionWindowContains(
      {
        validFrom: declaration.source.validFrom,
        admitBefore: declaration.source.validUntil,
      },
      at,
    )
  )
    throw new ConflictError(
      'The later-period live PUT window is no longer active',
    );
}

export type LaterPeriodLivePutPermissionSelection = LaterPeriodLivePutKey &
  Readonly<{
    expectedAttemptHash: string;
    expectedProtectionHash: string;
    expectedArtifactHash: string;
    transportRequestHash: string;
  }>;

export function laterPeriodLivePutPermissionSelection(
  raw: LaterPeriodLivePutPermissionSelection,
) {
  const selection = laterPeriodLivePutKey(raw);
  const {
    expectedAttemptHash,
    expectedProtectionHash,
    expectedArtifactHash,
    transportRequestHash,
  } = raw;
  if (
    ![
      expectedAttemptHash,
      expectedProtectionHash,
      expectedArtifactHash,
      transportRequestHash,
    ].every(sourceHashValid)
  )
    throw invalid();
  return Object.freeze({
    ...selection,
    expectedAttemptHash,
    expectedProtectionHash,
    expectedArtifactHash,
    transportRequestHash,
  });
}

export function buildLaterPeriodLivePutArtifact(
  { attempt, protection }: LaterPeriodLivePutDeclaration,
  identity: Pick<ItemArtifactSeal, 'id' | 'generation'>,
) {
  const facts = {
    protocol: 'LATER_PERIOD_LIVE_PUT_ARTIFACT_V1' as const,
    ...captureItemSourceArtifactIdentity(identity),
    attemptDefinitionHash: attempt.definitionHash,
    protectionHash: protection.protectionHash,
    size: attempt.read.contentLength,
    sha256: attempt.read.sha256,
  };
  return Object.freeze({ ...facts, artifactHash: archiveHash(facts) });
}

export type LaterPeriodLivePutArtifactSeal = ReturnType<
  typeof buildLaterPeriodLivePutArtifact
>;

export function captureLaterPeriodLivePutArtifact(
  raw: LaterPeriodLivePutArtifactSeal,
): LaterPeriodLivePutArtifactSeal {
  const identity = captureItemSourceArtifactIdentity(raw);
  const {
    protocol,
    attemptDefinitionHash,
    protectionHash,
    size,
    sha256,
    artifactHash,
  } = raw;
  const facts = {
    protocol,
    ...identity,
    attemptDefinitionHash,
    protectionHash,
    size,
    sha256,
  };
  if (
    protocol !== 'LATER_PERIOD_LIVE_PUT_ARTIFACT_V1' ||
    ![attemptDefinitionHash, protectionHash, sha256, artifactHash].every(
      sourceHashValid,
    ) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    archiveHash(facts) !== artifactHash ||
    archiveHash({ ...facts, artifactHash }) !== archiveHash(raw)
  )
    throw invalid();
  return Object.freeze({ ...facts, artifactHash });
}

export type LaterPeriodLivePutHeldEvidence = Readonly<{
  artifact: LaterPeriodLivePutArtifactSeal;
  transportRequestHash: string;
}>;

export function buildLaterPeriodLivePutPermission(
  selection: LaterPeriodLivePutPermissionSelection,
  declaration: LaterPeriodLivePutDeclaration,
  held: LaterPeriodLivePutHeldEvidence,
  admittedAt: string,
) {
  assertLaterPeriodLivePutWindow(
    declaration,
    historicalPutEvidenceTime(admittedAt),
  );
  const { attempt, protection } = declaration;
  const artifact = buildLaterPeriodLivePutArtifact(declaration, held.artifact);
  if (
    attempt.definitionHash !== selection.expectedAttemptHash ||
    protection.protectionHash !== selection.expectedProtectionHash ||
    artifact.artifactHash !== selection.expectedArtifactHash ||
    archiveHash(held.artifact) !== archiveHash(artifact) ||
    held.transportRequestHash !== selection.transportRequestHash
  )
    throw invalid();
  const protocol = 'LATER_PERIOD_LIVE_PUT_PERMISSION_V1' as const;
  const facts = {
    protocol,
    state: 'MAY_RUN' as const,
    authorizationId: archiveHash([protocol, attempt.id]),
    selection,
    artifact,
    admittedAt,
  };
  return Object.freeze({ ...facts, permissionHash: archiveHash(facts) });
}

export type LaterPeriodLivePutPermission = ReturnType<
  typeof buildLaterPeriodLivePutPermission
>;

export function buildLaterPeriodLivePutRecord(
  declaration: LaterPeriodLivePutDeclaration,
  permission?: LaterPeriodLivePutPermission,
) {
  const { attempt } = declaration;
  return {
    protocol: ITEM_COPY_RECORD_PROTOCOL,
    row: 'LATER_PERIOD_LIVE_PUT' as const,
    state: 'INTENDED' as const,
    id: attempt.id,
    gateId: attempt.scopeHash,
    identityIds: permission
      ? [attempt.id, permission.authorizationId]
      : [attempt.id],
    definitionHash: attempt.definitionHash,
    livePut: { declaration, ...(permission ? { permission } : {}) },
  };
}

export type LaterPeriodLivePutRecord = ReturnType<
  typeof buildLaterPeriodLivePutRecord
>;

export function laterPeriodLivePutEffect(
  scope: LaterPeriodLiveMediaScope,
  selection: LaterPeriodLivePutKey,
  record: LaterPeriodLivePutRecord,
) {
  const { declaration, permission } = matchLaterPeriodLivePutRecord(
    scope,
    selection,
    record,
  ).livePut;
  if (!permission) throw invalid();
  const { attempt } = declaration;
  const { bucket, key, expectedBucketOwner, contentLength } = attempt.request;
  return Object.freeze({
    authorizationId: permission.authorizationId,
    permissionHash: permission.permissionHash,
    attemptDefinitionHash: attempt.definitionHash,
    transportRequestHash: permission.selection.transportRequestHash,
    target: Object.freeze({ bucket, key, expectedBucketOwner }),
    sha256: attempt.read.sha256,
    size: contentLength,
    admittedAt: permission.admittedAt,
  });
}

export type LaterPeriodLivePutEffect = ReturnType<
  typeof laterPeriodLivePutEffect
>;
export type LaterPeriodLivePutEffects = Readonly<{
  historical: LaterPeriodLivePutEffect;
  final: LaterPeriodLivePutEffect;
}>;

export function assertLaterPeriodLivePutEffect(
  scope: LaterPeriodLiveMediaScope,
  effect: LaterPeriodLivePutEffect,
  leg: LaterPeriodLivePutKey['leg'],
) {
  if (
    !effect ||
    ![
      effect.authorizationId,
      effect.permissionHash,
      effect.attemptDefinitionHash,
      effect.transportRequestHash,
      effect.sha256,
    ].every(sourceHashValid) ||
    effect.target?.key !==
      (leg === 'HISTORICAL' ? scope.historicalKey : scope.finalKey) ||
    effect.size !== scope.source.revision.size
  )
    throw invalid();
  historicalPutEvidenceTime(effect.admittedAt);
}

export type LaterPeriodLivePutDeclarationInput = LaterPeriodLivePutKey &
  Readonly<{
    expectedAttemptHash: string;
    dispatcherInstanceId: string;
    source: LaterPeriodLivePutSourceReport;
    destination: LaterPeriodLivePutDestinationAccreditation;
  }>;

export function matchLaterPeriodLivePutRecord(
  scope: LaterPeriodLiveMediaScope,
  selection: LaterPeriodLivePutKey,
  stored: LaterPeriodLivePutRecord,
) {
  const { declaration, permission } = stored.livePut;
  if (!declaration || permission === null) throw invalid();
  const attempt = buildLaterPeriodLivePutAttempt(
    scope,
    selection,
    declaration.attempt.dispatcherInstanceId,
    declaration.source,
  );
  const rebuilt = buildLaterPeriodLivePutDeclaration(
    attempt,
    declaration.source,
    declaration.destination,
  );
  if (permission) {
    const pins = laterPeriodLivePutPermissionSelection(permission.selection);
    if (
      archiveHash(laterPeriodLivePutKey(pins)) !== archiveHash(selection) ||
      archiveHash(
        buildLaterPeriodLivePutPermission(
          pins,
          rebuilt,
          {
            artifact: permission.artifact,
            transportRequestHash: pins.transportRequestHash,
          },
          permission.admittedAt,
        ),
      ) !== archiveHash(permission)
    )
      throw invalid();
  }
  if (
    archiveHash(buildLaterPeriodLivePutRecord(rebuilt, permission)) !==
    archiveHash(stored)
  )
    throw invalid();
  return stored;
}
