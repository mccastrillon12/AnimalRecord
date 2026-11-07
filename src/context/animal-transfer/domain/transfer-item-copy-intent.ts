import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  ArchiveFile,
  ObjectRevision,
  OwnershipArchive,
  archiveHash,
} from './ownership-archive';
import {
  ItemCaptureInput,
  ItemCaptureSnapshot,
  ItemCopyPreparationInspection,
  inspectItemCopyPreparation,
  itemCaptureInput,
} from './transfer-item-capture';

export const ITEM_ARCHIVE_COPY_INTENT_PROTOCOL =
  'ITEM_ARCHIVE_COPY_INTENT_V1' as const;
export type ItemHistoricalCopyPreparationInput = Readonly<{
  selector: ItemCaptureInput;
  fileId: string;
  expectedFileDefinitionHash: string;
  expectedSealHash: string;
  bucket: string;
  sourceSha256: string;
}>;
export type ItemHistoricalSourceAnchorInput = Readonly<{
  preparation: ItemHistoricalCopyPreparationInput;
  expectedManifestHash: string;
}>;
export type ItemHistoricalCopyPreparationReceipt = Readonly<{
  transferId: string;
  itemId: string;
  fileId: string;
  intentId: string;
  intentDefinitionHash: string;
  replayed: boolean;
  reservation: 'FENCED_AT_PREPARATION';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
export function historicalCopyPreparationInput(
  raw: ItemHistoricalCopyPreparationInput,
): ItemHistoricalCopyPreparationInput {
  if (
    !raw ||
    Object.keys(raw).sort().join(',') !==
      'bucket,expectedFileDefinitionHash,expectedSealHash,fileId,selector,sourceSha256' ||
    ![
      raw.fileId,
      raw.expectedFileDefinitionHash,
      raw.expectedSealHash,
      raw.sourceSha256,
    ].every(hashValid) ||
    typeof raw.bucket !== 'string' ||
    raw.bucket.length < 3 ||
    raw.bucket.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(raw.bucket)
  )
    throw new InvalidArgumentError('Invalid historical copy preparation input');
  return Object.freeze({ ...raw, selector: itemCaptureInput(raw.selector) });
}
export function historicalSourceAnchorInput(
  raw: ItemHistoricalSourceAnchorInput,
): ItemHistoricalSourceAnchorInput {
  if (
    !raw ||
    Object.keys(raw).sort().join(',') !== 'expectedManifestHash,preparation' ||
    !hashValid(raw.expectedManifestHash)
  )
    throw new InvalidArgumentError('Invalid historical source anchor input');
  return Object.freeze({
    preparation: historicalCopyPreparationInput(raw.preparation),
    expectedManifestHash: raw.expectedManifestHash,
  });
}
export type ItemCopyIntentContext = Readonly<{
  selector: ItemCaptureInput;
  snapshot: ItemCaptureSnapshot;
  file: ArchiveFile;
  /** Explicit backend inputs; their presence does not certify bytes or retention. */
  bucket: string;
  sourceSha256: string;
}>;
export type ItemArchiveCopyIntent = Readonly<{
  protocol: typeof ITEM_ARCHIVE_COPY_INTENT_PROTOCOL;
  id: string;
  kind: 'HISTORICAL' | 'RECIPIENT_STAGING';
  binding: Readonly<{
    transferId: string;
    itemId: string;
    requestVersion: number;
    observedSeal: ItemCopyPreparationInspection['observedSeal'];
    observedSealHash: string;
    fileId: string;
    fileDefinitionHash: string;
  }>;
  bucket: string;
  source: Readonly<{
    key: string;
    revision: Readonly<ObjectRevision>;
    sha256: string;
  }>;
  destination: Readonly<{ key: string; ifNoneMatch: '*' }>;
  predecessor?: Readonly<{
    intentId: string;
    intentDefinitionHash: string;
    observationHash: string;
  }>;
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
  definitionHash: string;
}>;
/** Rows matched in one local snapshot. The caller must still prove manifest membership. */
export type ItemHistoricalSourceAnchorMaterial = Readonly<{
  binding: ItemArchiveCopyIntent['binding'];
  manifestHash: string;
  intentId: string;
  intentDefinitionHash: string;
  sourceObservationHash: string;
  source: Readonly<{ bucket: string }> & ItemArchiveCopyIntent['source'];
}>;
/** Observation supplied by a trusted future collector, not an AWS receipt/authentication. */
export type ItemHistoricalCopyObservation = Readonly<{
  intentId: string;
  intentDefinitionHash: string;
  bucket: string;
  key: string;
  revision: ObjectRevision;
  sha256: string;
}>;

function fail(): never {
  throw new ConflictError('Item archive copy intent identity is inconsistent');
}
function hashValid(value: string) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function revisionText(value: string) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\r\n\0]/.test(value)
  );
}
export function isPinnedItemSourceVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    revisionText(value) &&
    value.trim().length > 0 &&
    value.trim().toLowerCase() !== 'null' &&
    Buffer.byteLength(value, 'utf8') <= 1024
  );
}
export function captureItemObjectRevision(
  value: ObjectRevision,
): Readonly<ObjectRevision> {
  if (
    !value ||
    Object.keys(value).some(
      (k) => !['etag', 'size', 'versionId'].includes(k),
    ) ||
    !revisionText(value.etag) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    (value.versionId !== undefined && !revisionText(value.versionId))
  )
    fail();
  return Object.freeze({
    etag: value.etag,
    size: value.size,
    ...(value.versionId === undefined ? {} : { versionId: value.versionId }),
  });
}
/** Immutable file projection shared by copy definitions and local manifest digestion.
 * The caller must validate the original header/reservation separately. */
