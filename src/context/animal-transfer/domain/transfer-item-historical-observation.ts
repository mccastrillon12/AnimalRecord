import { ObjectRevision } from './ownership-archive';
import {
  ItemArchiveCopyIntent,
  ItemHistoricalCopyObservation,
} from './transfer-item-copy-intent';

export type HistoricalReadTarget = Readonly<{
  bucket: string;
  key: string;
}>;
export type HistoricalReadRevision = {
  etag?: string;
  size?: number;
  versionId?: string;
};
export type HistoricalReadHead = HistoricalReadTarget & HistoricalReadRevision;
/** Trusted read-only collaborator: binds every request to the target bucket/key. */
export interface ItemHistoricalObjectReader {
  head(target: HistoricalReadTarget): Promise<HistoricalReadHead | null>;
  read(
    target: HistoricalReadTarget,
    revision: Readonly<ObjectRevision>,
  ): Promise<{
    revision: HistoricalReadRevision;
    body: AsyncIterable<Uint8Array>;
    close(): void;
  }>;
}
/** Evidence of reads relative to one definition; never a copy or business permission. */
export type ItemHistoricalByteObservation = Readonly<{
  protocol: 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1';
  binding: ItemArchiveCopyIntent['binding'];
  observation: Readonly<ItemHistoricalCopyObservation>;
  observationHash: string;
  bytes: 'MATCH';
  reservation: 'OBSERVED_ONLY';
  provenance: 'NOT_ASSESSED';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
