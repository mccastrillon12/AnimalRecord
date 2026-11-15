import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  type GetObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { LaterPeriodLivePutEffect } from '../../../src/context/animal-transfer/domain/later-period-live-put';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { ITEM_PUT_AUDIT_METADATA } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { AwsLaterPeriodLivePutAuditReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-later-period-live-put-audit-reader';
import {
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
