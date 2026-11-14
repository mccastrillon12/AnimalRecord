import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { DomainError } from '../../shared/domain/DomainError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import {
  LaterPeriodLiveMediaEvidence,
  LaterPeriodLiveMediaScope,
  LaterPeriodLiveMediaSelection,
  laterPeriodLiveMediaSelection,
  matchLaterPeriodLiveMediaEvidence,
} from '../domain/later-period-live-media';
import { archiveHash } from '../domain/ownership-archive';
import type { LaterPeriodLivePutEffects } from '../domain/later-period-live-put';
import {
  ItemCaptureInput,
  itemCaptureInput,
} from '../domain/transfer-item-capture';
import {
  historicalPutEvidenceTime,
  type ItemHistoricalPutVersionReader,
} from '../domain/transfer-item-historical-put-reconciliation';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

export interface LaterPeriodLiveMediaStore {
  observe(
    item: ItemCaptureInput,
    fileId: string,
  ): Promise<
    Readonly<{
      scope: LaterPeriodLiveMediaScope;
      scopeHash: string;
      currentEvidenceHash: string | null;
    }>
  >;
  readCopyEffects(
    item: ItemCaptureInput,
    fileId: string,
    expectedScopeHash: string,
  ): Promise<LaterPeriodLivePutEffects>;
  register(
    item: ItemCaptureInput,
    pins: LaterPeriodLiveMediaSelection,
    evidence?: LaterPeriodLiveMediaEvidence,
  ): Promise<
    Readonly<{
      evidenceHash: string;
      recordedAt: string;
      replayed: boolean;
      businessCommit: 'NOT_AUTHORIZED';
    }>
  >;
}

export interface LaterPeriodLiveMediaEvidenceProducer {
  produce(
    scope: LaterPeriodLiveMediaScope,
    effects: LaterPeriodLivePutEffects,
    requiredThrough: string,
  ): Promise<LaterPeriodLiveMediaEvidence>;
}

/** Explicit composition. All remote reads finish before the persistence transaction. */
export class LaterPeriodLiveMediaReconciler {
  constructor(
    private readonly store: LaterPeriodLiveMediaStore,
    private readonly reports: Readonly<{
      read(
        scope: LaterPeriodLiveMediaScope,
        expectedEvidenceHash: string,
      ): Promise<LaterPeriodLiveMediaEvidence | null>;
    }>,
    private readonly versions: ItemHistoricalPutVersionReader,
    private readonly bucket: Readonly<{
      bucket: string;
      expectedBucketOwner: string;
    }>,
    private readonly now: () => Date,
  ) {}

  observe(raw: ItemCaptureInput, fileId: string) {
    return this.store.observe(itemCaptureInput(raw), fileId);
  }

  /** Reconstructs and verifies evidence even when the dispatcher returned no result. */
  async reconcilePermitted(
    rawItem: ItemCaptureInput,
    rawPins: Omit<LaterPeriodLiveMediaSelection, 'expectedEvidenceHash'>,
    producer: LaterPeriodLiveMediaEvidenceProducer,
  ) {
    const item = itemCaptureInput(rawItem);
    const {
      fileId,
      expectedScopeHash,
      expectedPreviousEvidenceHash,
      requiredThrough,
    } = rawPins;
    if (
      ![fileId, expectedScopeHash].every(sourceHashValid) ||
      (expectedPreviousEvidenceHash !== null &&
        !sourceHashValid(expectedPreviousEvidenceHash))
    )
      throw new ConflictError('Invalid later-period live media selection');
    historicalPutEvidenceTime(requiredThrough);
    const { scope, scopeHash, currentEvidenceHash } = await this.store.observe(
      item,
      fileId,
    );
    this.assertScope(scope, scopeHash, expectedScopeHash);
    if (currentEvidenceHash !== expectedPreviousEvidenceHash)
      throw new ConflictError('The recorded live media evidence changed');
    const effects = await this.store.readCopyEffects(
      item,
      fileId,
      expectedScopeHash,
    );
    const raw = await producer.produce(scope, effects, requiredThrough);
    const evidence = matchLaterPeriodLiveMediaEvidence(
      scope,
      raw,
      requiredThrough,
      this.now().getTime(),
    );
    if (
      evidence.copyPermissionHashes?.historical !==
        effects.historical.permissionHash ||
      evidence.copyPermissionHashes?.final !== effects.final.permissionHash
    )
      throw new ConflictError(
        'The produced live media report differs from the permitted effects',
      );
    const pins = laterPeriodLiveMediaSelection({
      fileId,
      expectedScopeHash,
      expectedPreviousEvidenceHash,
      requiredThrough,
      expectedEvidenceHash: archiveHash(evidence),
    });
    if (currentEvidenceHash === pins.expectedEvidenceHash)
      return this.store.register(item, pins);
    await this.verifyVersions(scope, evidence);
    return this.store.register(item, pins, evidence);
  }

  async reconcile(
    rawItem: ItemCaptureInput,
    rawPins: LaterPeriodLiveMediaSelection,
  ) {
    const item = itemCaptureInput(rawItem);
    const pins = laterPeriodLiveMediaSelection(rawPins);
    const { scope, scopeHash, currentEvidenceHash } = await this.store.observe(
      item,
      pins.fileId,
    );
    this.assertScope(scope, scopeHash, pins.expectedScopeHash);
    if (currentEvidenceHash === pins.expectedEvidenceHash)
      return this.store.register(item, pins);
    if (currentEvidenceHash !== pins.expectedPreviousEvidenceHash)
      throw new ConflictError('The recorded live media evidence changed');
    const evidence = matchLaterPeriodLiveMediaEvidence(
      scope,
      await this.reports.read(scope, pins.expectedEvidenceHash),
      pins.requiredThrough,
      this.now().getTime(),
    );
    if (archiveHash(evidence) !== pins.expectedEvidenceHash)
      throw new ConflictError(
        'The independent live media report differs from the selected hash',
      );
    await this.verifyVersions(scope, evidence);
    return this.store.register(item, pins, evidence);
  }

  private assertScope(
    scope: LaterPeriodLiveMediaScope,
    scopeHash: string,
    expectedScopeHash: string,
  ) {
    if (scopeHash !== expectedScopeHash || archiveHash(scope) !== scopeHash)
      throw new ConflictError('The sealed live media scope changed');
  }

  private async verifyVersions(
    scope: LaterPeriodLiveMediaScope,
    evidence: LaterPeriodLiveMediaEvidence,
  ) {
    for (const { target } of [evidence.historical, evidence.final]) {
      if (
        target.bucket !== this.bucket.bucket ||
        target.expectedBucketOwner !== this.bucket.expectedBucketOwner
      )
        throw new ConflictError(
          'The live copies must use the configured archive bucket',
        );
    }
    // Check the pinned source bytes as well as both copies against the same digest.
    const sourceTarget = { ...this.bucket, key: scope.source.key };
    const invalid = () =>
      new ConflictError(
        'The exact live file version differs from its accredited bytes',
      );
    try {
      for (const { target, revision } of [
        { target: sourceTarget, revision: scope.source.revision },
        evidence.historical,
        evidence.final,
      ]) {
        await verifyHistoricalObjectBytes(
          await this.versions.readVersion(target, revision),
          revision,
          evidence.historical.sha256,
          invalid,
        );
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        'The exact live file version could not be read',
      );
    }
  }
}
