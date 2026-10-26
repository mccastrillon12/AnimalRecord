import { Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../../domain/ownership-archive';
import {
  ArchiveS3ObservationItem,
  ArchiveS3ObservationReceipt,
  OwnershipArchiveS3ObservationStorage,
  assertS3ObservationItem,
} from '../../domain/ownership-archive-s3-observation';

/** Read-only adapter by construction. No copying, repair, listing, deletion or source fallback. */
@Injectable()
export class AwsOwnershipArchiveS3ObservationStorage implements OwnershipArchiveS3ObservationStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(config: EnvironmentConfigService) {
    this.bucket = config.getAwsS3BucketName();
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    this.client = new S3Client({
      region: config.getAwsS3Region(),
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
              sessionToken: process.env.AWS_SESSION_TOKEN,
            }
          : undefined,
    });
  }
  async observe(
    item: ArchiveS3ObservationItem,
  ): Promise<ArchiveS3ObservationReceipt> {
    assertS3ObservationItem(item);
    this.assertHead(item, await this.head(item.intent.destinationKey));
    const response = await this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: item.intent.destinationKey,
          IfMatch: item.revision.etag,
          VersionId: item.revision.versionId,
        }),
      )
      .catch(() => {
        throw new ExternalServiceError(
          'S3 could not read the pinned archive final object',
        );
      });
    if (!response.Body || !(Symbol.asyncIterator in response.Body))
      throw new ConflictError(
        'The archive final object cannot be observed as a stream',
      );
    const digest = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > item.revision.size)
          throw new ConflictError(
            'Archive S3 observation size differs from prepared evidence',
          );
        digest.update(chunk);
      }
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      throw new ExternalServiceError(
        'S3 could not finish reading the archive final object',
      );
    }
    if (
      size !== item.revision.size ||
      digest.digest('hex') !== item.intent.sha256
    )
      throw new ConflictError(
        'Archive S3 observation integrity differs from prepared evidence',
      );
    this.assertHead(item, response);
    // Re-check the CURRENT object, not just a surviving historical VersionId.
    this.assertHead(item, await this.head(item.intent.destinationKey));
    return {
      fileId: item.fileId,
      revision: { ...item.revision },
      sha256: item.intent.sha256,
    };
  }
  private async head(key: string): Promise<HeadObjectCommandOutput> {
    try {
      return await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      const name = (error as { name?: string })?.name;
      if (
        status === 404 ||
        (status === undefined && ['NotFound', 'NoSuchKey'].includes(name ?? ''))
      )
        throw new ConflictError(
          'The prepared archive final object is currently unavailable',
        );
      throw new ExternalServiceError(
        'S3 could not inspect the archive final object',
      );
    }
  }
  private assertHead(
    item: ArchiveS3ObservationItem,
    head: HeadObjectCommandOutput,
  ) {
    const expectedMetadata = {
      'ar-materialization-id': item.intent.definitionHash,
      'ar-archive-id': item.intent.archiveId,
      'ar-file-id': item.fileId,
      'ar-sha256': item.intent.sha256,
    };
    if (
      head.DeleteMarker ||
      archiveHash({
        etag: head.ETag,
        size: head.ContentLength,
        versionId: head.VersionId,
      }) !== archiveHash(item.revision) ||
      Object.entries(expectedMetadata).some(
        ([key, value]) => head.Metadata?.[key] !== value,
      )
    )
      throw new ConflictError(
        'The current S3 object revision or provenance differs from prepared evidence',
      );
  }
}
