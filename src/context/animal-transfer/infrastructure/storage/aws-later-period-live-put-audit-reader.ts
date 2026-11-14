import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../shared/domain/errors/ExternalServiceError';
import type { LaterPeriodLivePutAuditReader } from '../../application/later-period-live-media-evidence-producer';
import type { LaterPeriodLivePutEffect } from '../../domain/later-period-live-put';
import { archiveHash, ObjectRevision } from '../../domain/ownership-archive';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from '../../domain/transfer-item-copy-intent';
import { sourceHashValid } from '../../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';
import { ITEM_PUT_AUDIT_METADATA } from './aws-item-put-transport';

type Target = LaterPeriodLivePutEffect['target'];
type CreatedPut = Readonly<{
  target: Target;
  event: 'ObjectCreated:Put';
  requestId: string;
  occurredAt: string;
  /** Decoded key in target; ETag in the quoted HTTP form. */
  revision: Readonly<ObjectRevision>;
}>;

/** Trusted, read-only source of authenticated S3 notifications for the exact target.
 * The source must pin the bucket/account and normalize notification key and ETag.
 */
export interface S3CreatedPutNotifications {
  readCreatedPuts(target: Target): Promise<readonly CreatedPut[]>;
}

const invalid = () =>
  new ConflictError('S3 notifications do not identify one permitted PUT');

/** No dependency on the PUT response. HEAD checks the exact version named by an independent event. */
export class AwsLaterPeriodLivePutAuditReader implements LaterPeriodLivePutAuditReader {
  constructor(
    private readonly notifications: S3CreatedPutNotifications,
    private readonly client: Pick<S3Client, 'send'>,
  ) {}

  async readAppliedVersion(effect: LaterPeriodLivePutEffect) {
    const { target, auditMarkerHash } = effect;
    if (!sourceHashValid(auditMarkerHash)) return null;
    const admittedAt = historicalPutEvidenceTime(effect.admittedAt);
    const candidates = new Map<
      string,
      Readonly<{ revision: Readonly<ObjectRevision>; occurredAt: string }>
    >();
    for (const entry of await this.notifications.readCreatedPuts(target)) {
      if (
        entry?.event !== 'ObjectCreated:Put' ||
        archiveHash(entry.target) !== archiveHash(target) ||
        typeof entry.requestId !== 'string' ||
        !/^[A-Za-z0-9-]{1,128}$/.test(entry.requestId)
      )
        throw invalid();
      const revision = captureItemObjectRevision(entry.revision);
      if (!isPinnedItemSourceVersion(revision.versionId)) throw invalid();
      historicalPutEvidenceTime(entry.occurredAt);
      const eventHash = archiveHash([
        'S3_OBJECT_CREATED_PUT_V1',
        target.bucket,
        target.expectedBucketOwner,
        entry.requestId,
      ]);
      const candidate = { revision, occurredAt: entry.occurredAt };
      const previous = candidates.get(eventHash);
      if (previous && archiveHash(previous) !== archiveHash(candidate))
        throw invalid();
      candidates.set(eventHash, candidate);
    }

    let matched: Awaited<
      ReturnType<LaterPeriodLivePutAuditReader['readAppliedVersion']>
    > = null;
    for (const [eventEvidenceHash, { revision, occurredAt }] of candidates) {
      if (
        historicalPutEvidenceTime(occurredAt) < admittedAt ||
        revision.size !== effect.size
      )
        continue;
      if (!(await this.matchesVersion(target, revision, auditMarkerHash)))
        continue;
      if (matched) throw invalid();
      matched = Object.freeze({
        effectHash: archiveHash(effect),
        operation: 'PUT_OBJECT',
        outcome: 'APPLIED',
        revision,
        occurredAt,
        eventEvidenceHash,
      });
    }
    return matched;
  }

  private async matchesVersion(
    target: Target,
    revision: Readonly<ObjectRevision>,
    auditMarkerHash: string,
  ) {
    const response = await this.client
      .send(
        new HeadObjectCommand({
          Bucket: target.bucket,
          Key: target.key,
          VersionId: revision.versionId,
          IfMatch: revision.etag,
          ExpectedBucketOwner: target.expectedBucketOwner,
        }),
      )
      .catch(() => {
        throw new ExternalServiceError(
          'S3 could not verify the notified PUT version',
        );
      });
    if (
      response?.$metadata?.httpStatusCode !== 200 ||
      response.DeleteMarker ||
      response.VersionId !== revision.versionId ||
      response.ETag !== revision.etag ||
      response.ContentLength !== revision.size
    )
      throw invalid();
    const marker = response.Metadata?.[ITEM_PUT_AUDIT_METADATA];
    return sourceHashValid(marker) && archiveHash(marker) === auditMarkerHash;
  }
}
