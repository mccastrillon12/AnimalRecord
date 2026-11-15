import type { S3Client } from '@aws-sdk/client-s3';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { createVersionedS3Json } from './create-versioned-s3-json';
import type {
  CutScope,
  StableCutWriterCoverageIssuer,
} from './signed-stable-cut-coverage';

type Configuration = Readonly<{
  bucket: string;
  bucketOwner: string;
  maxBytes: number;
}>;

const invalid = () =>
  new ConflictError('The published stable-cut writer coverage is inconsistent');
const unconfirmed =
  'The stable-cut writer coverage publication was not confirmed';

/** Explicit publication of the independent issuer's report. */
export class AwsStableCutWriterCoveragePublisher {
  private readonly config: Configuration;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: Configuration,
    private readonly issuer: StableCutWriterCoverageIssuer,
  ) {
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !/^\d{12}$/.test(config.bucketOwner) ||
      !Number.isSafeInteger(config.maxBytes) ||
      config.maxBytes < 1
    )
      throw new ConflictError(
        'The stable-cut coverage publisher is not configured',
      );
    this.config = Object.freeze({ ...config });
  }

  async publish(scope: CutScope) {
    const issued = await this.issuer.issue(scope);
    if (!issued) return null;
    const { objectKey, envelope } = issued;
    const body = Buffer.from(JSON.stringify(envelope));
    const location = {
      Bucket: this.config.bucket,
      ExpectedBucketOwner: this.config.bucketOwner,
      Key: objectKey,
    };

    const versionId = await createVersionedS3Json(
      this.client,
      location,
      body,
      this.config.maxBytes,
      { invalid, unavailable: unconfirmed },
    );
    return Object.freeze({ objectKey, versionId });
  }
}
