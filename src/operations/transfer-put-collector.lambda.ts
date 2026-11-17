import { S3Client } from '@aws-sdk/client-s3';
import { AwsS3CreatedPutNotificationCollector } from '../context/animal-transfer/infrastructure/storage/aws-s3-created-put-notifications';

type Archive = Pick<
  AwsS3CreatedPutNotificationCollector,
  'archiveTrustedDelivery'
>;

function isValidationEvent(event: unknown) {
  return (
    event &&
    typeof event === 'object' &&
    !('Records' in event) &&
    'Service' in event &&
    event.Service === 'Amazon S3' &&
    'Event' in event &&
    event.Event === 's3:TestEvent'
  );
}

export function transferPutCollectorHandler(archive: Archive) {
  return async (event: unknown) => {
    if (isValidationEvent(event)) return;
    await archive.archiveTrustedDelivery(event, { transferKeysOnly: true });
  };
}

let configuredHandler:
  | ReturnType<typeof transferPutCollectorHandler>
  | undefined;

/** Lambda delivery must be restricted by the function policy to S3 and the configured source bucket/account. */
export async function handler(event: unknown) {
  // S3 can validate the destination before it exposes the configuration ID.
  if (isValidationEvent(event)) return;
  if (!configuredHandler) {
    const env = process.env;
    if (!env.AUDIT_BUCKET_REGION)
      throw new Error('The audit bucket region is required');
    configuredHandler = transferPutCollectorHandler(
      new AwsS3CreatedPutNotificationCollector(
        new S3Client({ region: env.AUDIT_BUCKET_REGION }),
        {
          auditBucket: env.AUDIT_BUCKET ?? '',
          auditBucketOwner: env.AUDIT_BUCKET_OWNER ?? '',
          sourceBucket: env.SOURCE_BUCKET ?? '',
          sourceBucketOwner: env.SOURCE_BUCKET_OWNER ?? '',
          sourceRegion: env.SOURCE_BUCKET_REGION ?? '',
          notificationConfigurationId: env.NOTIFICATION_CONFIGURATION_ID ?? '',
          maxBytes: Number(env.AUDIT_MAX_BYTES),
        },
      ),
    );
  }
  await configuredHandler(event);
}
