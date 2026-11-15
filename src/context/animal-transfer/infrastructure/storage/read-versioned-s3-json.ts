import {
  GetObjectCommand,
  NoSuchKey,
  type GetObjectCommandInput,
  type GetObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { isPinnedItemSourceVersion } from '../../domain/transfer-item-copy-intent';

/** Loads a bounded JSON document from an explicit bucket owner, using one complete version. */
export async function readVersionedS3Json(
  client: Pick<S3Client, 'send'>,
  input: Required<
    Pick<GetObjectCommandInput, 'Bucket' | 'ExpectedBucketOwner' | 'Key'>
  >,
  maxBytes: number,
  errors: Readonly<{ invalid: () => Error; unavailable: string }>,
) {
  let response: GetObjectCommandOutput;
  try {
    response = await client.send(new GetObjectCommand(input));
  } catch (error) {
    if (error instanceof NoSuchKey && error.$metadata.httpStatusCode === 404)
      return null;
    throw new ExternalServiceError(errors.unavailable);
  }

  const body = response?.Body;
  try {
    const length = response?.ContentLength;
    if (
      !(body instanceof Readable) ||
      response.$metadata?.httpStatusCode !== 200 ||
      !isPinnedItemSourceVersion(response.VersionId) ||
      response.ContentRange !== undefined ||
      response.PartsCount !== undefined ||
      response.DeleteMarker ||
      (response.ContentEncoding !== undefined &&
        response.ContentEncoding !== 'identity') ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > maxBytes
    )
      throw errors.invalid();
    const chunks: Buffer[] = [];
    let remaining = length;
    for await (const chunk of body as AsyncIterable<unknown>) {
      if (!Buffer.isBuffer(chunk) || chunk.length > remaining)
        throw errors.invalid();
      chunks.push(chunk);
      remaining -= chunk.length;
    }
    if (remaining !== 0) throw errors.invalid();
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, length),
      ),
    );
    return { value, etag: response.ETag, versionId: response.VersionId };
  } catch {
    throw errors.invalid();
  } finally {
    if (body instanceof Readable) body.destroy();
  }
}
