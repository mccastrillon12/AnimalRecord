import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3ServiceException,
  type GetObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { LaterPeriodLivePutEffect } from '../../../src/context/animal-transfer/domain/later-period-live-put';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { ITEM_PUT_AUDIT_METADATA } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { AwsLaterPeriodLivePutAuditReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-later-period-live-put-audit-reader';
import {
  AwsS3CreatedPutNotificationCollector,
  AwsS3CreatedPutNotifications,
  s3CreatedPutNotificationsKey,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-s3-created-put-notifications';

const config = {
  auditBucket: 'synthetic-audit',
  auditBucketOwner: '123456789000',
  sourceBucket: 'synthetic-history',
  sourceBucketOwner: '123456789012',
  sourceRegion: 'us-east-1',
  notificationConfigurationId: 'synthetic-put-only',
  maxBytes: 4096,
};
const target = {
  bucket: config.sourceBucket,
  expectedBucketOwner: config.sourceBucketOwner,
  key: 'users/synthetic/foto más+%20.pdf',
};
const notification = {
  eventVersion: '2.6',
  eventSource: 'aws:s3',
  awsRegion: config.sourceRegion,
  eventTime: '2026-10-29T12:03:01Z',
  eventName: 'ObjectCreated:Put',
  responseElements: { 'x-amz-request-id': 'S3-A1', 'x-amz-id-2': 'host-id' },
  s3: {
    s3SchemaVersion: '1.0',
    configurationId: config.notificationConfigurationId,
    bucket: {
      name: config.sourceBucket,
      arn: `arn:aws:s3:::${config.sourceBucket}`,
    },
    object: {
      key: 'users%2Fsynthetic%2Ffoto+m%C3%A1s%2B%2520.pdf',
      size: 24,
      eTag: 'object-etag',
      versionId: 'written-version',
    },
  },
};

function response(input: { Records: unknown[]; sourceBucketOwner?: string }) {
  const bytes = Buffer.from(
    JSON.stringify({ sourceBucketOwner: config.sourceBucketOwner, ...input }),
  );
  const body = Readable.from([bytes.subarray(0, 15), bytes.subarray(15)]);
  const result = {
    $metadata: { httpStatusCode: 200 },
    Body: body as NonNullable<GetObjectCommandOutput['Body']>,
    ContentLength: bytes.length,
    VersionId: 'audit-version',
  };
  return { result, body };
}

function setup() {
  const send = jest.fn<Promise<GetObjectCommandOutput>, [GetObjectCommand]>();
  const reader = new AwsS3CreatedPutNotifications(
    { send } as unknown as Pick<S3Client, 'send'>,
    config,
  );
  return { send, reader };
}

describe('Archived S3 PUT notification source', () => {
  it('reads only the scoped audit key and normalizes the native event', async () => {
    const f = setup();
    const archived = response({ Records: [notification] });
    f.send.mockResolvedValue(archived.result);
    await expect(f.reader.readCreatedPuts(target)).resolves.toEqual([
      {
        target,
        event: 'ObjectCreated:Put',
        requestId: 'S3-A1',
        occurredAt: '2026-10-29T12:03:01.000Z',
        revision: {
          versionId: 'written-version',
          etag: '"object-etag"',
          size: 24,
        },
      },
    ]);
    expect(f.send).toHaveBeenCalledTimes(1);
    const [[command]] = f.send.mock.calls;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: config.auditBucket,
      ExpectedBucketOwner: config.auditBucketOwner,
      Key: s3CreatedPutNotificationsKey(target),
    });
    expect(command.input.Key).toMatch(
      /^put-notifications\/v1\/[a-f0-9]{64}\.json$/,
    );
    expect(archived.body.destroyed).toBe(true);
  });

  it('can verify a delayed event without another PUT and deduplicates its delivery', async () => {
    const f = setup();
    const marker = 'a'.repeat(64);
    const effect: LaterPeriodLivePutEffect = {
      target,
      authorizationId: archiveHash('authorization'),
      permissionHash: archiveHash('permission'),
      attemptDefinitionHash: archiveHash('attempt'),
      transportRequestHash: archiveHash('wire'),
      auditMarkerHash: archiveHash(marker),
      sha256: archiveHash('bytes'),
      size: 24,
      admittedAt: '2026-10-29T12:03:00.000Z',
    };
    f.send
      .mockRejectedValueOnce(
        new NoSuchKey({
          message: 'synthetic audit object not found',
          $metadata: { httpStatusCode: 404 },
        }),
      )
      .mockResolvedValueOnce(
        response({ Records: [notification, notification] }).result,
      );
    const sendHead = jest
      .fn<Promise<unknown>, [HeadObjectCommand]>()
      .mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        VersionId: 'written-version',
        ETag: '"object-etag"',
        ContentLength: 24,
        Metadata: { [ITEM_PUT_AUDIT_METADATA]: marker },
      });
    const audit = new AwsLaterPeriodLivePutAuditReader(f.reader, {
      send: sendHead,
    } as unknown as Pick<S3Client, 'send'>);
    await expect(audit.readAppliedVersion(effect)).resolves.toBeNull();
    expect(sendHead).not.toHaveBeenCalled();
    await expect(audit.readAppliedVersion(effect)).resolves.toMatchObject({
      outcome: 'APPLIED',
      effectHash: archiveHash(effect),
      revision: { versionId: 'written-version' },
    });
    expect(sendHead).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it('rejects an out-of-scope target before reading S3', async () => {
    const f = setup();
    await expect(
      f.reader.readCreatedPuts({
        ...target,
        expectedBucketOwner: '111111111111',
      }),
    ).rejects.toThrow('notifications are inconsistent');
    expect(f.send).not.toHaveBeenCalled();
  });

  it.each([
    { ...notification, eventSource: 'aws:other' },
    { ...notification, eventName: 'ObjectCreated:Copy' },
    { ...notification, awsRegion: 'eu-west-1' },
    { ...notification, eventVersion: '3.0' },
    {
      ...notification,
      s3: { ...notification.s3, configurationId: 'other-feed' },
    },
    {
      ...notification,
      s3: {
        ...notification.s3,
        bucket: {
          ...notification.s3.bucket,
          arn: 'arn:aws:s3:::foreign',
        },
      },
    },
    {
      ...notification,
      s3: {
        ...notification.s3,
        object: { ...notification.s3.object, key: 'other-key' },
      },
    },
    {
      ...notification,
      s3: {
        ...notification.s3,
        object: { ...notification.s3.object, key: '%C3' },
      },
    },
    {
      ...notification,
      s3: {
        ...notification.s3,
        object: { ...notification.s3.object, eTag: 'one,two' },
      },
    },
    {
      ...notification,
      s3: {
        ...notification.s3,
        object: { ...notification.s3.object, versionId: 'null' },
      },
    },
  ])(
    'rejects an untrusted or malformed record in a batch (%#)',
    async (invalid) => {
      const f = setup();
      const archived = response({ Records: [notification, invalid] });
      f.send.mockResolvedValue(archived.result);
      await expect(f.reader.readCreatedPuts(target)).rejects.toThrow(
        'notifications are inconsistent',
      );
      expect(archived.body.destroyed).toBe(true);
    },
  );

  it.each([
    { VersionId: undefined },
    { ContentRange: 'bytes 0-15/500' },
    { PartsCount: 1 },
    { ContentLength: 1 },
    { ContentLength: 2000 },
    { ContentLength: config.maxBytes + 1 },
  ])('rejects an incomplete or oversized response (%#)', async (changes) => {
    const f = setup();
    const archived = response({ Records: [notification] });
    f.send.mockResolvedValue({ ...archived.result, ...changes });
    await expect(f.reader.readCreatedPuts(target)).rejects.toThrow(
      'notifications are inconsistent',
    );
    expect(archived.body.destroyed).toBe(true);
  });

  it('distinguishes a missing object from an unavailable archive', async () => {
    const f = setup();
    f.send.mockRejectedValueOnce({
      name: 'NoSuchBucket',
      $metadata: { httpStatusCode: 404 },
    });
    await expect(f.reader.readCreatedPuts(target)).rejects.toThrow(
      'could not read the PUT notification archive',
    );
  });

  it('rejects an archive batch from a different source account', async () => {
    const f = setup();
    f.send.mockResolvedValue(
      response({
        Records: [notification],
        sourceBucketOwner: '111111111111',
      }).result,
    );
    await expect(f.reader.readCreatedPuts(target)).rejects.toThrow(
      'notifications are inconsistent',
    );
  });
});

