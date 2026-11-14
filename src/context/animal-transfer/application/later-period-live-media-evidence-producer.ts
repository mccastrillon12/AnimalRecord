import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  LaterPeriodLiveMediaEvidence,
  LaterPeriodLiveMediaScope,
  matchLaterPeriodLiveMediaEvidence,
} from '../domain/later-period-live-media';
import {
  assertLaterPeriodLivePutEffect,
  LaterPeriodLivePutEffect,
  LaterPeriodLivePutEffects,
} from '../domain/later-period-live-put';
import { archiveHash, ObjectRevision } from '../domain/ownership-archive';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from '../domain/transfer-item-copy-intent';
import {
  ItemSourceRetentionReader,
  profileIdValid,
  sourceHashValid,
} from '../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import type { LaterPeriodLiveMediaEvidenceProducer } from './later-period-live-media-reconciler';

type AuditedVersion = Readonly<{
  effectHash: string;
  operation: 'PUT_OBJECT';
  outcome: 'APPLIED';
  revision: Readonly<ObjectRevision>;
  occurredAt: string;
  eventEvidenceHash: string;
}>;

/** Independent audit must correlate the actual write and its exact version to the permission. */
export interface LaterPeriodLivePutAuditReader {
  readAppliedVersion(
    effect: LaterPeriodLivePutEffect,
  ): Promise<AuditedVersion | null>;
}

type ConservationControls = Readonly<{
  bucket: string;
  expectedBucketOwner: string;
  controlsHash: string;
}>;

const missingEffect = () =>
  new ConflictError(
    'The exact version written by the permitted live PUT is unconfirmed',
  );

/** Composed with trusted audit and exact-version COMPLIANCE retention readers. */
export class LaterPeriodLiveMediaAuditProducer implements LaterPeriodLiveMediaEvidenceProducer {
  private readonly controls: ConservationControls;

  constructor(
    private readonly issuerId: string,
    private readonly audit: LaterPeriodLivePutAuditReader,
    private readonly retention: ItemSourceRetentionReader,
    controls: ConservationControls,
    private readonly now: () => Date,
  ) {
    if (
      !profileIdValid(issuerId) ||
      !sourceHashValid(controls?.controlsHash) ||
      typeof controls.bucket !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(controls.bucket) ||
      typeof controls.expectedBucketOwner !== 'string' ||
      !/^\d{12}$/.test(controls.expectedBucketOwner)
    )
      throw new ConflictError(
        'The live media conservation producer is not configured',
      );
    this.controls = Object.freeze({ ...controls });
  }

  async produce(
    scope: LaterPeriodLiveMediaScope,
    effects: LaterPeriodLivePutEffects,
    requiredThrough: string,
  ): Promise<LaterPeriodLiveMediaEvidence> {
    const horizon = historicalPutEvidenceTime(requiredThrough);
    const startedAt = this.now().getTime();
    assertLaterPeriodLivePutEffect(scope, effects.historical, 'HISTORICAL');
    assertLaterPeriodLivePutEffect(scope, effects.final, 'FINAL');
    if (
      !Number.isSafeInteger(startedAt) ||
      startedAt > horizon ||
      effects.historical.sha256 !== effects.final.sha256 ||
      effects.historical.permissionHash === effects.final.permissionHash
    )
      throw missingEffect();
    for (const effect of [effects.historical, effects.final]) {
      if (
        effect.target.bucket !== this.controls.bucket ||
        effect.target.expectedBucketOwner !==
          this.controls.expectedBucketOwner ||
        historicalPutEvidenceTime(effect.admittedAt) > startedAt
      )
        throw missingEffect();
    }

    const historical = await this.readVersion(effects.historical, horizon);
    const final = await this.readVersion(effects.final, horizon);
    const checkedAt = this.now().getTime();
    if (
      checkedAt < startedAt ||
      historical.provenanceEvidenceHash === final.provenanceEvidenceHash
    )
      throw missingEffect();
    return matchLaterPeriodLiveMediaEvidence(
      scope,
      {
        protocol: 'LATER_PERIOD_LIVE_MEDIA_EVIDENCE_V1',
        issuerId: this.issuerId,
        scopeHash: archiveHash(scope),
        copyEffectsEvidenceHash: archiveHash({
          historical: historical.provenanceEvidenceHash,
          final: final.provenanceEvidenceHash,
        }),
        copyPermissionHashes: {
          historical: effects.historical.permissionHash,
          final: effects.final.permissionHash,
        },
        historical: historical.version,
        final: final.version,
        validFrom: new Date(
          Math.max(historical.appliedAt, final.appliedAt),
        ).toISOString(),
        validUntil: new Date(
          Math.min(historical.retainUntil, final.retainUntil),
        ).toISOString(),
      },
      requiredThrough,
      checkedAt,
    );
  }

  private async readVersion(effect: LaterPeriodLivePutEffect, horizon: number) {
    const audited = await this.audit.readAppliedVersion(effect);
    if (
      audited?.outcome !== 'APPLIED' ||
      audited.operation !== 'PUT_OBJECT' ||
      audited.effectHash !== archiveHash(effect) ||
      !sourceHashValid(audited.eventEvidenceHash)
    )
      throw missingEffect();
    const revision = captureItemObjectRevision(audited.revision);
    const { versionId } = revision;
    const appliedAt = historicalPutEvidenceTime(audited.occurredAt);
    if (
      !isPinnedItemSourceVersion(versionId) ||
      revision.size !== effect.size ||
      appliedAt < historicalPutEvidenceTime(effect.admittedAt) ||
      appliedAt > this.now().getTime()
    )
      throw missingEffect();

    const { target, sha256 } = effect;
    const result = await this.retention.readSourceRetention({
      bucket: target.bucket,
      key: target.key,
      versionId,
    });
    const retainUntil = historicalPutEvidenceTime(result.reportedRetainUntil);
    if (
      result.expectedBucketOwner !== target.expectedBucketOwner ||
      result.mode !== 'COMPLIANCE' ||
      retainUntil <= horizon
    )
      throw new ConflictError(
        'The written live version lacks sufficient compliance retention',
      );

    const provenanceEvidenceHash = archiveHash({
      effectHash: audited.effectHash,
      revision,
      occurredAt: audited.occurredAt,
      eventEvidenceHash: audited.eventEvidenceHash,
    });
    const conservationControlsHash = this.controls.controlsHash;
    return {
      appliedAt,
      retainUntil,
      provenanceEvidenceHash,
      version: {
        target,
        revision,
        sha256,
        provenanceEvidenceHash,
        conservationControlsHash,
        conservationEvidenceHash: archiveHash({
          target,
          revision,
          conservationControlsHash,
          mode: result.mode,
          retainUntil: result.reportedRetainUntil,
        }),
      },
    };
  }
}
