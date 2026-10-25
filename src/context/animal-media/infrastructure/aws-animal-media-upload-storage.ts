import { Injectable } from '@nestjs/common';
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import {
  AnimalMediaUpload,
  AnimalMediaUploadStorage,
  MediaRevision,
  PinnedMedia,
} from '../domain/animal-media-upload';
import { EnvironmentConfigService } from '../../shared/infrastructure/config/environment/environment.service';
import { AwsS3StorageService } from '../../shared/infrastructure/storage/aws-s3-storage.service';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../shared/domain/errors/ExternalServiceError';

@Injectable()
export class AwsAnimalMediaUploadStorage implements AnimalMediaUploadStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly origin: string;

  constructor(
    config: EnvironmentConfigService,
    private readonly urls: AwsS3StorageService,
  ) {
    this.bucket = config.getAwsS3BucketName();
    this.origin = `https://${this.bucket}.s3.${config.getAwsS3Region()}.amazonaws.com`;
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
    return this.urls.getFileKey(url);
  }
  urlForKey(key: string): string {
    return `${this.origin}/${key}`;
  }
  async signStaging(upload: AnimalMediaUpload): Promise<string> {
    return (
      await this.urls.generatePreSignedUploadUrl(
        upload.stagingKey,
        upload.mimeType,
        upload.size,
      )
    ).uploadUrl;
  }

  async pinSource(upload: AnimalMediaUpload): Promise<PinnedMedia> {
    const head = await this.head(upload.stagingKey);
    if (!head)
      throw new ConflictError('The uploaded file is not available yet');
    const revision = this.revision(head);
    if (revision.size !== upload.size || head.ContentType !== upload.mimeType)
      throw new ConflictError(
        'The uploaded file size or MIME does not match the issued URL',
      );
    return {
      ...revision,
      sha256: await this.digest(upload.stagingKey, revision),
    };
  }

  async promote(upload: AnimalMediaUpload): Promise<MediaRevision> {
    if (!upload.pinned)
      throw new ConflictError('The upload has no pinned source revision');
    if (upload.sealed) return this.verifyFinal(upload);
    if (await this.head(upload.finalKey)) return this.verifyFinal(upload);
    if (upload.size > 5 * 1024 * 1024 * 1024)
      throw new ConflictError(
        'Uploads above 5 GiB require multipart promotion',
      );
    const source = [this.bucket, ...upload.stagingKey.split('/')]
      .map(encodeURIComponent)
      .join('/');
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: upload.finalKey,
          CopySource: upload.pinned.versionId
            ? `${source}?versionId=${encodeURIComponent(upload.pinned.versionId)}`
            : source,
          CopySourceIfMatch: upload.pinned.etag,
          IfNoneMatch: '*',
          MetadataDirective: 'REPLACE',
          ContentType: upload.mimeType,
          Metadata: {
            'animal-upload-id': upload.id,
            'animal-upload-sha256': upload.pinned.sha256,
          },
        }),
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 409 || status === 412) {
        if (await this.head(upload.finalKey)) return this.verifyFinal(upload);
        throw new ConflictError(
          'The staged upload changed; request a new upload URL',
        );
      }
      // Outcome may be unknown: retry reconciles the destination; never overwrite it.
      throw new ExternalServiceError(
        'S3 could not confirm the upload copy; retry the same confirmation',
      );
    }
    return this.verifyFinal(upload);
  }

  async verifyFinal(upload: AnimalMediaUpload): Promise<MediaRevision> {
    const head = await this.head(upload.finalKey);
    if (!head || !upload.pinned)
      throw new ConflictError(
        'The confirmed upload is unavailable; request a new upload URL',
      );
    const revision = this.revision(head);
    if (
      head.Metadata?.['animal-upload-id'] !== upload.id ||
      head.Metadata?.['animal-upload-sha256'] !== upload.pinned.sha256 ||
      revision.size !== upload.size ||
      head.ContentType !== upload.mimeType ||
      (upload.sealed &&
        (upload.sealed.etag !== revision.etag ||
          upload.sealed.versionId !== revision.versionId))
    ) {
      throw new ConflictError(
        'The upload destination has conflicting content or provenance',
      );
    }
    if ((await this.digest(upload.finalKey, revision)) !== upload.pinned.sha256)
      throw new ConflictError(
        'The confirmed upload integrity verification failed',
      );
    return revision;
  }

  private async head(key: string): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
          ?.httpStatusCode === 404 ||
        ['NoSuchKey', 'NotFound'].includes(
          (error as { name?: string })?.name ?? '',
        )
      )
        return null;
      throw new ExternalServiceError('S3 could not inspect the animal upload');
    }
  }

  private revision(head: HeadObjectCommandOutput): MediaRevision {
    if (
      !head.ETag ||
      !Number.isSafeInteger(head.ContentLength) ||
      head.ContentLength! < 1
    )
      throw new ConflictError('The upload object has no valid revision');
    return {
      etag: head.ETag,
      size: head.ContentLength!,
      versionId: head.VersionId,
    };
  }

  private async digest(key: string, revision: MediaRevision): Promise<string> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          IfMatch: revision.etag,
          VersionId: revision.versionId,
        }),
      );
      if (!response.Body || !(Symbol.asyncIterator in response.Body))
        throw new ConflictError('The upload could not be verified as a stream');
      let size = 0;
      const hash = createHash('sha256');
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        hash.update(chunk);
      }
      if (size !== revision.size)
        throw new ConflictError(
          'The upload byte count changed during verification',
        );
      return hash.digest('hex');
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      if (
        (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
          ?.httpStatusCode === 412
      )
        throw new ConflictError(
          'The staged upload changed; request a new upload URL',
        );
      throw new ExternalServiceError('S3 could not verify the animal upload');
    }
  }
}