export function captureItemArchiveFileDefinition(
  archive: OwnershipArchive,
  file: ArchiveFile,
) {
  const revision = captureItemObjectRevision(file.source);
  if (
    file.archiveId !== archive.id ||
    file.retained !== undefined ||
    !['PENDING', 'COPYING', 'VERIFIED'].includes(file.state) ||
    typeof file.relativeKey !== 'string' ||
    file.relativeKey.includes('\\') ||
    /[\r\n\0]/.test(file.relativeKey) ||
    file.relativeKey.split('/').some((p) => !p || p === '.' || p === '..') ||
    /^(ownership-archives|transfer-preparations|upload-intake|retained-history)\//.test(
      file.relativeKey,
    )
  )
    fail();
  const prefix = `users/${archive.ownerId}/animals/${archive.animalId}/`;
  const recipient = `users/${archive.recipientId}/animals/${archive.animalId}/`;
  const definition = {
    id: file.id,
    archiveId: file.archiveId,
    sourceKey: file.sourceKey,
    relativeKey: file.relativeKey,
    historicalKey: file.historicalKey,
    recipientStagingKey: file.recipientStagingKey,
    recipientFinalKey: file.recipientFinalKey,
    source: revision,
  };
  if (
    file.id !== archiveHash([archive.id, file.sourceKey]) ||
    file.definitionHash !== archiveHash(definition) ||
    file.sourceKey !== `${prefix}${file.relativeKey}` ||
    file.historicalKey !==
      `${prefix}ownership-archives/${archive.id}/${file.relativeKey}` ||
    file.recipientStagingKey !==
      `${recipient}transfer-preparations/${archive.id}/${file.relativeKey}` ||
    file.recipientFinalKey !== `${recipient}${file.relativeKey}`
  )
    fail();
  return Object.freeze(definition);
}
function finish(
  definition: Omit<ItemArchiveCopyIntent, 'id' | 'definitionHash'>,
): ItemArchiveCopyIntent {
  // One logical identity per leg. A future store must reject a changed definition
  // for this identity; a changed digest/bucket must never silently replace it.
  const id = archiveHash([
    definition.protocol,
    definition.binding.observedSealHash,
    definition.binding.fileId,
    definition.kind,
  ]);
  return Object.freeze({
    ...definition,
    id,
    definitionHash: archiveHash({ ...definition, id }),
  });
}

/** Pure local definition, without reads, persistence, fences, permission or dispatch. */
export function buildItemHistoricalCopyIntent(
  context: ItemCopyIntentContext,
): ItemArchiveCopyIntent {
  const { selector, snapshot, file, bucket, sourceSha256 } = context;
  const observation = inspectItemCopyPreparation(selector, snapshot);
  const archive = snapshot.archive!;
  const { source: revision } = captureItemArchiveFileDefinition(archive, file);
  if (
    typeof bucket !== 'string' ||
    bucket.length < 3 ||
    bucket.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) ||
    !hashValid(sourceSha256) ||
    archive.expectedFileCount! < 1
  )
    fail();
  return finish({
    protocol: ITEM_ARCHIVE_COPY_INTENT_PROTOCOL,
    kind: 'HISTORICAL',
    binding: Object.freeze({
      transferId: observation.transferId,
      itemId: observation.itemId,
      requestVersion: observation.requestVersion,
      observedSeal: observation.observedSeal,
      observedSealHash: observation.observedSealHash,
      fileId: file.id,
      fileDefinitionHash: file.definitionHash,
    }),
    bucket,
    source: Object.freeze({
      key: file.sourceKey,
      revision,
      sha256: sourceSha256,
    }),
    destination: Object.freeze({ key: file.historicalKey, ifNoneMatch: '*' }),
    stableCut: 'NOT_ASSESSED',
    retention: 'NOT_ASSESSED',
    copyDispatch: 'NOT_AUTHORIZED',
    businessCommit: 'NOT_AUTHORIZED',
  });
}

/** Describes the second leg from an explicit matching observation, never from file state. */
export function buildItemStagingCopyIntent(
  context: ItemCopyIntentContext,
  historical: ItemArchiveCopyIntent,
  observation: ItemHistoricalCopyObservation,
): ItemArchiveCopyIntent {
  const expected = buildItemHistoricalCopyIntent(context);
  if (
    !historical ||
    archiveHash(historical) !== archiveHash(expected) ||
    !observation ||
    Object.keys(observation).sort().join(',') !==
      'bucket,intentDefinitionHash,intentId,key,revision,sha256' ||
    observation.intentId !== expected.id ||
    observation.intentDefinitionHash !== expected.definitionHash ||
    observation.bucket !== expected.bucket ||
    observation.key !== expected.destination.key ||
    observation.sha256 !== expected.source.sha256
  )
    fail();
  const revision = captureItemObjectRevision(observation.revision);
  if (revision.size !== expected.source.revision.size) fail();
  const { id, definitionHash, ...definition } = expected;
  return finish({
    ...definition,
    kind: 'RECIPIENT_STAGING',
    source: Object.freeze({
      key: expected.destination.key,
      revision,
      sha256: observation.sha256,
    }),
    destination: Object.freeze({
      key: context.file.recipientStagingKey,
      ifNoneMatch: '*',
    }),
    predecessor: Object.freeze({
      intentId: id,
      intentDefinitionHash: definitionHash,
      observationHash: archiveHash({ ...observation, revision }),
    }),
  });
}