function notificationWithId(id: string) {
  return {
    ...notification,
    responseElements: {
      ...notification.responseElements,
      'x-amz-request-id': id,
    },
  };
}

function archiveFixture({
  maxBytes = config.maxBytes,
  dropAcknowledgement = false,
  conflict = 412,
  forceConflict = false,
}: {
  maxBytes?: number;
  dropAcknowledgement?: boolean;
  conflict?: 409 | 412;
  forceConflict?: boolean;
} = {}) {
  const objects = new Map<
    string,
    { bytes: Buffer; etag: string; versionId: string }
  >();
  const puts: PutObjectCommand['input'][] = [];
  let writes = 0;
  let uncertain = dropAcknowledgement;
  const send = jest.fn(async (command: GetObjectCommand | PutObjectCommand) => {
    await Promise.resolve();
    const { Bucket, ExpectedBucketOwner, Key } = command.input;
    expect(Bucket).toBe(config.auditBucket);
    expect(ExpectedBucketOwner).toBe(config.auditBucketOwner);
    if (!Key) throw new Error('Expected audit key');
    const current = objects.get(Key);
    if (command instanceof GetObjectCommand) {
      if (!current)
        throw new NoSuchKey({
          message: 'missing',
          $metadata: { httpStatusCode: 404 },
        });
      return {
        $metadata: { httpStatusCode: 200 },
        Body: Readable.from([current.bytes]),
        ContentLength: current.bytes.length,
        ETag: current.etag,
        VersionId: current.versionId,
      };
    }
    expect(command).toBeInstanceOf(PutObjectCommand);
    puts.push(command.input);
    const { Body, IfNoneMatch, IfMatch, ChecksumSHA256 } = command.input;
    if (
      forceConflict ||
      (current ? IfMatch !== current.etag : IfNoneMatch !== '*')
    )
      throw new S3ServiceException({
        name:
          conflict === 409
            ? 'ConditionalRequestConflict'
            : 'PreconditionFailed',
        $fault: 'client',
        $metadata: { httpStatusCode: conflict },
      });
    if (!Buffer.isBuffer(Body))
      throw new Error('Expected a bounded JSON buffer');
    expect(ChecksumSHA256).toBe(
      createHash('sha256').update(Body).digest('base64'),
    );
    const versionId = `audit-${++writes}`;
    objects.set(Key, { bytes: Body, etag: `"${versionId}"`, versionId });
    if (uncertain) {
      uncertain = false;
      throw new Error('synthetic lost acknowledgement after remote write');
    }
    return { $metadata: { httpStatusCode: 200 }, VersionId: versionId };
  });
  const client = { send } as unknown as Pick<S3Client, 'send'>;
  const options = { ...config, maxBytes };
  return {
    reader: new AwsS3CreatedPutNotifications(client, options),
    collector: new AwsS3CreatedPutNotificationCollector(client, options),
    send,
    puts,
  };
}

