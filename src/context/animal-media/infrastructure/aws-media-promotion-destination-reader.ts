import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { MediaRevision } from '../domain/animal-media-upload';
import { MediaPromotionDefinition } from '../domain/media-promotion-effect';
import { MediaPromotionDestinationReader } from '../domain/media-promotion-sealing';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';

/** Read-only adapter; explicitly supplied client, no environment/Nest bootstrap. */
export class AwsMediaPromotionDestinationReader implements MediaPromotionDestinationReader {
  constructor(private readonly client: Pick<S3Client, 'send'>) {}

  async head(definition: MediaPromotionDefinition) {
    const { bucket, destinationKey: key } = definition;
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        bucket,
        key,
        etag: head.ETag,
        size: head.ContentLength,
        versionId: head.VersionId,
        mimeType: head.ContentType,
        uploadId: head.Metadata?.['animal-upload-id'],
        sha256: head.Metadata?.['animal-upload-sha256'],
      };
    } catch (error) {
      if (this.status(error) === 404) return null;
      throw new ExternalServiceError(
        'S3 could not inspect the promotion destination',
      );
    }
  }

  async read(definition: MediaPromotionDefinition, revision: MediaRevision) {
    const { bucket, destinationKey: key } = definition;
    const fixed = { ...revision };
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          IfMatch: fixed.etag,
          VersionId: fixed.versionId,
        }),
      );
      const body = response.Body;
      if (!(body instanceof Readable))
        throw new ConflictError(
          'The promotion destination is not a Node stream',
        );
      return {
        revision: {
          etag: response.ETag,
          size: response.ContentLength,
          versionId: response.VersionId,
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
          'The promotion destination changed during verification',
        );
      throw new ExternalServiceError(
        'S3 could not read the promotion destination',
      );
    }
  }
  private status(error: unknown): number | undefined {
    return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
  }
}
