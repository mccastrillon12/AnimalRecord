import {
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../../domain/ownership-archive';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from '../../domain/transfer-item-copy-intent';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';
import type { S3CreatedPutNotifications } from './aws-later-period-live-put-audit-reader';
import { readVersionedS3Json } from './read-versioned-s3-json';

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

function parseNotification(value: unknown, config: Config) {
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
    bucket.name !== config.sourceBucket ||
    bucket.arn !== `arn:aws:s3:::${config.sourceBucket}` ||
    typeof object.key !== 'string' ||
    typeof object.eTag !== 'string' ||
    !/^[\x21-\x7e]+$/.test(object.eTag) ||
    /[",\\]/.test(object.eTag) ||
    !isPinnedItemSourceVersion(object.versionId) ||
    typeof object.size !== 'number' ||
    typeof requestId !== 'string' ||
    !/^[A-Za-z0-9-]{1,128}$/.test(requestId)
  )
    throw invalid();
  let key: string;
  try {
    key = decodeURIComponent(object.key.replace(/\+/g, ' '));
  } catch {
    throw invalid();
  }
  if (!key || Buffer.byteLength(key) > 1024) throw invalid();
  const target = Object.freeze({
    bucket: config.sourceBucket,
    expectedBucketOwner: config.sourceBucketOwner,
    key,
  });
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
  const notification: CreatedPut = Object.freeze({
    target,
    event: 'ObjectCreated:Put',
    requestId,
    occurredAt,
    revision,
  });
  const record = {
    eventVersion: event.eventVersion,
    eventSource: event.eventSource,
    awsRegion: event.awsRegion,
    eventTime: occurredAt,
    eventName: event.eventName,
    responseElements: { 'x-amz-request-id': requestId },
    s3: {
      s3SchemaVersion: s3.s3SchemaVersion,
      configurationId: s3.configurationId,
      bucket: { name: bucket.name, arn: bucket.arn },
      object: {
        key: object.key,
        size: revision.size,
        eTag: object.eTag,
        versionId: revision.versionId,
      },
    },
  };
  return { notification, record };
}

type ParsedEvent = ReturnType<typeof parseNotification>;

function readRecords(value: unknown, config: Config): readonly ParsedEvent[] {
  if (!Array.isArray(value)) throw invalid();
  return value.map((record: unknown) => parseNotification(record, config));
}

class S3PutNotificationArchive {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly config: Config,
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
  }

  async read(target: Target) {
    const { bucket, key, expectedBucketOwner } = target;
    const config = this.config;
    if (
      bucket !== config.sourceBucket ||
      expectedBucketOwner !== config.sourceBucketOwner ||
      typeof key !== 'string' ||
      !key ||
      Buffer.byteLength(key) > 1024
    )
      throw invalid();
    const snapshot = await readVersionedS3Json(
      this.client,
      this.location(target),
      config.maxBytes,
      {
        invalid,
        unavailable: 'S3 could not read the PUT notification archive',
      },
    );
    if (!snapshot) return null;
    try {
      const { sourceBucketOwner, Records } = fields(snapshot.value);
      if (sourceBucketOwner !== config.sourceBucketOwner) throw invalid();
      const records = readRecords(Records, config);
      if (records.some(({ notification }) => notification.target.key !== key))
        throw invalid();
      return { etag: snapshot.etag, records };
    } catch {
      throw invalid();
    }
  }

  async append(target: Target, incoming: readonly ParsedEvent[]) {
    let previouslyExisted = false;
    // A contention retry always reads the current object and merges again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.read(target);
      if (!snapshot && previouslyExisted) throw invalid();
      previouslyExisted = snapshot !== null;
      const etag = snapshot?.etag;
      if (
        snapshot &&
        (!etag ||
          !/^"[\x21-\x7e]+"$/.test(etag) ||
          /[",\\]/.test(etag.slice(1, -1)))
      )
        throw invalid();
      const merged = mergeRecords(snapshot?.records ?? [], incoming);
      if (!merged.changed) return;
      const body = Buffer.from(
        JSON.stringify({
          sourceBucketOwner: target.expectedBucketOwner,
          Records: merged.records.map(({ record }) => record),
        }),
      );
      if (body.length > this.config.maxBytes) throw invalid();
      try {
        const result = await this.client.send(
          new PutObjectCommand({
            ...this.location(target),
            ...(etag === undefined ? { IfNoneMatch: '*' } : { IfMatch: etag }),
            Body: body,
            ContentLength: body.length,
            ContentType: 'application/json',
            ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
          }),
        );
        if (
          result?.$metadata?.httpStatusCode === 200 &&
          isPinnedItemSourceVersion(result.VersionId)
        )
          return;
      } catch (error) {
        if (
          error instanceof S3ServiceException &&
          ((error.name === 'PreconditionFailed' &&
            error.$metadata.httpStatusCode === 412) ||
            (error.name === 'ConditionalRequestConflict' &&
              error.$metadata.httpStatusCode === 409))
        )
          continue;
      }
      throw new ExternalServiceError(
        'The S3 PUT notification archive write was not confirmed',
      );
    }
    throw new ExternalServiceError('The S3 PUT notification archive is busy');
  }

  private location(target: Target) {
    return {
      Bucket: this.config.auditBucket,
      ExpectedBucketOwner: this.config.auditBucketOwner,
      Key: s3CreatedPutNotificationsKey(target),
    };
  }
}

function mergeRecords(
  stored: readonly ParsedEvent[],
  incoming: readonly ParsedEvent[],
) {
  const byId = new Map<string, ParsedEvent>();
  for (const entry of [...stored, ...incoming]) {
    const previous = byId.get(entry.notification.requestId);
    if (previous) {
      if (
        archiveHash(previous.notification) !== archiveHash(entry.notification)
      )
        throw invalid();
    } else {
      byId.set(entry.notification.requestId, entry);
    }
  }
  return {
    records: [...byId.values()],
    changed:
      byId.size >
      new Set(stored.map(({ notification }) => notification.requestId)).size,
  };
}

/** Read-only client for a dedicated, versioned archive written by a trusted collector. */
export class AwsS3CreatedPutNotifications implements S3CreatedPutNotifications {
  private readonly archive: S3PutNotificationArchive;

  constructor(client: Pick<S3Client, 'send'>, config: Config) {
    this.archive = new S3PutNotificationArchive(
      client,
      Object.freeze({ ...config }),
    );
  }

  async readCreatedPuts(target: Target): Promise<readonly CreatedPut[]> {
    const snapshot = await this.archive.read(target);
    return Object.freeze(
      snapshot?.records.map(({ notification }) => notification) ?? [],
    );
  }
}

/** Entry point for a dedicated S3-triggered Lambda. Invocation authentication is enforced by AWS policy. */
export class AwsS3CreatedPutNotificationCollector {
  private readonly archive: S3PutNotificationArchive;
  private readonly config: Config;

  constructor(client: Pick<S3Client, 'send'>, config: Config) {
    this.config = Object.freeze({ ...config });
    this.archive = new S3PutNotificationArchive(client, this.config);
  }

  async archiveTrustedDelivery(delivery: unknown): Promise<void> {
    const records = readRecords(fields(delivery).Records, this.config);
    const grouped = new Map<string, ParsedEvent[]>();
    for (const entry of records) {
      const { key } = entry.notification.target;
      const group = grouped.get(key);
      if (group) group.push(entry);
      else grouped.set(key, [entry]);
    }
    const batches = [...grouped.values()].map(
      (group) => mergeRecords([], group).records,
    );
    for (const batch of batches) {
      await this.archive.append(batch[0].notification.target, batch);
    }
  }
}
