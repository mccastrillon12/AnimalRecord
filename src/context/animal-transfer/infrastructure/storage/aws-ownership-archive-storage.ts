import { Injectable } from '@nestjs/common';
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';
import { AwsS3StorageService } from '../../../shared/infrastructure/storage/aws-s3-storage.service';
import {
  ArchiveFile,
  ObjectRevision,
  OwnershipArchiveStorage,
  VerifiedArchiveCopies,
} from '../../domain/ownership-archive';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';

@Injectable()
export class AwsOwnershipArchiveStorage implements OwnershipArchiveStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    config: EnvironmentConfigService,
    private readonly urlStorage: AwsS3StorageService,
  ) {
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

  keyFromUrl(url: string): string | undefined {
    return this.urlStorage.getFileKey(url);
  }

  async inspect(key: string): Promise<ObjectRevision> {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (
      !head.ETag ||
      head.ContentLength === undefined ||
      head.ContentLength < 1
    )
      throw new ConflictError('The source object cannot be archived');
    return {
      etag: head.ETag,
      size: head.ContentLength,
      versionId: head.VersionId,
    };
  }

  async copyAndVerify(file: ArchiveFile): Promise<VerifiedArchiveCopies> {
    if (file.source.size > 5 * 1024 * 1024 * 1024)
      throw new ConflictError(
        'Archive objects above 5 GiB require multipart copying',
      );
    const expectedDigest = await this.digest(file.sourceKey, file.source);
    const historical = await this.copy(
      file.sourceKey,
      file.source,
      file.historicalKey,
    );
    if ((await this.digest(file.historicalKey, historical)) !== expectedDigest)
      throw new ConflictError('Historical copy integrity verification failed');
    const recipientStaging = await this.copy(
      file.historicalKey,
      historical,
      file.recipientStagingKey,
    );
    if (
      (await this.digest(file.recipientStagingKey, recipientStaging)) !==
      expectedDigest
    )
      throw new ConflictError('Recipient copy integrity verification failed');
    return { sha256: expectedDigest, historical, recipientStaging };
  }

  private async copy(
    sourceKey: string,
    revision: ObjectRevision,
    destinationKey: string,
  ): Promise<ObjectRevision> {
    const encoded = [this.bucket, ...sourceKey.split('/')]
      .map(encodeURIComponent)
      .join('/');
    const copySource = revision.versionId
      ? `${encoded}?versionId=${encodeURIComponent(revision.versionId)}`
      : encoded;
    const result = await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destinationKey,
        CopySource: copySource,
        CopySourceIfMatch: revision.etag,
      }),
    );
    const etag = result.CopyObjectResult?.ETag;
    if (!etag) throw new ConflictError('S3 did not confirm the archive copy');
    return { etag, size: revision.size, versionId: result.VersionId };
  }

  private async digest(key: string, revision: ObjectRevision): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        VersionId: revision.versionId,
        IfMatch: revision.etag,
      }),
    );
    if (!response.Body || !(Symbol.asyncIterator in response.Body))
      throw new ConflictError(
        'The archived object could not be read as a stream',
      );
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      hash.update(chunk);
    }
    if (size !== revision.size)
      throw new ConflictError('The archived object size changed');
    return hash.digest('hex');
  }
}
