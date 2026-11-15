import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash, type ObjectRevision } from '../domain/ownership-archive';
import { captureItemObjectRevision } from '../domain/transfer-item-copy-intent';
import {
  profileIdValid,
  sourceHashValid,
} from '../domain/transfer-item-historical-observation';
import {
  historicalPutEvidenceTime,
  type ItemHistoricalPutVersionScope,
  type PutVersionEvidence,
} from '../domain/transfer-item-historical-put-reconciliation';
import {
  verifyStableCutVersion,
  type StableCutVersionStorage,
} from './stable-cut-version-evidence';

/** Independent authority correlates the original permit with a specific applied PUT. */
export interface PutVersionProvenanceReader {
  readAppliedVersion(
    scope: ItemHistoricalPutVersionScope,
    protocol: PutVersionEvidence['protocol'],
  ): Promise<Readonly<{
    scopeHash: string;
    protocol: PutVersionEvidence['protocol'];
    revision: Readonly<ObjectRevision>;
    appliedAt: string;
    provenanceEvidenceHash: string;
  }> | null>;
}

type Configuration = Readonly<{
  issuerId: string;
  conservationControlsHash: string;
}>;

const invalid = () =>
  new ConflictError('The applied PUT version evidence is inconsistent');

export class PutVersionEvidenceProducer {
  private readonly config: Configuration;

  constructor(
    private readonly provenance: PutVersionProvenanceReader,
    private readonly storage: StableCutVersionStorage,
    config: Configuration,
    private readonly now: () => Date,
  ) {
    if (
      !profileIdValid(config.issuerId) ||
      !sourceHashValid(config.conservationControlsHash)
    )
      throw invalid();
    this.config = Object.freeze({ ...config });
  }

  async produce<Protocol extends PutVersionEvidence['protocol']>(
    raw: ItemHistoricalPutVersionScope,
    protocol: Protocol,
    requiredThrough: string,
  ) {
    const scope = structuredClone(raw);
    const scopeHash = archiveHash(scope);
    const horizon = historicalPutEvidenceTime(requiredThrough);
    const startedAt = this.now().getTime();
    if (!Number.isSafeInteger(startedAt) || startedAt > horizon)
      throw invalid();

    const applied = await this.provenance.readAppliedVersion(
      structuredClone(scope),
      protocol,
    );
    if (!applied) return null;
    const { appliedAt, provenanceEvidenceHash } = applied;
    const revision = captureItemObjectRevision(applied.revision);
    const observedAt = this.now().getTime();
    if (
      applied.scopeHash !== scopeHash ||
      applied.protocol !== protocol ||
      !sourceHashValid(provenanceEvidenceHash) ||
      revision.size !== scope.size ||
      !Number.isSafeInteger(observedAt) ||
      observedAt < startedAt ||
      observedAt > horizon ||
      historicalPutEvidenceTime(appliedAt) > observedAt
    )
      throw invalid();

    const { issuerId, conservationControlsHash } = this.config;
    const version = await verifyStableCutVersion(
      this.storage,
      {
        target: scope.target,
        revision,
        sha256: scope.sha256,
        conservationControlsHash,
      },
      horizon,
      invalid,
      'The applied PUT version could not be read',
    );
    const checkedAt = this.now().getTime();
    if (
      !Number.isSafeInteger(checkedAt) ||
      checkedAt < observedAt ||
      checkedAt > horizon
    )
      throw invalid();
    return Object.freeze({
      protocol,
      issuerId,
      scopeHash,
      revision,
      provenanceEvidenceHash,
      conservationEvidenceHash: archiveHash({
        pinHash: version.pinHash,
        mode: 'COMPLIANCE',
        retainUntil: version.retainUntil,
      }),
      conservationControlsHash,
      validFrom: new Date(checkedAt).toISOString(),
      validUntil: version.retainUntil,
    });
  }
}
