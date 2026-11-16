import { DomainError } from '../../shared/domain/DomainError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../domain/ownership-archive';
import {
  assertPublishedHistoryConservationWindow,
  PUBLISHED_HISTORY_CONSERVATION_PROTOCOL,
  PublishedHistoryConservationEvidence,
  PublishedHistoryConservationScope,
} from '../domain/published-history-conservation';
import {
  PublishedHistoryVersionInput,
  publishedHistoryVersionInput,
} from '../domain/published-ownership-history';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from '../domain/transfer-item-copy-intent';
import {
  ItemSourceRetentionReader,
  profileIdValid,
  sourceHashValid,
} from '../domain/transfer-item-historical-observation';
import {
  historicalPutEvidenceTime,
  ItemHistoricalPutVersionReader,
} from '../domain/transfer-item-historical-put-reconciliation';
import { verifyHistoricalObjectBytes } from './item-historical-copy-observer';

type ScopeInput = Omit<PublishedHistoryVersionInput, 'requiredThrough'>;
type KeyResolver = (url: string) => string | undefined;
type RenewalReceipt = Readonly<{
  evidenceHash: string;
  recordedAt: string;
  replayed: boolean;
}>;
interface PublishedHistoryConservationStore {
  observePublishedHistoryConservation(
    input: ScopeInput,
    keyFromUrl: KeyResolver,
  ): Promise<
    Readonly<{
      scope: PublishedHistoryConservationScope;
      currentEvidenceHash: string | null;
    }>
  >;
  registerPublishedHistoryConservation(
    input: ScopeInput,
    keyFromUrl: KeyResolver,
    expectedEvidenceHash: string,
    expectedPreviousEvidenceHash: string | null,
    verified: Readonly<{
      evidence?: PublishedHistoryConservationEvidence;
      requiredThrough: string;
    }>,
  ): Promise<RenewalReceipt>;
}

type Controls = Readonly<{
  issuerId: string;
  controlsHash: string;
  bucket: string;
  expectedBucketOwner: string;
}>;

const invalid = () =>
  new ConflictError(
    'The published historical version or conservation window changed',
  );

/** Explicit backend composition. Storage observations precede the Mongo register transaction. */
export class PublishedHistoryConservationRenewer {
  private readonly controls: Controls;

  constructor(
    private readonly history: PublishedHistoryConservationStore,
    private readonly storage: ItemSourceRetentionReader &
      ItemHistoricalPutVersionReader,
    private readonly keyFromUrl: KeyResolver,
    controls: Controls,
    private readonly now: () => Date,
  ) {
    if (
      !profileIdValid(controls?.issuerId) ||
      !sourceHashValid(controls.controlsHash) ||
      typeof controls.bucket !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(controls.bucket) ||
      typeof controls.expectedBucketOwner !== 'string' ||
      !/^\d{12}$/.test(controls.expectedBucketOwner)
    )
      throw invalid();
    this.controls = Object.freeze({ ...controls });
  }

  async renew(
    raw: PublishedHistoryVersionInput,
    expectedPreviousEvidenceHash: string | null,
  ) {
    const input = publishedHistoryVersionInput(raw);
    if (
      expectedPreviousEvidenceHash !== null &&
      !sourceHashValid(expectedPreviousEvidenceHash)
    )
      throw invalid();
    const { scope, currentEvidenceHash } =
      await this.history.observePublishedHistoryConservation(
        input,
        this.keyFromUrl,
      );
    if (currentEvidenceHash !== expectedPreviousEvidenceHash)
      throw new ConflictError('The recorded historical conservation changed');
    const { issuerId, controlsHash, bucket, expectedBucketOwner } =
      this.controls;
    const { scopeHash, ...facts } = scope;
    const revision = captureItemObjectRevision(scope.revision);
    const { versionId } = revision;
    if (
      scope.protocol !== PUBLISHED_HISTORY_CONSERVATION_PROTOCOL ||
      scopeHash !== archiveHash(facts) ||
      scope.periodId !== input.periodId ||
      scope.publicationHash !== input.publicationHash ||
      scope.fileId !== input.fileId ||
      scope.target.bucket !== bucket ||
      scope.target.expectedBucketOwner !== expectedBucketOwner ||
      !isPinnedItemSourceVersion(versionId) ||
      !sourceHashValid(scope.sha256)
    )
      throw invalid();
    const startedAt = this.now().getTime();
    const horizon = historicalPutEvidenceTime(input.requiredThrough);
    if (!Number.isSafeInteger(startedAt) || startedAt > horizon)
      throw invalid();
    const target = Object.freeze({ ...scope.target });
    const retention = await this.storage.readSourceRetention({
      bucket,
      key: target.key,
      versionId,
    });
    const { mode, reportedRetainUntil } = retention;
    if (
      retention.expectedBucketOwner !== expectedBucketOwner ||
      mode !== 'COMPLIANCE' ||
      historicalPutEvidenceTime(reportedRetainUntil) <=
        Math.max(
          horizon,
          historicalPutEvidenceTime(
            scope.originalValidUntil ?? scope.originalRequiredThrough,
          ),
        )
    )
      throw invalid();
    try {
      const read = await this.storage.readVersion(target, revision);
      await verifyHistoricalObjectBytes(read, revision, scope.sha256, invalid);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ExternalServiceError(
        'The published historical version could not be verified',
      );
    }
    const checkedAt = this.now().getTime();
    if (!Number.isSafeInteger(checkedAt) || checkedAt < startedAt)
      throw invalid();
    const evidence: PublishedHistoryConservationEvidence = Object.freeze({
      protocol: PUBLISHED_HISTORY_CONSERVATION_PROTOCOL,
      scopeHash,
      issuerId,
      controlsHash,
      conservationEvidenceHash: archiveHash({
        scopeHash,
        target,
        revision,
        mode,
        reportedRetainUntil,
        controlsHash,
      }),
      validFrom: new Date(checkedAt).toISOString(),
      validUntil: reportedRetainUntil,
    });
    assertPublishedHistoryConservationWindow(
      evidence,
      input.requiredThrough,
      checkedAt,
    );
    return this.history.registerPublishedHistoryConservation(
      input,
      this.keyFromUrl,
      archiveHash(evidence),
      expectedPreviousEvidenceHash,
      { evidence, requiredThrough: input.requiredThrough },
    );
  }

  /** Revalidates a previously recorded report after an uncertain acknowledgment. */
  replay(raw: PublishedHistoryVersionInput, expectedEvidenceHash: string) {
    const input = publishedHistoryVersionInput(raw);
    if (!sourceHashValid(expectedEvidenceHash)) throw invalid();
    return this.history.registerPublishedHistoryConservation(
      input,
      this.keyFromUrl,
      expectedEvidenceHash,
      null,
      { requiredThrough: input.requiredThrough },
    );
  }
}
