import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import type { DirectCopyPlan } from '../../domain/direct-item-copy';
import type { ObjectRevision } from '../../domain/ownership-archive';
import { isPinnedItemSourceVersion } from '../../domain/transfer-item-copy-intent';

export class AwsDirectItemCopies {
  private readonly logger = new Logger(AwsDirectItemCopies.name);

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    readonly bucket: string,
    readonly expectedBucketOwner: string,
    readonly retainUntil: string,
  ) {}

  async readSource(key: string, revision: Readonly<ObjectRevision>) {
    if (!isPinnedItemSourceVersion(revision.versionId))
      throw new ConflictError('The transfer requires a versioned S3 object');
    const result = await this.client.send(
      new GetObjectCommand({
        ...this.target(key),
        VersionId: revision.versionId,
        IfMatch: revision.etag,
      }),
      { abortSignal: AbortSignal.timeout(60_000) },
    );
    try {
      if (
        result.VersionId !== revision.versionId ||
        result.ETag !== revision.etag ||
        result.ContentLength !== revision.size ||
        result.$metadata.httpStatusCode !== 200 ||
        !result.Body ||
        !(Symbol.asyncIterator in result.Body)
      )
        throw new ConflictError('The fixed S3 version could not be verified');
      let size = 0;
      const sha = createHash('sha256');
      for await (const bytes of result.Body as AsyncIterable<Uint8Array>) {
        size += bytes.byteLength;
        if (size > revision.size)
          throw new ConflictError('The fixed S3 size changed');
        sha.update(bytes);
      }
      if (size !== revision.size)
        throw new ConflictError('The fixed S3 read was incomplete');
      const {
        ContentType,
        ContentEncoding,
        ContentDisposition,
        ContentLanguage,
      } = result;
      return {
        sha256: sha.digest('hex'),
        properties: {
          ...(ContentType && { ContentType }),
          ...(ContentEncoding && { ContentEncoding }),
          ...(ContentDisposition && { ContentDisposition }),
          ...(ContentLanguage && { ContentLanguage }),
        },
      };
    } finally {
      if (result.Body && 'destroy' in result.Body) result.Body.destroy();
    }
  }

  async dispatch(plan: DirectCopyPlan) {
    this.assertTarget(plan);
    if (!(Date.parse(plan.retainUntil) > Date.now()))
      throw new ConflictError('The configured transfer retention has ended');
    const place = [this.bucket, ...plan.sourceKey.split('/')]
      .map(encodeURIComponent)
      .join('/');
    const {
      ContentType,
      ContentEncoding,
      ContentDisposition,
      ContentLanguage,
    } = plan.properties;
    try {
      await this.client.send(
        new CopyObjectCommand({
          ...this.target(plan.destinationKey),
          ExpectedSourceBucketOwner: this.expectedBucketOwner,
          CopySource: `${place}?versionId=${encodeURIComponent(plan.source.versionId!)}`,
          CopySourceIfMatch: plan.source.etag,
          IfNoneMatch: '*',
          ChecksumAlgorithm: 'SHA256',
          ObjectLockMode: 'COMPLIANCE',
          ObjectLockRetainUntilDate: new Date(plan.retainUntil),
          MetadataDirective: 'REPLACE',
          TaggingDirective: 'REPLACE',
          ContentType,
          ContentEncoding,
          ContentDisposition,
          ContentLanguage,
          CacheControl: 'private, no-store',
          Metadata: {
            'animalrecord-transfer-id': plan.id,
            'animalrecord-transfer-sha256': plan.sha256,
          },
        }),
      );
    } catch (error: unknown) {
      // Even on error the provider may have written the intended version.
      // Only observe it. The persisted permission cannot be dispatched again.
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      this.logger.warn({
        event: 'transfer-s3-copy-response-unconfirmed',
        status: typeof status === 'number' ? status : undefined,
      });
    }
  }

  async observe(plan: DirectCopyPlan) {
    this.assertTarget(plan);
    const head = await this.client
      .send(new HeadObjectCommand(this.target(plan.destinationKey)))
      .catch((error: unknown) => {
        if (
          (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode === 404
        )
          return null;
        throw error;
      });
    if (!head) return null;
    if (
      !isPinnedItemSourceVersion(head.VersionId) ||
      !head.ETag ||
      head.ContentLength !== plan.source.size ||
      head.$metadata.httpStatusCode !== 200 ||
      head.Metadata?.['animalrecord-transfer-id'] !== plan.id ||
      head.Metadata?.['animalrecord-transfer-sha256'] !== plan.sha256 ||
      head.ObjectLockMode !== 'COMPLIANCE' ||
      !(head.ObjectLockRetainUntilDate instanceof Date) ||
      !(
        head.ObjectLockRetainUntilDate.getTime() >= Date.parse(plan.retainUntil)
      )
    )
      throw new ConflictError(
        'The S3 destination does not match its saved copy intent',
      );
    const revision = {
      versionId: head.VersionId,
      etag: head.ETag,
      size: head.ContentLength,
    };
    if (
      (await this.readSource(plan.destinationKey, revision)).sha256 !==
      plan.sha256
    )
      throw new ConflictError(
        'The direct S3 copy content differs from its source',
      );
    return {
      revision,
      retainUntil: head.ObjectLockRetainUntilDate.toISOString(),
    };
  }

  private assertTarget(plan: DirectCopyPlan) {
    if (
      plan.bucket !== this.bucket ||
      plan.expectedBucketOwner !== this.expectedBucketOwner
    )
      throw new ConflictError(
        'The persisted copy belongs to another S3 target',
      );
  }

  private target(key: string) {
    return {
      Bucket: this.bucket,
      Key: key,
      ExpectedBucketOwner: this.expectedBucketOwner,
    };
  }
}
