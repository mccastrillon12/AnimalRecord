import { sign, type KeyObject } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { assertStableCutWriterCoverage } from '../../application/stable-cut-version-evidence';
import { archiveHash } from '../../domain/ownership-archive';
import {
  profileIdValid,
  sourceHashValid,
} from '../../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';
import {
  ITEM_STABLE_CUT_SCOPE_PROTOCOL,
  LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
  type ItemStableCutScope,
  type LaterPeriodStableCutScope,
  type StableCutWriterCoverage,
} from '../../domain/transfer-item-stable-cut-evidence';

export const LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL =
  'LATER_PERIOD_STABLE_CUT_WRITER_COVERAGE_SIGNATURE_V1' as const;
export const ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL =
  'ITEM_STABLE_CUT_WRITER_COVERAGE_SIGNATURE_V1' as const;
export type CutScope = ItemStableCutScope | LaterPeriodStableCutScope;
type SignatureProtocol =
  | typeof ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL
  | typeof LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL;

const invalid = () =>
  new ConflictError('The signed stable-cut writer coverage is inconsistent');

export function stableCutCoverageSelection(scope: CutScope) {
  if (!scope) throw invalid();
  const { scopeHash, ...facts } = scope;
  if (
    !sourceHashValid(scopeHash) ||
    scopeHash !== archiveHash(facts) ||
    (facts.protocol !== ITEM_STABLE_CUT_SCOPE_PROTOCOL &&
      facts.protocol !== LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL)
  )
    throw invalid();
  const initial = facts.protocol === ITEM_STABLE_CUT_SCOPE_PROTOCOL;
  return {
    scopeHash,
    horizon: historicalPutEvidenceTime(
      initial ? facts.selection?.requiredThrough : facts.requiredThrough,
    ),
    protocol: initial
      ? ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL
      : LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    objectKey: `stable-cut-writer-coverage/v1/${scopeHash}.json`,
  };
}

export function stableCutCoverageSignedBytes(
  protocol: SignatureProtocol,
  report: StableCutWriterCoverage,
) {
  return Buffer.from(archiveHash({ protocol, report }), 'hex');
}

type VerifiedWriterCoverage = Omit<StableCutWriterCoverage, 'issuerId'>;

/** Trusted issuer-side dependency. An incomplete inventory or unresolved effect yields no coverage. */
export interface StableCutWriterEvidenceReader {
  readVerifiedCoverage(
    scope: CutScope,
    controlsHash: string,
  ): Promise<VerifiedWriterCoverage | null>;
}

type IssuerConfiguration = Readonly<{
  issuerId: string;
  controlsHash: string;
  privateKey: KeyObject;
}>;

/** Explicit composition for the independent evidence issuer. Returns a signed object for publication. */
export class StableCutWriterCoverageIssuer {
  private readonly config: IssuerConfiguration;

  constructor(
    private readonly evidence: StableCutWriterEvidenceReader,
    config: IssuerConfiguration,
    private readonly now: () => Date,
  ) {
    if (
      !profileIdValid(config.issuerId) ||
      !sourceHashValid(config.controlsHash) ||
      config.privateKey?.type !== 'private' ||
      config.privateKey.asymmetricKeyType !== 'ed25519'
    )
      throw new ConflictError(
        'The stable-cut coverage issuer is not configured',
      );
    this.config = Object.freeze({ ...config });
  }

  async issue(raw: CutScope) {
    const scope = structuredClone(raw);
    const { scopeHash, horizon, protocol, objectKey } =
      stableCutCoverageSelection(scope);
    const startedAt = this.now().getTime();
    if (!Number.isSafeInteger(startedAt) || startedAt > horizon)
      throw invalid();
    const evidence = structuredClone(
      await this.evidence.readVerifiedCoverage(scope, this.config.controlsHash),
    );
    if (evidence === null) return null;
    const checkedAt = this.now().getTime();
    if (
      !Number.isSafeInteger(checkedAt) ||
      checkedAt < startedAt ||
      checkedAt > horizon ||
      evidence?.controlsHash !== this.config.controlsHash
    )
      throw invalid();

    const report = {
      issuerId: this.config.issuerId,
      scopeHash: evidence.scopeHash,
      controlsHash: evidence.controlsHash,
      writerInventoryHash: evidence.writerInventoryHash,
      writers: evidence.writers,
      copyEffects: evidence.copyEffects,
      validFrom: evidence.validFrom,
      validUntil: evidence.validUntil,
    } satisfies StableCutWriterCoverage;
    assertStableCutWriterCoverage(
      report,
      scopeHash,
      checkedAt,
      horizon,
      invalid,
    );
    Object.values(report.writers).forEach(Object.freeze);
    Object.freeze(report.writers);
    Object.freeze(report.copyEffects);
    Object.freeze(report);
    const signature = sign(
      null,
      stableCutCoverageSignedBytes(protocol, report),
      this.config.privateKey,
    ).toString('base64');
    return Object.freeze({
      objectKey,
      envelope: Object.freeze({ protocol, report, signature }),
    });
  }
}
