import { generateKeyPairSync } from 'node:crypto';
import { createInitialTransferS3Configuration } from '../../../src/app/animal-transfer/initial-transfer-acceptance-s3';
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
