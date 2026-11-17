import { generateKeyPairSync } from 'node:crypto';
import {
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  S3Client,
  type GetBucketVersioningCommandOutput,
  type GetObjectLockConfigurationCommandOutput,
} from '@aws-sdk/client-s3';
import {
  checkInitialTransferS3Media,
  createInitialTransferS3Configuration,
} from '../../../src/app/animal-transfer/initial-transfer-acceptance-s3';
import type { InitialTransferS3Settings } from '../../../src/app/animal-transfer/initial-transfer-acceptance-s3';
import { AwsItemPutTransport } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';

function settings(): InitialTransferS3Settings {
  const region = 'us-east-1';
  const bucketOwner = '123456789012';
  const unavailable = () => Promise.resolve(null);
  return {
    media: {
      bucket: 'synthetic-media',
      region,
      expectedBucketOwner: bucketOwner,
      timeoutMs: 1000,
      credentials: { accessKeyId: 'synthetic', secretAccessKey: 'synthetic' },
      complianceRetainUntil: '2099-01-01T00:00:00.000Z',
    },
    notificationArchive: {
      auditBucket: 'synthetic-events',
      auditBucketOwner: bucketOwner,
      region,
      notificationConfigurationId: 'synthetic-put-notification',
      maxBytes: 16384,
    },
    evidenceArchive: {
      bucket: 'synthetic-put-reports',
      bucketOwner,
      region,
      issuerId: id(1),
      maxBytes: 16384,
    },
    coverage: {
      bucket: 'synthetic-coverage',
      bucketOwner,
      region,
      issuerId: id(2),
      controlsHash: 'a'.repeat(64),
      publicKey: generateKeyPairSync('ed25519').publicKey,
      maxBytes: 16384,
    },
    authority: {
      requiredThrough: unavailable,
      source: unavailable,
      historicalDestination: unavailable,
      stagingDestination: unavailable,
      finalDestination: unavailable,
      readDestinationAccreditation: unavailable,
    },
    custody: {
      maxArtifactBytes: 1024,
      maxTotalBytes: 1024,
      maxArtifacts: 1,
      maxOpenReaders: 1,
    },
    historyDownloadTimeoutMs: 1000,
  };
}

it('binds object reads, writes and URLs to the same regional media bucket', () => {
  const configuration = settings();
  const runtime = createInitialTransferS3Configuration(configuration);
  const key = 'users/example/photo con ñ.png';
  const url = runtime.urls.urlForKey(key);
  expect(runtime.urls.keyFromUrl(url)).toBe(key);
  expect(
    runtime.urls.keyFromUrl(url.replace('synthetic-media', 'other-bucket')),
  ).toBeUndefined();
  expect(runtime.historyVersions).toBe(runtime.sourceReader);
  expect(runtime.put.transport).toBeInstanceOf(AwsItemPutTransport);
  expect(typeof runtime.put.retainSource).toBe('function');
  expect(runtime.backgroundResume).toBe(true);
  expect(runtime.putEvidence.configuration.notificationArchive).toMatchObject({
    sourceBucket: configuration.media.bucket,
    sourceBucketOwner: configuration.media.expectedBucketOwner,
    sourceRegion: configuration.media.region,
  });
  expect(runtime.putEvidence.configuration.conservationControlsHash).toBe(
    configuration.coverage.controlsHash,
  );
  expect(runtime.put.evidenceInputs).toBe(configuration.authority);
  expect(runtime.sourceEvidence.destinationAccreditations).toBe(
    configuration.authority,
  );
});

it('rejects configuration without the expected media bucket owner', () => {
  const configuration = settings();
  expect(() =>
    createInitialTransferS3Configuration({
      ...configuration,
      media: { ...configuration.media, expectedBucketOwner: '' },
    }),
  ).toThrow('The archive PUT transport is not configured');
});

it('requires explicit retention and checks the horizon for fresh copies', () => {
  const configuration = settings();
  const retainUntil = configuration.media.complianceRetainUntil!;
  expect(() =>
    createInitialTransferS3Configuration({
      ...configuration,
      media: { ...configuration.media, complianceRetainUntil: undefined },
    }),
  ).toThrow(
    'The archive PUT retention date does not cover the required horizon',
  );

  const { assertRetentionThrough } =
    createInitialTransferS3Configuration(configuration).put;
  expect(() =>
    assertRetentionThrough!('2098-12-31T23:59:59.999Z'),
  ).not.toThrow();
  for (const requiredThrough of [
    retainUntil,
    '2099-01-02T00:00:00.000Z',
    'invalid',
  ]) {
    expect(() => assertRetentionThrough!(requiredThrough)).toThrow(
      'The archive PUT retention date does not cover the required horizon',
    );
  }
});

it('inspects the owned bucket without loading evidence or issuing writes', async () => {
  const { media } = settings();
  const client = S3Client.prototype as {
    send(
      command: GetBucketVersioningCommand | GetObjectLockConfigurationCommand,
    ): Promise<
      GetBucketVersioningCommandOutput | GetObjectLockConfigurationCommandOutput
    >;
  };
  const send = jest
    .spyOn(client, 'send')
    .mockResolvedValueOnce({ $metadata: {}, Status: 'Enabled' })
    .mockRejectedValueOnce(
      Object.assign(new Error(), {
        name: 'ObjectLockConfigurationNotFoundError',
      }),
    );
  try {
    await expect(checkInitialTransferS3Media(media)).resolves.toEqual({
      versioningEnabled: true,
      objectLockEnabled: false,
      defaultRetentionConfigured: false,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetBucketVersioningCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(
      GetObjectLockConfigurationCommand,
    );
    for (const [command] of send.mock.calls) {
      expect(command.input).toEqual({
        Bucket: media.bucket,
        ExpectedBucketOwner: media.expectedBucketOwner,
      });
    }
  } finally {
    send.mockRestore();
  }
});
