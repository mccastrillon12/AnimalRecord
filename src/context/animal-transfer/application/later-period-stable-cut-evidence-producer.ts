import { DomainError } from '../../shared/domain/DomainError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import type { LaterPeriodLiveMediaEvidence } from '../domain/later-period-live-media';
import { archiveHash } from '../domain/ownership-archive';
import {
  buildPublishedHistoryStableCutScope,
  type PublishedHistoryStableCutFile,
  type PublishedHistoryStableCutScope,
  type PublishedHistoryStableCutVersion,
} from '../domain/published-history-stable-cut-scope';
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
  type ItemHistoricalPutVersionReader,
} from '../domain/transfer-item-historical-put-reconciliation';
import {
  LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
  matchLaterPeriodStableCutAccreditation,
  type LaterPeriodStableCutAccreditation,
  type LaterPeriodStableCutScope,
} from '../domain/transfer-item-stable-cut-evidence';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

type LiveMediaReference = Readonly<{
  id: string;
  fileId: string;
  key: string;
  evidenceHash: string;
  historical: LaterPeriodLiveMediaEvidence['historical'];
  final: LaterPeriodLiveMediaEvidence['final'];
}>;

export type LaterPeriodStableCutEvidenceSelection = Readonly<{
  scope: LaterPeriodStableCutScope;
  retainedScope: PublishedHistoryStableCutScope;
  retainedFiles: readonly PublishedHistoryStableCutFile[];
  liveMedia: readonly LiveMediaReference[];
}>;

type WriterCoverage = Omit<
  LaterPeriodStableCutAccreditation,
  'protocol' | 'retainedVersionsEvidenceHash' | 'liveVersionsEvidenceHash'
>;
type Version = Pick<
  PublishedHistoryStableCutVersion,
  'target' | 'revision' | 'sha256' | 'conservationControlsHash'
>;

const invalid = () =>
  new ConflictError(
    'The selected later-period stable-cut evidence is inconsistent',
  );

/** Coverage is supplied independently. Object reads only verify the selected copies. */
export class LaterPeriodStableCutEvidenceProducer {
  constructor(
    private readonly coverage: Readonly<{
      readCoverage(
        scope: LaterPeriodStableCutScope,
      ): Promise<WriterCoverage | null>;
    }>,
    private readonly storage: ItemSourceRetentionReader &
      ItemHistoricalPutVersionReader,
    private readonly now: () => Date,
  ) {}

  async produce(raw: LaterPeriodStableCutEvidenceSelection) {
    const { scope, retainedScope, retainedFiles, liveMedia } =
      structuredClone(raw);
    const { scopeHash, ...facts } = scope;
    const generations = [
      ...new Set([
        ...retainedScope.retained.conservationControlsHashes,
        ...liveMedia.flatMap(({ historical, final }) => [
          historical.conservationControlsHash,
          final.conservationControlsHash,
        ]),
      ]),
    ].sort();
    if (
      scope.protocol !== LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL ||
      scopeHash !== archiveHash(facts) ||
      scope.retainedScopeHash !== retainedScope.scopeHash ||
      scope.retainedProjectionHash !== retainedScope.binding.projectionHash ||
      scope.archiveId !== retainedScope.binding.archiveId ||
      scope.requiredThrough !== retainedScope.binding.requiredThrough ||
      scope.retainedFileCount !== retainedFiles.length ||
      archiveHash(
        buildPublishedHistoryStableCutScope(
          retainedScope.binding,
          retainedFiles,
        ),
      ) !== archiveHash(retainedScope) ||
      scope.liveManifest.fileCount !== liveMedia.length ||
      scope.liveMediaDigest !== archiveHash(liveMedia) ||
      archiveHash(scope.conservationControlsHashes) !==
        archiveHash(generations) ||
      !generations.every(sourceHashValid)
    )
      throw invalid();

    const horizon = historicalPutEvidenceTime(scope.requiredThrough);
    const startedAt = this.now().getTime();
    if (!Number.isSafeInteger(startedAt) || startedAt > horizon)
      throw invalid();
    const coverage = structuredClone(
      await this.coverage.readCoverage(structuredClone(scope)),
    );
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

    let validUntil = historicalPutEvidenceTime(coverage.validUntil);
    const observe = async (
      files: readonly { historical: Version; final: Version }[],
    ) => {
      const observations: Array<
        Readonly<{ pinHash: string; retainUntil: string }>
      > = [];
      for (const { historical, final } of files) {
        for (const version of [historical, final]) {
          const observed = await this.verifyVersion(version, horizon);
          validUntil = Math.min(
            validUntil,
            historicalPutEvidenceTime(observed.retainUntil),
          );
          observations.push(observed);
        }
      }
      return observations;
    };
    const retained = await observe(retainedFiles);
    const live = await observe(liveMedia);
    const report: LaterPeriodStableCutAccreditation = {
      ...coverage,
      protocol: 'LATER_PERIOD_ITEM_STABLE_CUT_ACCREDITATION_V1',
      validUntil: new Date(validUntil).toISOString(),
      ...(retained.length
        ? {
            retainedVersionsEvidenceHash: archiveHash([
              scope.retainedScopeHash,
              retained,
            ]),
          }
        : {}),
      ...(live.length
        ? {
            liveVersionsEvidenceHash: archiveHash([
              scope.liveMediaDigest,
              live,
            ]),
          }
        : {}),
    };
    const checkedAt = this.now().getTime();
    if (checkedAt < startedAt) throw invalid();
    const accreditationHash = archiveHash(report);
    const observation = matchLaterPeriodStableCutAccreditation(
      scope,
      report,
      accreditationHash,
      checkedAt,
    );
    return Object.freeze({ accreditation: Object.freeze(report), observation });
  }

  private async verifyVersion(version: Version, horizon: number) {
    const { target, sha256 } = version;
    const revision = captureItemObjectRevision(version.revision);
    const { versionId } = revision;
    if (!isPinnedItemSourceVersion(versionId) || !sourceHashValid(sha256))
      throw invalid();
    try {
      const retention = await this.storage.readSourceRetention({
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
        await this.storage.readVersion(target, revision),
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
      throw new ExternalServiceError(
        'A selected later-period object version could not be verified',
      );
    }
  }
}
