import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { isPinnedItemSourceVersion } from '../../domain/transfer-item-copy-intent';
import { readVersionedS3Json } from './read-versioned-s3-json';
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
    if (body.length > this.config.maxBytes) throw invalid();
    const location = {
      Bucket: this.config.bucket,
      ExpectedBucketOwner: this.config.bucketOwner,
      Key: objectKey,
    };

    // The conditional write also makes transport retries safe for the current object.
    try {
      const response = await this.client.send(
        new PutObjectCommand({
          ...location,
          IfNoneMatch: '*',
          Body: body,
          ContentLength: body.length,
          ContentType: 'application/json',
          ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
        }),
      );
      if (
        response?.$metadata?.httpStatusCode === 200 &&
        isPinnedItemSourceVersion(response.VersionId)
      )
        return Object.freeze({ objectKey, versionId: response.VersionId });
    } catch {
      // A failed response can accompany an existing write. Check the stored envelope below.
    }

    const stored = await readVersionedS3Json(
      this.client,
      location,
      this.config.maxBytes,
      { invalid, unavailable: unconfirmed },
    );
    if (!stored) throw new ExternalServiceError(unconfirmed);
    const sent: unknown = JSON.parse(body.toString('utf8'));
    if (!isDeepStrictEqual(stored.value, sent)) throw invalid();
    return Object.freeze({ objectKey, versionId: stored.versionId });
  }
}
