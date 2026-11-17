import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { regionalS3ObjectKey } from '../../context/shared/infrastructure/storage/aws-s3-storage.service';
import { ItemStableCutEvidenceProducer } from '../../context/animal-transfer/application/item-stable-cut-evidence-producer';
import { AwsItemHistoricalObjectReader } from '../../context/animal-transfer/infrastructure/storage/aws-item-historical-object-reader';
import { AwsItemPutTransport } from '../../context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { AwsSignedItemStableCutCoverage } from '../../context/animal-transfer/infrastructure/storage/aws-signed-stable-cut-coverage';
import type { InitialTransferAcceptanceConfiguration } from './initial-transfer-acceptance.module';

type Runtime = InitialTransferAcceptanceConfiguration;
type PutEvidence = Runtime['putEvidence']['configuration'];
type Transport = ConstructorParameters<typeof AwsItemPutTransport>[0];

export type InitialTransferS3Settings = Readonly<{
  media: Transport;
  notificationArchive: Omit<
    PutEvidence['notificationArchive'],
    'sourceBucket' | 'sourceBucketOwner' | 'sourceRegion'
  > & { region: string };
  evidenceArchive: PutEvidence['evidenceArchive'] & { region: string };
  coverage: ConstructorParameters<typeof AwsSignedItemStableCutCoverage>[1] & {
    region: string;
  };
  authority: Runtime['put']['evidenceInputs'] &
    NonNullable<Runtime['sourceEvidence']['destinationAccreditations']>;
  custody: Runtime['put']['custody'];
  historyDownloadTimeoutMs: number;
}>;

/** Builds the production adapters. Authority reports are supplied by the deployment. */
export function createInitialTransferS3Configuration(
  settings: InitialTransferS3Settings,
): Runtime {
  const {
    media,
    authority,
    custody,
    historyDownloadTimeoutMs,
    notificationArchive: { region: notificationRegion, ...notifications },
    evidenceArchive: { region: evidenceRegion, ...evidenceArchive },
    coverage: { region: coverageRegion, ...coverage },
  } = settings;
  const { bucket, region, expectedBucketOwner, credentials, timeoutMs } = media;
  const transport = new AwsItemPutTransport(media);
  const now = () => new Date();
  const client = (region: string, explicitCredentials?: typeof credentials) =>
    new S3Client({
      region,
      ...(explicitCredentials && { credentials: explicitCredentials }),
      requestHandler: new NodeHttpHandler({
        connectionTimeout: timeoutMs,
        requestTimeout: timeoutMs,
        throwOnRequestTimeout: true,
      }),
    });
  const objectVersions = client(region, credentials);
  const versions = new AwsItemHistoricalObjectReader(objectVersions, {
    bucket,
    expectedBucketOwner,
  });
  const coverageReader = new AwsSignedItemStableCutCoverage(
    client(coverageRegion),
    coverage,
    now,
  );

  return {
    urls: {
      keyFromUrl: (url) => regionalS3ObjectKey(url, bucket, region),
      urlForKey: (key) =>
        `https://${bucket}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`,
    },
    sourceReader: versions,
    sourceEvidence: {
      reader: versions,
      expectedBucketOwner,
      now,
      destinationAccreditations: authority,
    },
    putEvidence: {
      clients: {
        notificationArchive: client(notificationRegion),
        objectVersions,
        evidenceArchive: client(evidenceRegion),
      },
      configuration: {
        notificationArchive: {
          ...notifications,
          sourceBucket: bucket,
          sourceBucketOwner: expectedBucketOwner,
          sourceRegion: region,
        },
        evidenceArchive,
        conservationControlsHash: coverage.controlsHash,
      },
      now,
    },
    put: { evidenceInputs: authority, transport, custody },
    stableCut: new ItemStableCutEvidenceProducer(coverageReader, versions, now),
    historyVersions: versions,
    historyDownloadTimeoutMs,
  };
}
