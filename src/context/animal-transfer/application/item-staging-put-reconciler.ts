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
  ItemHistoricalPutVersionReader,
  assertHistoricalPutConservationWindow,
  buildStagingPutVersionObservation,
  historicalPutEvidenceTime,
  matchStagingPutVersionEvidence,
} from '../domain/transfer-item-historical-put-reconciliation';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  ItemStagingPutVersionEvidenceReader,
  stagingPutVersionScope,
} from '../domain/transfer-item-staging-put-reconciliation';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

export type ItemStagingPutReconciliationInput =
  ItemHistoricalPutPermissionReadInput &
    Readonly<{
      expectedPermissionHash: string;
      expectedEvidenceHash: string;
      requiredThrough: string;
    }>;

const invalid = () =>
  new ConflictError(
    'The staging PUT version could not be reconciled under the exact permission',
  );

export class ItemStagingPutReconciler {
  constructor(
    private readonly store: Pick<
      ItemCopyRecordStore,
      'readStagingPutReconciliationContext' | 'recordStagingPutVersion'
    >,
    private readonly evidenceReader: ItemStagingPutVersionEvidenceReader,
    private readonly versions: ItemHistoricalPutVersionReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcileAndRecord(raw: ItemStagingPutReconciliationInput) {
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
    const context = await this.store.readStagingPutReconciliationContext(input);
    if (
      !context ||
      context.permission.permissionHash !== expectedPermissionHash
    )
      throw invalid();
    if (context.versionRecord) {
      const { observation } = context.versionRecord;
      if (
        observation.evidenceHash !== expectedEvidenceHash ||
        observation.requiredThrough !== requiredThrough
      )
        throw new ConflictError(
          'The original staging PUT version observation cannot be replaced',
        );
      return context.versionRecord;
    }

    const scope = stagingPutVersionScope(context);
    const evidence = matchStagingPutVersionEvidence(
      scope,
      await this.evidenceReader.readStagingVersionEvidence(
        scope,
        expectedEvidenceHash,
      ),
      expectedEvidenceHash,
    );
    const startedAt = this.now().getTime();
    if (startedAt < historicalPutEvidenceTime(context.permission.admittedAt))
      throw invalid();
    assertHistoricalPutConservationWindow(evidence, horizon, startedAt);
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
        'The exact staging PUT version could not be read',
      );
    }
    const current = await this.store.readStagingPutReconciliationContext(input);
    if (
      !current ||
      archiveHash(stagingPutVersionScope(current)) !== evidence.scopeHash
    )
      throw invalid();
    return this.store.recordStagingPutVersion(input, {
      observation: buildStagingPutVersionObservation(
        scope,
        evidence,
        expectedEvidenceHash,
        this.now().getTime(),
        requiredThrough,
      ),
      evidence,
    });
  }
}
