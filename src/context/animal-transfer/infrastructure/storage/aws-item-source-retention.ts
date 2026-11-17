import {
  HeadObjectCommand,
  PutObjectRetentionCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import type { InitialCopyDispatchPreparation } from '../../application/initial-item-copy-execution';
import { isPinnedItemSourceVersion } from '../../domain/transfer-item-copy-intent';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';

/** Writes retention for an exact live-source revision selected by the sealed manifest. */
export class AwsItemSourceRetention {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly configuration: Readonly<{
      bucket: string;
      expectedBucketOwner: string;
      retainUntil: string;
    }>,
    private readonly now: () => Date,
  ) {}

  readonly retainSource: NonNullable<
    InitialCopyDispatchPreparation['retainSource']
  > = async ({ key, revision: { versionId, etag, size } }, requiredThrough) => {
    const { bucket, expectedBucketOwner, retainUntil } = this.configuration;
    const horizon = historicalPutEvidenceTime(requiredThrough);
    const deadline = historicalPutEvidenceTime(retainUntil);
    const checkedAt = this.now().getTime();
    if (!isPinnedItemSourceVersion(versionId))
      throw new ConflictError(
        'Automatic source retention requires an explicit object version',
      );
    if (!(checkedAt <= horizon && horizon < deadline))
      throw new ConflictError(
        'The source retention date does not cover the required horizon',
      );

    const target = {
      Bucket: bucket,
      Key: key,
      VersionId: versionId,
      ExpectedBucketOwner: expectedBucketOwner,
    };
    const inspect = async () => {
      const seen = await this.client.send(
        new HeadObjectCommand({ ...target, IfMatch: etag }),
      );
      if (
        seen.$metadata?.httpStatusCode !== 200 ||
        seen.DeleteMarker ||
        seen.VersionId !== versionId ||
        seen.ETag !== etag ||
        seen.ContentLength !== size
      )
        throw new ConflictError(
          'The source revision changed before retention could be confirmed',
        );
      return seen;
    };
    const sufficient = ({
      ObjectLockMode,
      ObjectLockRetainUntilDate,
    }: Awaited<ReturnType<typeof inspect>>) =>
      ObjectLockMode === 'COMPLIANCE' &&
      ObjectLockRetainUntilDate instanceof Date &&
      ObjectLockRetainUntilDate.getTime() >
        Math.max(horizon, this.now().getTime());
    const original = await inspect();
    if (sufficient(original)) return;
    if (
      original.ObjectLockMode === 'GOVERNANCE' ||
      (original.ObjectLockMode !== undefined &&
        original.ObjectLockMode !== 'COMPLIANCE') ||
      (original.ObjectLockMode === 'COMPLIANCE') !==
        original.ObjectLockRetainUntilDate instanceof Date ||
      (original.ObjectLockRetainUntilDate &&
        !Number.isFinite(original.ObjectLockRetainUntilDate.getTime()))
    )
      throw new ConflictError(
        'The source has incompatible or incomplete retention metadata',
      );

    try {
      await this.client.send(
        new PutObjectRetentionCommand({
          ...target,
          ChecksumAlgorithm: 'SHA256',
          Retention: {
            Mode: 'COMPLIANCE',
            RetainUntilDate: new Date(deadline),
          },
        }),
      );
    } catch {
      // The provider may have applied retention before losing the response.
    }
    if (!sufficient(await inspect()))
      throw new ExternalServiceError(
        'S3 did not confirm retention for the original source version',
      );
  };
}
