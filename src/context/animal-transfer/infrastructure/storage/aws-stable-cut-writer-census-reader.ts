import type { S3Client } from '@aws-sdk/client-s3';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import {
  captureStableCutWriterCensus,
  type StableCutWriterCensusReader,
} from '../../application/stable-cut-writer-census';
import {
  stableCutScopeBinding,
  type CutScope,
} from '../../application/stable-cut-writer-evidence';
import { archiveHash } from '../../domain/ownership-archive';
import { sourceHashValid } from '../../domain/transfer-item-historical-observation';
import { evidenceArchiveConfig } from './aws-stable-cut-operational-evidence-source';
import { readVersionedS3Json } from './read-versioned-s3-json';

type Configuration = Readonly<{
  evidenceBucket: string;
  evidenceBucketOwner: string;
  maxBytes: number;
  censusHash: string;
}>;

const invalid = () =>
  new ConflictError('The archived stable-cut writer census is inconsistent');

export function capturePinnedStableCutWriterCensus(
  value: unknown,
  scopeHash: string,
  controlsHash: string,
  censusHash: string,
) {
  const census = captureStableCutWriterCensus(value);
  if (
    census.scopeHash !== scopeHash ||
    census.controlsHash !== controlsHash ||
    archiveHash(census) !== censusHash
  )
    throw invalid();
  return census;
}

/** Reads only the census pinned by the authority for this operation. */
export class AwsStableCutWriterCensusReader implements StableCutWriterCensusReader {
  private readonly config: Configuration;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: Configuration,
  ) {
    if (!sourceHashValid(config.censusHash)) throw invalid();
    this.config = evidenceArchiveConfig(config);
  }

  async readCensus(scope: CutScope, controlsHash: string) {
    const { scopeHash } = stableCutScopeBinding(scope, invalid);
    if (!sourceHashValid(controlsHash)) throw invalid();
    const { censusHash, evidenceBucket, evidenceBucketOwner, maxBytes } =
      this.config;
    const snapshot = await readVersionedS3Json(
      this.client,
      {
        Bucket: evidenceBucket,
        ExpectedBucketOwner: evidenceBucketOwner,
        Key: `stable-cut-writer-census/v1/${scopeHash}/${controlsHash}/${censusHash}.json`,
      },
      maxBytes,
      {
        invalid,
        unavailable: 'S3 could not read the stable-cut writer census',
      },
    );
    return snapshot
      ? capturePinnedStableCutWriterCensus(
          snapshot.value,
          scopeHash,
          controlsHash,
          censusHash,
        )
      : null;
  }
}