describe('S3 PUT notification collector', () => {
  it('merges deliveries that race to create the same audit object', async () => {
    const f = archiveFixture();
    await Promise.all([
      f.collector.archiveTrustedDelivery({ Records: [notification] }),
      f.collector.archiveTrustedDelivery({
        Records: [notificationWithId('S3-A2')],
      }),
    ]);
    expect(
      f.puts.map(({ IfMatch, IfNoneMatch }) => IfMatch ?? IfNoneMatch),
    ).toEqual(['*', '*', '"audit-1"']);
    const archived = await f.reader.readCreatedPuts(target);
    expect(archived.map(({ requestId }) => requestId).sort()).toEqual([
      'S3-A1',
      'S3-A2',
    ]);
  });

  it('merges updates after a concurrent conditional conflict', async () => {
    const f = archiveFixture({ conflict: 409 });
    await f.collector.archiveTrustedDelivery({ Records: [notification] });
    await Promise.all([
      f.collector.archiveTrustedDelivery({
        Records: [notificationWithId('S3-A2')],
      }),
      f.collector.archiveTrustedDelivery({
        Records: [notificationWithId('S3-A3')],
      }),
    ]);
    expect(f.puts.map(({ IfMatch }) => IfMatch)).toEqual([
      undefined,
      '"audit-1"',
      '"audit-1"',
      '"audit-2"',
    ]);
    const archived = await f.reader.readCreatedPuts(target);
    expect(archived.map(({ requestId }) => requestId).sort()).toEqual([
      'S3-A1',
      'S3-A2',
      'S3-A3',
    ]);
  });

  it('acknowledges an exact redelivery without a second write after a lost response', async () => {
    const f = archiveFixture({ dropAcknowledgement: true });
    await expect(
      f.collector.archiveTrustedDelivery({ Records: [notification] }),
    ).rejects.toThrow('write was not confirmed');
    await f.collector.archiveTrustedDelivery({
      Records: [
        notification,
        { ...notification, eventTime: '2026-10-29T12:03:01.000Z' },
      ],
    });
    expect(f.puts).toHaveLength(1);
    expect(await f.reader.readCreatedPuts(target)).toHaveLength(1);
  });

  it('fails a full delivery validation before touching storage', async () => {
    const f = archiveFixture();
    await expect(
      f.collector.archiveTrustedDelivery({
        Records: [notification, { ...notification, awsRegion: 'eu-west-1' }],
      }),
    ).rejects.toThrow('notifications are inconsistent');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does not replace different facts for an archived request ID', async () => {
    const f = archiveFixture();
    await f.collector.archiveTrustedDelivery({ Records: [notification] });
    await expect(
      f.collector.archiveTrustedDelivery({
        Records: [{ ...notification, eventTime: '2026-10-29T12:03:02Z' }],
      }),
    ).rejects.toThrow('notifications are inconsistent');
    expect(f.puts).toHaveLength(1);
    expect(await f.reader.readCreatedPuts(target)).toMatchObject([
      { occurredAt: '2026-10-29T12:03:01.000Z' },
    ]);
  });

  it('returns a retryable failure when contention exhausts the local attempts', async () => {
    const f = archiveFixture({ forceConflict: true });
    await expect(
      f.collector.archiveTrustedDelivery({ Records: [notification] }),
    ).rejects.toThrow('notification archive is busy');
    expect(f.puts).toHaveLength(3);
    expect(f.send).toHaveBeenCalledTimes(6);
  });

  it('fails before PUT if the resulting JSON exceeds the reader bound', async () => {
    const f = archiveFixture({ maxBytes: 20 });
    await expect(
      f.collector.archiveTrustedDelivery({ Records: [notification] }),
    ).rejects.toThrow('notifications are inconsistent');
    expect(f.puts).toHaveLength(0);
  });
});
