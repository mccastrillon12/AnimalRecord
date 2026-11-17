import type { DynamicModule } from '@nestjs/common';
import { createRequire } from 'node:module';
import { extname, isAbsolute } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { regionalS3ObjectKey } from '../../context/shared/infrastructure/storage/aws-s3-storage.service';
import { AwsDirectItemCopies } from '../../context/animal-transfer/infrastructure/storage/aws-direct-item-copies';
import { AwsItemHistoricalObjectReader } from '../../context/animal-transfer/infrastructure/storage/aws-item-historical-object-reader';
import {
  type InitialTransferAcceptanceConfiguration,
  InitialTransferAcceptanceModule,
} from './initial-transfer-acceptance.module';

export type CreateInitialTransferAcceptanceOptions = () =>
  | InitialTransferAcceptanceConfiguration
  | Promise<InitialTransferAcceptanceConfiguration>;

export async function configuredTransferAcceptance(env: NodeJS.ProcessEnv) {
  const mode = env.TRANSFER_ACCEPTANCE_MODE;
  if (mode === undefined || mode === '')
    return loadInitialTransferAcceptance(env.TRANSFER_ACCEPTANCE_CONFIG_MODULE);
  if (mode !== 'direct-s3' || env.TRANSFER_ACCEPTANCE_CONFIG_MODULE)
    throw new Error('Choose a single transfer acceptance configuration');
  const bucket = env.AWS_S3_BUCKET_NAME ?? '';
  const region = env.AWS_S3_REGION || env.AWS_REGION || 'us-east-1';
  const expectedBucketOwner = env.TRANSFER_S3_BUCKET_OWNER ?? '';
  const retainUntil = env.TRANSFER_S3_RETENTION_UNTIL ?? '';
  const retentionTimestamp = Date.parse(retainUntil);
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !/^\d{12}$/.test(expectedBucketOwner) ||
    !Number.isFinite(retentionTimestamp) ||
    !retainUntil.endsWith('.000Z') ||
    new Date(retentionTimestamp).toISOString() !== retainUntil ||
    !/^[a-z0-9-]+$/.test(region)
  )
    throw new Error(
      'Direct S3 transfers require the application bucket, its account ID and a UTC retention date with whole seconds',
    );
  const timeout = 15_000;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const client = new S3Client({
    region,
    maxAttempts: 1,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey, sessionToken: env.AWS_SESSION_TOKEN }
        : undefined,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 3_000,
      requestTimeout: timeout,
      throwOnRequestTimeout: true,
    }),
  });
  return InitialTransferAcceptanceModule.forDirectS3(
    {
      keyFromUrl: (url) => regionalS3ObjectKey(url, bucket, region),
      urlForKey: (key) =>
        `https://${bucket}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`,
    },
    new AwsDirectItemCopies(client, bucket, expectedBucketOwner, retainUntil),
    new AwsItemHistoricalObjectReader(client, { bucket, expectedBucketOwner }),
    timeout,
  );
}

/** Only a trusted deployment operator supplies this local CommonJS module. */
export async function loadInitialTransferAcceptance(
  filename: string | undefined,
): Promise<DynamicModule | undefined> {
  if (filename === undefined || filename === '') return undefined;
  if (!isAbsolute(filename) || !['.js', '.cjs'].includes(extname(filename)))
    throw new Error(
      'TRANSFER_ACCEPTANCE_CONFIG_MODULE must be an absolute path to a CommonJS file',
    );

  let entry: unknown;
  try {
    entry = createRequire(__filename)(filename);
  } catch {
    throw new Error(
      'The transfer acceptance configuration module could not be loaded',
    );
  }
  if (
    !entry ||
    typeof entry !== 'object' ||
    !('createInitialTransferAcceptanceOptions' in entry) ||
    typeof entry.createInitialTransferAcceptanceOptions !== 'function'
  )
    throw new Error(
      'The transfer acceptance configuration must export createInitialTransferAcceptanceOptions',
    );

  try {
    const createOptions =
      entry.createInitialTransferAcceptanceOptions as CreateInitialTransferAcceptanceOptions;
    return InitialTransferAcceptanceModule.forApplication(
      await createOptions(),
    );
  } catch {
    throw new Error(
      'The transfer acceptance configuration could not be initialized',
    );
  }
}
