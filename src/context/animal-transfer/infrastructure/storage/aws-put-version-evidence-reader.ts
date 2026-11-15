import type { S3Client } from '@aws-sdk/client-s3';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { archiveHash } from '../../domain/ownership-archive';
import {
  profileIdValid,
  sourceHashValid,
} from '../../domain/transfer-item-historical-observation';
import {
  matchPutVersionEvidence,
  type ItemHistoricalPutVersionScope,
  type PutVersionEvidence,
} from '../../domain/transfer-item-historical-put-reconciliation';
import { readVersionedS3Json } from './read-versioned-s3-json';

type EvidenceProtocol = PutVersionEvidence['protocol'];
const protocols: readonly EvidenceProtocol[] = [
  'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1',
  'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1',
  'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1',
  'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1',
  'PUBLISHED_HISTORY_STAGING_PUT_VERSION_EVIDENCE_V1',
  'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1',
];

type Configuration = Readonly<{
  bucket: string;
  bucketOwner: string;
  issuerId: string;
  maxBytes: number;
}>;

const invalid = () =>
  new ConflictError('The archived PUT version evidence is inconsistent');

/** Reads evidence from the independent producer's archive using the caller's exact scope and hash. */
export class AwsPutVersionEvidenceReader<Protocol extends EvidenceProtocol> {
  private readonly config: Configuration;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: Configuration,
    private readonly protocol: Protocol,
  ) {
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !/^\d{12}$/.test(config.bucketOwner) ||
      !profileIdValid(config.issuerId) ||
      !Number.isSafeInteger(config.maxBytes) ||
      config.maxBytes < 1 ||
      !protocols.includes(protocol)
    )
      throw new ConflictError(
        'The PUT version evidence archive is not configured',
      );
    this.config = Object.freeze({ ...config });
  }

  async readVersionEvidence(
    raw: ItemHistoricalPutVersionScope,
    expectedEvidenceHash: string,
  ) {
    const scope = structuredClone(raw);
    if (
      !sourceHashValid(expectedEvidenceHash) ||
      !sourceHashValid(scope?.permissionHash) ||
      !(
        sourceHashValid(scope.authorizationId) ||
        profileIdValid(scope.authorizationId)
      ) ||
      !sourceHashValid(scope.sha256) ||
      !Number.isSafeInteger(scope.size) ||
      scope.size < 1 ||
      typeof scope.target?.bucket !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(scope.target.bucket) ||
      typeof scope.target.expectedBucketOwner !== 'string' ||
      !/^\d{12}$/.test(scope.target.expectedBucketOwner) ||
      typeof scope.target.key !== 'string' ||
      !scope.target.key
    )
      throw invalid();
    const scopeHash = archiveHash(scope);
    const snapshot = await readVersionedS3Json(
      this.client,
      {
        Bucket: this.config.bucket,
        ExpectedBucketOwner: this.config.bucketOwner,
        Key: `put-version-evidence/v1/${this.protocol}/${scopeHash}/${expectedEvidenceHash}.json`,
      },
      this.config.maxBytes,
      {
        invalid,
        unavailable: 'S3 could not read the PUT version evidence archive',
      },
    );
    if (!snapshot) return null;

    const evidence = matchPutVersionEvidence(
      scope,
      snapshot.value,
      expectedEvidenceHash,
      this.protocol,
    );
    if (evidence.issuerId !== this.config.issuerId) throw invalid();
    return evidence;
  }

  readStagingVersionEvidence(
    scope: ItemHistoricalPutVersionScope,
    expectedEvidenceHash: string,
  ) {
    return this.readVersionEvidence(scope, expectedEvidenceHash);
  }

  readRecipientFinalVersionEvidence(
    scope: ItemHistoricalPutVersionScope,
    expectedEvidenceHash: string,
  ) {
    return this.readVersionEvidence(scope, expectedEvidenceHash);
  }
}
