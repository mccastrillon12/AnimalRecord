import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { DomainError } from '../../shared/domain/DomainError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../domain/ownership-archive';
import {
  ItemCopyRecordStore,
  ItemHistoricalPutPermissionReadInput,
  historicalPutPermissionReadInput,
} from '../domain/transfer-item-copy-record';
import {
  ItemHistoricalPutVersionEvidenceReader,
  ItemHistoricalPutVersionReader,
  assertHistoricalPutConservationWindow,
  buildHistoricalPutVersionObservation,
  historicalPutEvidenceTime,
  historicalPutVersionScope,
  matchHistoricalPutVersionEvidence,
} from '../domain/transfer-item-historical-put-reconciliation';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

export type ItemHistoricalPutReconciliationInput =
  ItemHistoricalPutPermissionReadInput &
    Readonly<{
      expectedPermissionHash: string;
      expectedEvidenceHash: string;
      requiredThrough: string;
    }>;

const invalid = () =>
  new ConflictError(
    'The historical PUT version could not be reconciled under the exact permission',
  );

/** Observes one exact version. Producer and object I/O run outside the store snapshots. */
export class ItemHistoricalPutReconciler {
  constructor(
    private readonly store: Pick<
      ItemCopyRecordStore,
      'readHistoricalPutReconciliationContext' | 'recordHistoricalPutVersion'
    >,
    private readonly evidenceReader: ItemHistoricalPutVersionEvidenceReader,
    private readonly versions: ItemHistoricalPutVersionReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async observe(raw: ItemHistoricalPutReconciliationInput) {
    const record = await this.reconcile(raw, false);
    return record.observation;
  }

  reconcileAndRecord(raw: ItemHistoricalPutReconciliationInput) {
    return this.reconcile(raw, true);
  }

  private async reconcile(
    raw: ItemHistoricalPutReconciliationInput,
    persist: boolean,
  ) {
    const {
      expectedPermissionHash,
      expectedEvidenceHash,
      requiredThrough,
      ...pins
    } = raw ?? {};
    if (
      !sourceHashValid(expectedPermissionHash) ||
      !sourceHashValid(expectedEvidenceHash)
    )
      throw invalid();
    const horizon = historicalPutEvidenceTime(requiredThrough);
    const input = historicalPutPermissionReadInput(pins);
    const context =
      await this.store.readHistoricalPutReconciliationContext(input);
    if (
      !context ||
      context.permission.permissionHash !== expectedPermissionHash
    )
      throw invalid();
    if (persist && context.versionRecord) {
      const { observation } = context.versionRecord;
      if (
        observation.evidenceHash !== expectedEvidenceHash ||
        observation.requiredThrough !== requiredThrough
      )
        throw new ConflictError(
          'The original historical PUT version observation cannot be replaced',
        );
      return context.versionRecord;
    }
    const scope = historicalPutVersionScope(context);
    const evidence = matchHistoricalPutVersionEvidence(
      scope,
      await this.evidenceReader.readVersionEvidence(
        scope,
        expectedEvidenceHash,
      ),
      expectedEvidenceHash,
    );
    assertHistoricalPutConservationWindow(
      evidence,
      horizon,
      this.now().getTime(),
    );
    try {
      const read = await this.versions.readVersion(
        scope.target,
        evidence.revision,
      );
      await verifyHistoricalObjectBytes(
        read,
        evidence.revision,
        scope.sha256,
        invalid,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        'The exact historical PUT version could not be read',
      );
    }
    const current =
      await this.store.readHistoricalPutReconciliationContext(input);
    if (
      !current ||
      archiveHash(historicalPutVersionScope(current)) !== evidence.scopeHash
    )
      throw invalid();
    const checkedAt = this.now().getTime();
    const record = Object.freeze({
      observation: buildHistoricalPutVersionObservation(
        scope,
        evidence,
        expectedEvidenceHash,
        checkedAt,
        requiredThrough,
      ),
      evidence,
    });
    return persist
      ? this.store.recordHistoricalPutVersion(input, record)
      : record;
  }
}
