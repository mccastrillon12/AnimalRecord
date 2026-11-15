import type { S3Client } from '@aws-sdk/client-s3';
import { verify, type KeyObject } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import type {
  LaterPeriodStableCutWriterCoverage,
  LaterPeriodStableCutWriterCoverageReader,
} from '../../application/later-period-stable-cut-evidence-producer';
import {
  profileIdValid,
  sourceHashValid,
} from '../../domain/transfer-item-historical-observation';
import {
  putDestinationWriterCoverageValid,
  putDestinationWritersValid,
} from '../../domain/transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';
import type {
  ItemStableCutScope,
  LaterPeriodStableCutScope,
} from '../../domain/transfer-item-stable-cut-evidence';
import { readVersionedS3Json } from './read-versioned-s3-json';
import {
  ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
  LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
  stableCutCoverageSelection,
  stableCutCoverageSignedBytes,
  type CutScope,
} from './signed-stable-cut-coverage';

export {
  ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
  LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
} from './signed-stable-cut-coverage';
type SignatureProtocol =
  | typeof ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL
  | typeof LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL;

type Configuration = Readonly<{
  bucket: string;
  bucketOwner: string;
  issuerId: string;
  controlsHash: string;
  publicKey: KeyObject;
  maxBytes: number;
}>;

const invalid = () =>
  new ConflictError('The signed stable-cut writer coverage is inconsistent');

const reportFields = [
  'controlsHash',
  'copyEffects',
  'issuerId',
  'scopeHash',
  'validFrom',
  'validUntil',
  'writerInventoryHash',
  'writers',
].join(',');

function fields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}

/** Reads the independent issuer's report. The application and transaction still check the scope and controls. */
class AwsSignedStableCutCoverage {
  private readonly config: Configuration;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: Configuration,
    private readonly now: () => Date,
  ) {
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !/^\d{12}$/.test(config.bucketOwner) ||
      !profileIdValid(config.issuerId) ||
      !sourceHashValid(config.controlsHash) ||
      config.publicKey?.type !== 'public' ||
      config.publicKey.asymmetricKeyType !== 'ed25519' ||
      !Number.isSafeInteger(config.maxBytes) ||
      config.maxBytes < 1
    )
      throw new ConflictError(
        'The signed stable-cut coverage source is not configured',
      );
    this.config = Object.freeze({ ...config });
  }

  protected async readSignedCoverage(
    scope: CutScope,
    signatureProtocol: SignatureProtocol,
  ) {
    const {
      scopeHash,
      horizon,
      protocol: expectedProtocol,
      objectKey,
    } = stableCutCoverageSelection(structuredClone(scope));
    if (expectedProtocol !== signatureProtocol) throw invalid();
    const snapshot = await readVersionedS3Json(
      this.client,
      {
        Bucket: this.config.bucket,
        ExpectedBucketOwner: this.config.bucketOwner,
        Key: objectKey,
      },
      this.config.maxBytes,
      {
        invalid,
        unavailable: 'S3 could not read the signed stable-cut writer coverage',
      },
    );
    if (!snapshot) return null;
    const envelope = fields(snapshot.value);
    const { protocol, report: rawReport, signature } = envelope;
    if (
      Object.keys(envelope).sort().join(',') !== 'protocol,report,signature' ||
      protocol !== signatureProtocol ||
      typeof signature !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(signature)
    )
      throw invalid();
    const report = fields(
      rawReport,
    ) as unknown as LaterPeriodStableCutWriterCoverage;
    if (
      Object.keys(report).sort().join(',') !== reportFields ||
      report.issuerId !== this.config.issuerId ||
      report.scopeHash !== scopeHash ||
      report.controlsHash !== this.config.controlsHash ||
      !sourceHashValid(report.writerInventoryHash) ||
      !putDestinationWriterCoverageValid(report.copyEffects) ||
      !putDestinationWritersValid(report.writers)
    )
      throw invalid();
    const validFrom = historicalPutEvidenceTime(report.validFrom);
    const validUntil = historicalPutEvidenceTime(report.validUntil);
    const signedBytes = stableCutCoverageSignedBytes(signatureProtocol, report);
    const decoded = Buffer.from(signature, 'base64');
    if (
      decoded.toString('base64') !== signature ||
      !verify(null, signedBytes, this.config.publicKey, decoded)
    )
      throw invalid();
    const now = this.now().getTime();
    if (
      !Number.isSafeInteger(now) ||
      validFrom > now ||
      now > horizon ||
      validUntil <= horizon
    )
      throw invalid();
    return Object.freeze(report);
  }
}

export class AwsSignedItemStableCutCoverage extends AwsSignedStableCutCoverage {
  readCoverage(scope: ItemStableCutScope) {
    return this.readSignedCoverage(
      scope,
      ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    );
  }
}

export class AwsSignedLaterPeriodStableCutCoverage
  extends AwsSignedStableCutCoverage
  implements LaterPeriodStableCutWriterCoverageReader
{
  readCoverage(scope: LaterPeriodStableCutScope) {
    return this.readSignedCoverage(
      scope,
      LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    );
  }
}
