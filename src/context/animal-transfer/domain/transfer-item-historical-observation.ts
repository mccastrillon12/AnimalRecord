import { ObjectRevision, archiveHash } from './ownership-archive';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  ItemArchiveCopyIntent,
  ItemHistoricalCopyObservation,
  ItemCopyIntentContext,
  buildItemHistoricalCopyIntent,
  buildItemStagingCopyIntent,
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
/** Reads of the original manifest revision, distinct from the historical destination.
 * Cannot be consumed as historical verification or as a staging predecessor. */
export type ItemSourceByteObservation = Omit<
  ItemHistoricalByteObservation,
  'protocol'
> &
  Readonly<{
    protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1';
  }>;

export type ItemStagingCopyPreparationReceipt = Readonly<{
  transferId: string;
  itemId: string;
  fileId: string;
  intentId: string;
  intentDefinitionHash: string;
  observationHash: string;
  replayed: boolean;
  reservation: 'FENCED_AT_PREPARATION';
  provenance: 'NOT_ASSESSED';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
/** Same minimal receipt shape; intent identifies the original historical intent. */
export type ItemSourceObservationReceipt = ItemStagingCopyPreparationReceipt;

const invalid = () =>
  new ConflictError('Historical byte observation identity is inconsistent');
function keys(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const names = Object.keys(value);
  return (
    required.every((k) => names.includes(k)) &&
    names.every((k) => [...required, ...optional].includes(k))
  );
}
/** Shape/identity capture, not authentication that a trusted collector read bytes. */
export function captureHistoricalByteObservation(
  raw: ItemHistoricalByteObservation,
): ItemHistoricalByteObservation {
  return captureByteObservation(
    raw,
    'ITEM_HISTORICAL_BYTE_OBSERVATION_V1',
    invalid,
  );
}
const invalidSource = () =>
  new ConflictError('Source byte observation identity is inconsistent');
export function captureSourceByteObservation(
  raw: ItemSourceByteObservation,
): ItemSourceByteObservation {
  return captureByteObservation(
    raw,
    'ITEM_SOURCE_BYTE_OBSERVATION_V1',
    invalidSource,
  );
}
function captureByteObservation<
  T extends ItemHistoricalByteObservation | ItemSourceByteObservation,
>(raw: T, protocol: T['protocol'], invalid: () => ConflictError): T {
  if (
    !raw ||
    !keys(raw, [
      'protocol',
      'binding',
      'observation',
      'observationHash',
      'bytes',
      'reservation',
      'provenance',
      'stableCut',
      'retention',
      'copyDispatch',
      'businessCommit',
    ]) ||
    raw.protocol !== protocol ||
    raw.bytes !== 'MATCH' ||
    raw.reservation !== 'OBSERVED_ONLY' ||
    raw.provenance !== 'NOT_ASSESSED' ||
    raw.stableCut !== 'NOT_ASSESSED' ||
    raw.retention !== 'NOT_ASSESSED' ||
    raw.copyDispatch !== 'NOT_AUTHORIZED' ||
    raw.businessCommit !== 'NOT_AUTHORIZED' ||
    !keys(raw.binding, [
      'transferId',
      'itemId',
      'requestVersion',
      'observedSeal',
      'observedSealHash',
      'fileId',
      'fileDefinitionHash',
    ]) ||
    !keys(raw.binding.observedSeal, [
      'acceptanceBindingHash',
      'archiveId',
      'definitionHash',
      'reservationBindingHash',
      'reservationEpoch',
      'captureRevision',
      'expectedEntryCount',
      'expectedFileCount',
    ]) ||
    !keys(raw.observation, [
      'intentId',
      'intentDefinitionHash',
      'bucket',
      'key',
      'revision',
      'sha256',
    ]) ||
    !keys(raw.observation.revision, ['etag', 'size'], ['versionId'])
  )
    throw invalid();
  const primitives = [
    raw.observationHash,
    ...Object.entries(raw.binding)
      .filter(([k]) => k !== 'observedSeal')
      .map(([, v]) => v),
    ...Object.values(raw.binding.observedSeal),
    ...Object.entries(raw.observation)
      .filter(([k]) => k !== 'revision')
      .map(([, v]) => v),
    ...Object.values(raw.observation.revision),
  ];
  if (
    primitives.some(
      (v) =>
        v !== undefined &&
        typeof v !== 'string' &&
        !(typeof v === 'number' && Number.isSafeInteger(v)),
    )
  )
    throw invalid();
  const copy = structuredClone(raw);
  if (copy.observationHash !== archiveHash(copy.observation)) throw invalid();
  Object.freeze(copy.binding.observedSeal);
  Object.freeze(copy.binding);
  Object.freeze(copy.observation.revision);
  Object.freeze(copy.observation);
  return Object.freeze(copy);
}

/** Trust boundary is the collector; identity capture does not authenticate JSON. */
export function matchSourceByteObservation(
  context: ItemCopyIntentContext,
  raw: ItemSourceByteObservation,
): ItemSourceByteObservation {
  const observation = captureSourceByteObservation(raw);
  const intent = buildItemHistoricalCopyIntent(context);
  if (
    context.file.historicalCopyIntent === undefined ||
    archiveHash(context.file.historicalCopyIntent) !== archiveHash(intent) ||
    archiveHash(observation.binding) !== archiveHash(intent.binding) ||
    archiveHash(observation.observation) !==
      archiveHash({
        intentId: intent.id,
        intentDefinitionHash: intent.definitionHash,
        bucket: intent.bucket,
        key: intent.source.key,
        revision: intent.source.revision,
        sha256: intent.source.sha256,
      })
  )
    throw invalidSource();
  return observation;
}

/** Recompute from current persisted context; a self-consistent JSON hash is not permission. */
export function buildStagingCopyPreparation(
  context: ItemCopyIntentContext,
  raw: ItemHistoricalByteObservation,
) {
  const observation = captureHistoricalByteObservation(raw);
  const historical = buildItemHistoricalCopyIntent(context);
  if (
    context.file.historicalCopyIntent === undefined ||
    archiveHash(context.file.historicalCopyIntent) !==
      archiveHash(historical) ||
    archiveHash(observation.binding) !== archiveHash(historical.binding)
  )
    throw invalid();
  const intent = buildItemStagingCopyIntent(
    context,
    historical,
    observation.observation,
  );
  return Object.freeze({ observation, intent });
}
