import {
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { isPinnedItemSourceVersion } from '../../domain/transfer-item-copy-intent';
import { readVersionedS3Json } from './read-versioned-s3-json';

/** Creates an immutable document or confirms an identical current version after an uncertain write. */
export async function createVersionedS3Json(
  client: Pick<S3Client, 'send'>,
  location: Required<
    Pick<PutObjectCommandInput, 'Bucket' | 'ExpectedBucketOwner' | 'Key'>
  >,
  body: Buffer,
  maxBytes: number,
  errors: Readonly<{ invalid: () => Error; unavailable: string }>,
) {
  if (body.length > maxBytes) throw errors.invalid();

  try {
    const response = await client.send(
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
      return response.VersionId;
  } catch {
    // A failed response can accompany an existing write. Check the stored document below.
  }

  const stored = await readVersionedS3Json(client, location, maxBytes, errors);
  if (!stored) throw new ExternalServiceError(errors.unavailable);
  const sent: unknown = JSON.parse(body.toString('utf8'));
  if (!isDeepStrictEqual(stored.value, sent)) throw errors.invalid();
  return stored.versionId;
}
