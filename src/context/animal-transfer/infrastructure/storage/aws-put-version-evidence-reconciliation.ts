import type { S3Client } from '@aws-sdk/client-s3';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { ItemHistoricalPutReconciler } from '../../application/item-historical-put-reconciler';
import {
  ItemRecipientFinalPutReconciler,
  ItemStagingPutReconciler,
  PublishedHistoryFinalPutReconciler,
  PublishedHistoryPutReconciler,
  PublishedHistoryStagingPutReconciler,
} from '../../application/item-staging-put-reconciler';
import type { PutVersionAuditInput } from '../../application/put-version-audit-selection';
import type { PutVersionEvidence } from '../../domain/transfer-item-historical-put-reconciliation';
import { AwsItemHistoricalObjectReader } from './aws-item-historical-object-reader';
import { AwsPutVersionEvidenceReader } from './aws-put-version-evidence-reader';

type ItemStore = ConstructorParameters<typeof ItemHistoricalPutReconciler>[0] &
  ConstructorParameters<typeof ItemStagingPutReconciler>[0] &
  ConstructorParameters<typeof ItemRecipientFinalPutReconciler>[0];
type HistoryStore = ConstructorParameters<
  typeof PublishedHistoryPutReconciler
>[0] &
  ConstructorParameters<typeof PublishedHistoryStagingPutReconciler>[0] &
  ConstructorParameters<typeof PublishedHistoryFinalPutReconciler>[0];
type Client = Pick<S3Client, 'send'>;
type Configuration = Readonly<{
  evidenceArchive: ConstructorParameters<typeof AwsPutVersionEvidenceReader>[1];
  objectVersions: NonNullable<
    ConstructorParameters<typeof AwsItemHistoricalObjectReader>[1]
  >;
}>;

/** Uses the receipt's content hash. Scope and location are reconstructed by the reconciler and archive reader. */
export class AwsPutVersionEvidenceReconciliation {
  private readonly versions: AwsItemHistoricalObjectReader;
  private readonly archive: Configuration['evidenceArchive'];

  constructor(
    private readonly items: ItemStore,
    private readonly history: HistoryStore,
    private readonly evidenceClient: Client,
    objectClient: Client,
    config: Configuration,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.versions = new AwsItemHistoricalObjectReader(
      objectClient,
      config.objectVersions,
    );
    this.archive = Object.freeze({ ...config.evidenceArchive });
  }

  async reconcileAndRecord(
    input: PutVersionAuditInput,
    receipt: Readonly<{ evidenceHash: string }>,
    requiredThrough: string,
  ) {
    const { protocol, selection, expectedPermissionHash } = input;
    const pins = {
      expectedPermissionHash,
      expectedEvidenceHash: receipt.evidenceHash,
      requiredThrough,
    };
    switch (protocol) {
      case 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1':
        return new ItemHistoricalPutReconciler(
          this.items,
          this.reader(protocol),
          this.versions,
          this.now,
        ).reconcileAndRecord({ ...selection, ...pins });
      case 'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1':
        return new ItemStagingPutReconciler(
          this.items,
          this.reader(protocol),
          this.versions,
          this.now,
        ).reconcileAndRecord({ ...selection, ...pins });
      case 'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1':
        return new ItemRecipientFinalPutReconciler(
          this.items,
          this.reader(protocol),
          this.versions,
          this.now,
        ).reconcileAndRecord({ ...selection, ...pins });
      case 'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1':
        return new PublishedHistoryPutReconciler(
          this.history,
          this.reader(protocol),
          this.versions,
          this.now,
        ).reconcileAndRecord({ selection, ...pins });
      case 'PUBLISHED_HISTORY_STAGING_PUT_VERSION_EVIDENCE_V1':
        return new PublishedHistoryStagingPutReconciler(
          this.history,
          this.reader(protocol),
          this.versions,
          this.now,
        ).reconcileAndRecord({ selection, ...pins });
      case 'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1':
        return new PublishedHistoryFinalPutReconciler(
          this.history,
          this.reader(protocol),
          this.versions,
          this.now,
        ).reconcileAndRecord({ selection, ...pins });
      default:
        throw new ConflictError(
          'The PUT version evidence protocol is unsupported',
        );
    }
  }

  private reader<Protocol extends PutVersionEvidence['protocol']>(
    protocol: Protocol,
  ) {
    return new AwsPutVersionEvidenceReader(
      this.evidenceClient,
      this.archive,
      protocol,
    );
  }
}
