import {
  GetObjectCommand,
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
} from '../../domain/transfer-item-historical-observation';

/** Explicit backend client, owned by the caller. No credentials/env/provider or write operations. */
export class AwsItemHistoricalObjectReader implements ItemHistoricalObjectReader {
  constructor(private readonly client: Pick<S3Client, 'send'>) {}
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
