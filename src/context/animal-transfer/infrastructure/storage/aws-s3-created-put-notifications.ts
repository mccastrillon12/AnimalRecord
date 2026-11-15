import {
  GetObjectCommand,
  NoSuchKey,
  type GetObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../../domain/ownership-archive';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from '../../domain/transfer-item-copy-intent';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';
import type { S3CreatedPutNotifications } from './aws-later-period-live-put-audit-reader';

type Target = Parameters<S3CreatedPutNotifications['readCreatedPuts']>[0];
type CreatedPut = Awaited<
  ReturnType<S3CreatedPutNotifications['readCreatedPuts']>
>[number];
type Config = Readonly<{
  auditBucket: string;
  auditBucketOwner: string;
  sourceBucket: string;
  sourceBucketOwner: string;
  sourceRegion: string;
  notificationConfigurationId: string;
  maxBytes: number;
}>;

const invalid = () =>
  new ConflictError('The archived S3 PUT notifications are inconsistent');

export function s3CreatedPutNotificationsKey(target: Target) {
  const { bucket, expectedBucketOwner, key } = target;
  return `put-notifications/v1/${archiveHash({ bucket, expectedBucketOwner, key })}.json`;
}

function fields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}

function parseNotification(
  value: unknown,
  target: Target,
  config: Config,
): CreatedPut {
  const event = fields(value);
  const s3 = fields(event.s3);
  const bucket = fields(s3.bucket);
  const object = fields(s3.object);
  const requestId = fields(event.responseElements)['x-amz-request-id'];
  if (
    typeof event.eventVersion !== 'string' ||
    !/^2\.[1-9][0-9]*$/.test(event.eventVersion) ||
    event.eventSource !== 'aws:s3' ||
    event.eventName !== 'ObjectCreated:Put' ||
    event.awsRegion !== config.sourceRegion ||
    typeof event.eventTime !== 'string' ||
    s3.s3SchemaVersion !== '1.0' ||
    s3.configurationId !== config.notificationConfigurationId ||
    bucket.name !== target.bucket ||
    bucket.arn !== `arn:aws:s3:::${target.bucket}` ||
    typeof object.key !== 'string' ||
    decodeURIComponent(object.key.replace(/\+/g, ' ')) !== target.key ||
    typeof object.eTag !== 'string' ||
    !/^[\x21-\x7e]+$/.test(object.eTag) ||
    /[",\\]/.test(object.eTag) ||
    !isPinnedItemSourceVersion(object.versionId) ||
    typeof object.size !== 'number' ||
    typeof requestId !== 'string' ||
    !/^[A-Za-z0-9-]{1,128}$/.test(requestId)
  )
    throw invalid();
  const occurredAt = event.eventTime.replace(
    /(\d{2}:\d{2}:\d{2})Z$/,
    '$1.000Z',
  );
  historicalPutEvidenceTime(occurredAt);
  const revision = captureItemObjectRevision({
    versionId: object.versionId,
    etag: `"${object.eTag}"`,
    size: object.size,
  });
  return Object.freeze({
    target,
    event: 'ObjectCreated:Put',
    requestId,
    occurredAt,
    revision,
  });
}

/** Read-only client for a dedicated, versioned archive written by a trusted collector. */
export class AwsS3CreatedPutNotifications implements S3CreatedPutNotifications {
  private readonly config: Config;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: Config,
  ) {
    if (
      ![config.auditBucket, config.sourceBucket].every((name) =>
        /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name),
      ) ||
      config.auditBucket === config.sourceBucket ||
      ![config.auditBucketOwner, config.sourceBucketOwner].every((owner) =>
        /^\d{12}$/.test(owner),
      ) ||
      !/^(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-\d+$/.test(config.sourceRegion) ||
      typeof config.notificationConfigurationId !== 'string' ||
      !config.notificationConfigurationId.trim() ||
      !Number.isSafeInteger(config.maxBytes) ||
      config.maxBytes < 1
    )
      throw new ConflictError(
        'The S3 PUT notification archive is not configured',
      );
    this.config = Object.freeze({ ...config });
  }

  async readCreatedPuts(raw: Target): Promise<readonly CreatedPut[]> {
    const { bucket, key, expectedBucketOwner } = raw;
    const config = this.config;
    if (
      bucket !== config.sourceBucket ||
      expectedBucketOwner !== config.sourceBucketOwner ||
      typeof key !== 'string' ||
      !key ||
      Buffer.byteLength(key) > 1024
    )
      throw invalid();
    const target = Object.freeze({ bucket, key, expectedBucketOwner });
    let response: GetObjectCommandOutput;
    try {
      response = await this.client.send(
        new GetObjectCommand({
          Bucket: config.auditBucket,
          ExpectedBucketOwner: config.auditBucketOwner,
          Key: s3CreatedPutNotificationsKey(target),
        }),
      );
    } catch (error) {
      if (error instanceof NoSuchKey && error.$metadata.httpStatusCode === 404)
        return [];
      throw new ExternalServiceError(
        'S3 could not read the PUT notification archive',
      );
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
        length > config.maxBytes
      )
        throw invalid();
      const chunks: Buffer[] = [];
      let remaining = length;
      for await (const chunk of body as AsyncIterable<unknown>) {
        if (!Buffer.isBuffer(chunk) || chunk.length > remaining)
          throw invalid();
        chunks.push(chunk);
        remaining -= chunk.length;
      }
      if (remaining !== 0) throw invalid();
      const json: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks, length),
        ),
      );
      const { sourceBucketOwner, Records } = fields(json);
      if (
        sourceBucketOwner !== config.sourceBucketOwner ||
        !Array.isArray(Records)
      )
        throw invalid();
      return Object.freeze(
        Records.map((record: unknown) =>
          parseNotification(record, target, config),
        ),
      );
    } catch {
      throw invalid();
    } finally {
      if (body instanceof Readable) body.destroy();
    }
  }
}
