import type { S3Client } from '@aws-sdk/client-s3';
import type {
  PutVersionAuditInput,
  PutVersionAuditSelectionReader,
} from '../../application/put-version-audit-selection';
import { PutVersionEvidenceProducer } from '../../application/put-version-evidence-producer';
import { historicalPutEvidenceTime } from '../../domain/transfer-item-historical-put-reconciliation';
import { AwsItemHistoricalObjectReader } from './aws-item-historical-object-reader';
import { AwsPutVersionEvidencePublisher } from './aws-put-version-evidence-reader';
import { AwsS3CreatedPutNotifications } from './aws-s3-created-put-notifications';
import {
  AwsPutVersionProvenanceReader,
  AwsS3PutAuditReader,
} from './aws-s3-put-audit';

type Client = Pick<S3Client, 'send'>;
type Clients = Readonly<{
  notificationArchive: Client;
  objectVersions: Client;
  evidenceArchive: Client;
}>;
type Configuration = Readonly<{
  notificationArchive: ConstructorParameters<
    typeof AwsS3CreatedPutNotifications
  >[1];
  evidenceArchive: ConstructorParameters<
    typeof AwsPutVersionEvidencePublisher
  >[1];
  conservationControlsHash: string;
}>;

/** Publishes evidence for one recorded PUT. Clients are configured and owned by the caller. */
export class AwsPutVersionEvidencePublication {
  private readonly audit: AwsS3PutAuditReader;
  private readonly versions: AwsItemHistoricalObjectReader;
  private readonly archive: Configuration['evidenceArchive'];
  private readonly conservationControlsHash: string;
  private readonly evidenceClient: Client;

  constructor(
    private readonly selections: PutVersionAuditSelectionReader,
    clients: Clients,
    config: Configuration,
    private readonly now: () => Date = () => new Date(),
  ) {
    const notifications = new AwsS3CreatedPutNotifications(
      clients.notificationArchive,
      config.notificationArchive,
    );
    this.audit = new AwsS3PutAuditReader(notifications, clients.objectVersions);
    this.versions = new AwsItemHistoricalObjectReader(clients.objectVersions, {
      bucket: config.notificationArchive.sourceBucket,
      expectedBucketOwner: config.notificationArchive.sourceBucketOwner,
    });
    this.archive = Object.freeze({ ...config.evidenceArchive });
    this.conservationControlsHash = config.conservationControlsHash;
    this.evidenceClient = clients.evidenceArchive;
  }

  async publish(input: PutVersionAuditInput, requiredThrough: string) {
    historicalPutEvidenceTime(requiredThrough);
    const selection = await this.selections.read(input);
    if (!selection) return null;

    const producer = new PutVersionEvidenceProducer(
      new AwsPutVersionProvenanceReader(this.audit, selection),
      this.versions,
      {
        issuerId: this.archive.issuerId,
        conservationControlsHash: this.conservationControlsHash,
      },
      this.now,
    );
    const publisher = new AwsPutVersionEvidencePublisher(
      this.evidenceClient,
      this.archive,
      selection.protocol,
      producer,
    );
    return publisher.publish(selection.scope, requiredThrough);
  }
}
