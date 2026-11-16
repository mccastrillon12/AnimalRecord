import { sign, verify, type KeyObject } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { assertStableCutWriterCoverage } from '../../application/stable-cut-version-evidence';
import {
  stableCutScopeBinding,
  type CutScope,
  type StableCutWriterEvidenceReader,
} from '../../application/stable-cut-writer-evidence';
import { archiveHash } from '../../domain/ownership-archive';
import {
  profileIdValid,
  sourceHashValid,
} from '../../domain/transfer-item-historical-observation';
import type { StableCutWriterCoverage } from '../../domain/transfer-item-stable-cut-evidence';

export type {
  CutScope,
  StableCutWriterEvidenceReader,
} from '../../application/stable-cut-writer-evidence';

export const LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL =
  'LATER_PERIOD_STABLE_CUT_WRITER_COVERAGE_SIGNATURE_V1' as const;
export const ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL =
  'ITEM_STABLE_CUT_WRITER_COVERAGE_SIGNATURE_V1' as const;
type SignatureProtocol =
  | typeof ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL
  | typeof LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL;

const invalid = () =>
  new ConflictError('The signed stable-cut writer coverage is inconsistent');

export function stableCutCoverageSelection(scope: CutScope) {
  const { scopeHash, horizon, initial } = stableCutScopeBinding(scope, invalid);
  return {
    scopeHash,
    horizon,
    protocol: initial
      ? ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL
      : LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    objectKey: `stable-cut-writer-coverage/v1/${scopeHash}.json`,
  };
}

export function stableCutSignedBytes(protocol: string, report: unknown) {
  return Buffer.from(archiveHash({ protocol, report }), 'hex');
}

export function stableCutCoverageSignedBytes(
  protocol: SignatureProtocol,
  report: StableCutWriterCoverage,
) {
  return stableCutSignedBytes(protocol, report);
}

export function stableCutSignatureValid(
  protocol: string,
  report: unknown,
  signature: unknown,
  publicKey: KeyObject,
) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature))
    return false;
  const decoded = Buffer.from(signature, 'base64');
  return (
    decoded.toString('base64') === signature &&
    verify(null, stableCutSignedBytes(protocol, report), publicKey, decoded)
  );
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
