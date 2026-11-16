import { Injectable } from '@nestjs/common';
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { ObjectRevision, archiveHash } from '../../domain/ownership-archive';
import {
  ArchiveMaterializationIntent,
  OwnershipArchiveMaterializationStorage,
  assertMaterializationIntent,
} from '../../domain/ownership-archive-materialization';

@Injectable()
export class AwsOwnershipArchiveMaterializationStorage implements OwnershipArchiveMaterializationStorage {
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

  async materialize(
    intent: ArchiveMaterializationIntent,
  ): Promise<ObjectRevision> {
    assertMaterializationIntent(intent);
    const existing = await this.head(intent.destinationKey);
    if (existing) return this.verify(intent, existing);
    if (intent.source.size > 5 * 1024 * 1024 * 1024)
      throw new ConflictError(
        'Archive materialization above 5 GiB requires multipart copying',
      );
    const source = await this.head(intent.sourceKey, intent.source);
    if (
      !source ||
      archiveHash(this.revision(source)) !== archiveHash(intent.source)
    )
      throw new ConflictError(
        'The pinned archive staging revision is unavailable',
      );
    if (!source.ContentType)
      throw new ConflictError('Archive staging has no MIME type to preserve');
    if ((await this.digest(intent.sourceKey, intent.source)) !== intent.sha256)
      throw new ConflictError('Archive staging integrity verification failed');
    const encoded = [this.bucket, ...intent.sourceKey.split('/')]
      .map(encodeURIComponent)
      .join('/');
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: intent.destinationKey,
          CopySource: intent.source.versionId
            ? `${encoded}?versionId=${encodeURIComponent(intent.source.versionId)}`
            : encoded,
          CopySourceIfMatch: intent.source.etag,
          IfNoneMatch: '*',
          MetadataDirective: 'REPLACE',
          ContentType: source.ContentType,
          TaggingDirective: 'REPLACE',
          Tagging: '',
          ContentDisposition: source.ContentDisposition,
          ContentEncoding: source.ContentEncoding,
          ContentLanguage: source.ContentLanguage,
          CacheControl: source.CacheControl,
          Expires: source.Expires,
          Metadata: this.identity(intent),
        }),
      );
    } catch {
      // Error does not prove rollback; only reconcile a destination carrying THIS identity.
      const observed = await this.head(intent.destinationKey).catch(() => null);
      if (observed) return this.verify(intent, observed);
      throw new ExternalServiceError(
        'S3 could not confirm archive materialization; retry the same preparation',
      );
    }
    const copied = await this.head(intent.destinationKey);
    if (!copied)
      throw new ExternalServiceError(
        'The archive copy is not yet confirmed; retry the same preparation',
      );
    return this.verify(intent, copied);
  }

  private identity(
    intent: ArchiveMaterializationIntent,
  ): Record<string, string> {
    return {
      'ar-materialization-id': intent.definitionHash,
      'ar-archive-id': intent.archiveId,
      'ar-file-id': intent.fileId,
      'ar-sha256': intent.sha256,
    };
  }
  private async verify(
    intent: ArchiveMaterializationIntent,
    head: HeadObjectCommandOutput,
  ): Promise<ObjectRevision> {
    const revision = this.revision(head);
    if (
      revision.size !== intent.source.size ||
      Object.entries(this.identity(intent)).some(
        ([key, value]) => head.Metadata?.[key] !== value,
      )
    ) {
      throw new ConflictError(
        'The planned archive destination already has conflicting content or provenance',
      );
    }
    if ((await this.digest(intent.destinationKey, revision)) !== intent.sha256)
      throw new ConflictError('Archive final integrity verification failed');
    return revision;
  }
  private async head(
    key: string,
    revision?: ObjectRevision,
  ): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(revision
            ? { IfMatch: revision.etag, VersionId: revision.versionId }
            : {}),
        }),
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      const name = (error as { name?: string })?.name;
      if (
        status === 404 ||
        (status === undefined && ['NoSuchKey', 'NotFound'].includes(name ?? ''))
      )
        return null;
      throw new ExternalServiceError(
        'S3 could not inspect the archive materialization object',
      );
    }
  }
  private revision(head: HeadObjectCommandOutput): ObjectRevision {
    if (
      !head.ETag ||
      !Number.isSafeInteger(head.ContentLength) ||
      head.ContentLength! < 1
    )
      throw new ConflictError(
        'Archive materialization has no valid object revision',
      );
    return {
      etag: head.ETag,
      size: head.ContentLength!,
      versionId: head.VersionId,
    };
  }
  private async digest(key: string, revision: ObjectRevision): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        IfMatch: revision.etag,
        VersionId: revision.versionId,
      }),
    );
    if (!response.Body || !(Symbol.asyncIterator in response.Body))
      throw new ConflictError(
        'Archive materialization cannot be verified as a stream',
      );
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      hash.update(chunk);
    }
    if (size !== revision.size)
      throw new ConflictError('Archive materialization object size changed');
    return hash.digest('hex');
  }
}
