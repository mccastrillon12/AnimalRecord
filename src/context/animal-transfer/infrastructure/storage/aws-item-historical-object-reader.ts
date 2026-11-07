import {
  GetObjectCommand,
  GetObjectRetentionCommand,
  GetObjectRetentionCommandOutput,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { ObjectRevision } from '../../domain/ownership-archive';
import {
  HistoricalReadTarget,
  ItemHistoricalObjectReader,
  ItemSourceRetentionReader,
  ItemSourceRetentionTarget,
} from '../../domain/transfer-item-historical-observation';
import { isPinnedItemSourceVersion } from '../../domain/transfer-item-copy-intent';

type SourceRetentionBucket = Readonly<{
  bucket: string;
  expectedBucketOwner: string;
}>;
/** Explicit backend client, owned by the caller. No credentials/env/provider or write operations. */
export class AwsItemHistoricalObjectReader
  implements ItemHistoricalObjectReader, ItemSourceRetentionReader
{
  private readonly retentionBucket?: SourceRetentionBucket;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    retentionBucket?: SourceRetentionBucket,
  ) {
    if (retentionBucket)
      this.retentionBucket = Object.freeze({ ...retentionBucket });
  }
  async readSourceRetention(target: ItemSourceRetentionTarget) {
    const { bucket, key, versionId } = target;
    const scope = this.retentionBucket;
    if (
      !scope ||
      typeof bucket !== 'string' ||
      bucket !== scope.bucket ||
      bucket.trim() !== bucket ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      typeof scope.expectedBucketOwner !== 'string' ||
      scope.expectedBucketOwner.length !== 12 ||
      !/^[0-9]{12}$/.test(scope.expectedBucketOwner) ||
      typeof key !== 'string' ||
      !key ||
      /[\r\n\0]/.test(key) ||
      !isPinnedItemSourceVersion(versionId)
    )
      throw new ConflictError(
        'Source retention requires the configured bucket and an explicit object version',
      );
    const expectedBucketOwner = scope.expectedBucketOwner;
    let response: GetObjectRetentionCommandOutput;
    try {
      response = await this.client.send(
        new GetObjectRetentionCommand({
          Bucket: bucket,
          Key: key,
          VersionId: versionId,
          ExpectedBucketOwner: expectedBucketOwner,
        }),
      );
    } catch {
      throw new ExternalServiceError(
        'S3 could not read the source retention metadata',
      );
    }
    if (response?.$metadata?.httpStatusCode !== 200)
      throw new ExternalServiceError(
        'S3 could not read the source retention metadata',
      );
    const retention = response.Retention;
    if (
      retention?.Mode !== 'COMPLIANCE' ||
      !(retention.RetainUntilDate instanceof Date) ||
      !Number.isFinite(retention.RetainUntilDate.getTime())
    )
      throw new ConflictError(
        'The source version has no supported compliance retention observation',
      );
    return Object.freeze({
      expectedBucketOwner,
      mode: retention.Mode,
      reportedRetainUntil: retention.RetainUntilDate.toISOString(),
    });
  }
  async head(target: HistoricalReadTarget) {
    const { bucket, key } = target;
    try {
      const value = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (value.DeleteMarker) return null;
      return {
        bucket,
        key,
        etag: value.ETag,
        size: value.ContentLength,
        versionId: value.VersionId,
      };
    } catch (error) {
      if (this.status(error) === 404) return null;
      throw new ExternalServiceError(
        'S3 could not inspect the historical object',
      );
    }
  }
  async read(target: HistoricalReadTarget, revision: Readonly<ObjectRevision>) {
    const { bucket, key } = target;
    const fixed = { ...revision };
    try {
      const value = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          IfMatch: fixed.etag,
          VersionId: fixed.versionId,
        }),
      );
      const body = value.Body;
      if (!(body instanceof Readable))
        throw new ConflictError('The historical object is not a Node stream');
      if (value.DeleteMarker) {
        body.destroy();
        throw new ConflictError('The historical object is unavailable');
      }
      return {
        revision: {
          etag: value.ETag,
          size: value.ContentLength,
          versionId: value.VersionId,
        },
        body,
        close: () => {
          body.destroy();
        },
      };
    } catch (error) {
      if (
        error instanceof ConflictError ||
        [404, 412].includes(this.status(error) ?? 0)
      )
        throw new ConflictError(
          'The historical object changed during observation',
        );
      throw new ExternalServiceError('S3 could not read the historical object');
    }
  }
  private status(error: unknown): number | undefined {
    return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
  }
}
