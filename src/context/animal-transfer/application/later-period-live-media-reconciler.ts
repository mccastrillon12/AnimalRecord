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
import {
  ItemCaptureInput,
  itemCaptureInput,
} from '../domain/transfer-item-capture';
import type { ItemHistoricalPutVersionReader } from '../domain/transfer-item-historical-put-reconciliation';
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
    if (
      scopeHash !== pins.expectedScopeHash ||
      archiveHash(scope) !== scopeHash
    )
      throw new ConflictError('The sealed live media scope changed');
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
    return this.store.register(item, pins, evidence);
  }
}
