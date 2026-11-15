import { ConflictError } from '../../shared/domain/errors/ConflictError';
import type { OwnershipArchiveHistoryRepository } from '../domain/ownership-archive-history';
import { publishedHistoryFinalPutVersionScope } from '../domain/published-history-final-reconciliation';
import { publishedHistoryPutVersionScope } from '../domain/published-history-put-reconciliation';
import { publishedHistoryStagingPutVersionScope } from '../domain/published-history-staging-reconciliation';
import type { ItemCopyRecordStore } from '../domain/transfer-item-copy-record';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  historicalPutEvidenceTime,
  historicalPutVersionScope,
  type ItemHistoricalPutVersionScope,
  type PutVersionEvidence,
} from '../domain/transfer-item-historical-put-reconciliation';
import {
  recipientFinalPutVersionScope,
  stagingPutVersionScope,
} from '../domain/transfer-item-staging-put-reconciliation';

type ItemReads = Pick<
  ItemCopyRecordStore,
  | 'readHistoricalPutReconciliationContext'
  | 'readStagingPutReconciliationContext'
  | 'readRecipientFinalPutReconciliationContext'
>;
type HistoryReads = Required<
  Pick<
    OwnershipArchiveHistoryRepository,
    | 'readPublishedCopyVersionContext'
    | 'readPublishedStagingVersionContext'
    | 'readPublishedFinalVersionContext'
  >
>;
type SelectionByProtocol = {
  ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1: Parameters<
    ItemReads['readHistoricalPutReconciliationContext']
  >[0];
  ITEM_STAGING_PUT_VERSION_EVIDENCE_V1: Parameters<
    ItemReads['readStagingPutReconciliationContext']
  >[0];
  ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1: Parameters<
    ItemReads['readRecipientFinalPutReconciliationContext']
  >[0];
  PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1: Parameters<
    HistoryReads['readPublishedCopyVersionContext']
  >[0];
  PUBLISHED_HISTORY_STAGING_PUT_VERSION_EVIDENCE_V1: Parameters<
    HistoryReads['readPublishedStagingVersionContext']
  >[0];
  PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1: Parameters<
    HistoryReads['readPublishedFinalVersionContext']
  >[0];
};
type Protocol = PutVersionEvidence['protocol'];
export type PutVersionAuditInput = {
  [P in Protocol]: Readonly<{
    protocol: P;
    selection: SelectionByProtocol[P];
    expectedPermissionHash: string;
  }>;
}[Protocol];

export type PutVersionAuditSelection = Readonly<{
  protocol: Protocol;
  scope: ItemHistoricalPutVersionScope;
  admittedAt: string;
  auditMarkerHash: string;
}>;

const invalid = () =>
  new ConflictError(
    'The audit selection does not match the recorded PUT permission',
  );

/** Selects one locally recorded PUT, without reading storage or acquiring permission. */
export class PutVersionAuditSelectionReader {
  constructor(
    private readonly items: ItemReads,
    private readonly history: HistoryReads,
  ) {}

  async read(
    input: PutVersionAuditInput,
  ): Promise<PutVersionAuditSelection | null> {
    const { protocol, selection, expectedPermissionHash } = input;
    if (!sourceHashValid(expectedPermissionHash)) throw invalid();
    switch (protocol) {
      case 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1':
        return this.select(
          protocol,
          expectedPermissionHash,
          await this.items.readHistoricalPutReconciliationContext(selection),
          historicalPutVersionScope,
        );
      case 'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1':
        return this.select(
          protocol,
          expectedPermissionHash,
          await this.items.readStagingPutReconciliationContext(selection),
          stagingPutVersionScope,
        );
      case 'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1':
        return this.select(
          protocol,
          expectedPermissionHash,
          await this.items.readRecipientFinalPutReconciliationContext(
            selection,
          ),
          recipientFinalPutVersionScope,
        );
      case 'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1':
        return this.select(
          protocol,
          expectedPermissionHash,
          await this.history.readPublishedCopyVersionContext(selection),
          publishedHistoryPutVersionScope,
        );
      case 'PUBLISHED_HISTORY_STAGING_PUT_VERSION_EVIDENCE_V1':
        return this.select(
          protocol,
          expectedPermissionHash,
          await this.history.readPublishedStagingVersionContext(selection),
          publishedHistoryStagingPutVersionScope,
        );
      case 'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1':
        return this.select(
          protocol,
          expectedPermissionHash,
          await this.history.readPublishedFinalVersionContext(selection),
          publishedHistoryFinalPutVersionScope,
        );
      default:
        throw invalid();
    }
  }

  private select<
    Context extends Readonly<{
      permission: Readonly<{
        permissionHash: string;
        admittedAt: string;
        auditMarkerHash?: string;
      }>;
    }>,
  >(
    protocol: Protocol,
    expectedPermissionHash: string,
    context: Context | null,
    scopeFor: (value: Context) => ItemHistoricalPutVersionScope,
  ): PutVersionAuditSelection | null {
    if (
      !context ||
      context.permission.permissionHash !== expectedPermissionHash
    )
      throw invalid();
    const scope = scopeFor(context);
    const { admittedAt, auditMarkerHash } = context.permission;
    if (auditMarkerHash === undefined) return null;
    if (!sourceHashValid(auditMarkerHash)) throw invalid();
    historicalPutEvidenceTime(admittedAt);
    return Object.freeze({ protocol, scope, admittedAt, auditMarkerHash });
  }
}
