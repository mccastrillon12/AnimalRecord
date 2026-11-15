import type { S3Client } from '@aws-sdk/client-s3';
import type { LaterPeriodLivePutAuditReader } from '../../application/later-period-live-media-evidence-producer';
import type { LaterPeriodLivePutEffect } from '../../domain/later-period-live-put';
import { archiveHash } from '../../domain/ownership-archive';
import {
  AwsS3PutAuditReader,
  type S3CreatedPutNotifications,
} from './aws-s3-put-audit';

export type { S3CreatedPutNotifications } from './aws-s3-put-audit';

export class AwsLaterPeriodLivePutAuditReader implements LaterPeriodLivePutAuditReader {
  private readonly audit: AwsS3PutAuditReader;

  constructor(
    notifications: S3CreatedPutNotifications,
    client: Pick<S3Client, 'send'>,
  ) {
    this.audit = new AwsS3PutAuditReader(notifications, client);
  }

  async readAppliedVersion(effect: LaterPeriodLivePutEffect) {
    const match = await this.audit.readMatchingPut(effect);
    if (!match) return null;
    return Object.freeze({
      effectHash: archiveHash(effect),
      operation: 'PUT_OBJECT' as const,
      outcome: 'APPLIED' as const,
      ...match,
    });
  }
}
