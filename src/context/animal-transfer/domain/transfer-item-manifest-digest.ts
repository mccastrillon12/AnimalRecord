import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  ArchiveEntry,
  ArchiveFile,
  ArchiveRecordInput,
  archiveHash,
  buildArchiveEntry,
} from './ownership-archive';
import {
  ItemCaptureInput,
  ItemCaptureSnapshot,
  ItemCopyPreparationInspection,
  inspectItemCopyPreparation,
  itemCaptureInput,
} from './transfer-item-capture';
import { captureItemArchiveFileDefinition } from './transfer-item-copy-intent';

export const ITEM_MANIFEST_DIGEST_PROTOCOL = 'ITEM_MANIFEST_DIGEST_V1' as const;
export const ITEM_MANIFEST_PAGE_SIZE = 100;
export type ItemManifestDigestInput = Readonly<{
  selector: ItemCaptureInput;
  expectedSealHash: string;
}>;
export type ItemManifestCursor = Readonly<{
  phase: 'ENTRIES' | 'FILES' | 'COMPLETE';
  afterId?: string;
  limit: typeof ITEM_MANIFEST_PAGE_SIZE;
}>;
export type ItemManifestReadInput = ItemManifestDigestInput &
  Readonly<{ cursor: ItemManifestCursor }>;
export type ItemManifestPage = Readonly<{ snapshot: ItemCaptureSnapshot }> &
  (
    | Readonly<{ phase: 'ENTRIES'; rows: readonly ArchiveEntry[] }>
    | Readonly<{ phase: 'FILES'; rows: readonly ArchiveFile[] }>
    | Readonly<{ phase: 'COMPLETE' }>
  );

export function itemManifestDigestInput(
  raw: ItemManifestDigestInput,
): ItemManifestDigestInput {
  if (
    !raw ||
    Object.keys(raw).sort().join(',') !== 'expectedSealHash,selector' ||
    !hash(raw.expectedSealHash)
  )
    throw new InvalidArgumentError('Invalid item manifest digest input');
  return Object.freeze({
    selector: itemCaptureInput(raw.selector),
    expectedSealHash: raw.expectedSealHash,
  });
}
export function itemManifestReadInput(
  raw: ItemManifestReadInput,
): ItemManifestReadInput {
  if (
    !raw ||
    Object.keys(raw).sort().join(',') !== 'cursor,expectedSealHash,selector' ||
    !raw.cursor ||
    Object.keys(raw.cursor).some(
      (key) => !['phase', 'afterId', 'limit'].includes(key),
    ) ||
    !['ENTRIES', 'FILES', 'COMPLETE'].includes(raw.cursor.phase) ||
    raw.cursor.limit !== ITEM_MANIFEST_PAGE_SIZE ||
    (raw.cursor.afterId !== undefined &&
      (!hash(raw.cursor.afterId) || raw.cursor.phase === 'COMPLETE'))
  )
    throw new InvalidArgumentError('Invalid item manifest read input');
  return Object.freeze({
    ...itemManifestDigestInput({
      selector: raw.selector,
      expectedSealHash: raw.expectedSealHash,
    }),
    cursor: Object.freeze({ ...raw.cursor }),
  });
}
export type ItemManifestDigestResult = Readonly<{
  protocol: typeof ITEM_MANIFEST_DIGEST_PROTOCOL;
  binding: Readonly<
    Pick<
      ItemCopyPreparationInspection,
      | 'transferId'
      | 'itemId'
      | 'requestVersion'
      | 'observedSeal'
      | 'observedSealHash'
    >
  >;
  entryCount: number;
  fileCount: number;
  entriesDigest: string;
  filesDigest: string;
  manifestHash: string;
  integrity: 'DECLARED_COUNTS_AND_BINDINGS_MATCH';
  reservation: 'OBSERVED_ONLY';
  provenance: 'NOT_ASSESSED';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
export type ItemManifestPreparationReceipt = Readonly<{
  transferId: string;
  itemId: string;
  archiveId: string;
  manifestHash: string;
  entryCount: number;
  fileCount: number;
  replayed: boolean;
  reservation: 'FENCED_AT_PREPARATION';
  provenance: 'NOT_ASSESSED';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
}>;
const conflict = () =>
  new ConflictError('Item manifest traversal integrity is inconsistent');
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

function keys(value: unknown, expected: string[]) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',')
  );
}
/** Shape/hash capture for a trusted collector; does not authenticate that rows were read. */
export function captureItemManifestDigest(
  raw: ItemManifestDigestResult,
): ItemManifestDigestResult {
  if (
    !keys(raw, [
      'protocol',
      'binding',
      'entryCount',
      'fileCount',
      'entriesDigest',
      'filesDigest',
      'manifestHash',
      'integrity',
      'reservation',
      'provenance',
      'stableCut',
      'retention',
      'copyDispatch',
      'businessCommit',
    ]) ||
    raw.protocol !== ITEM_MANIFEST_DIGEST_PROTOCOL ||
    raw.integrity !== 'DECLARED_COUNTS_AND_BINDINGS_MATCH' ||
    raw.reservation !== 'OBSERVED_ONLY' ||
    raw.provenance !== 'NOT_ASSESSED' ||
    raw.stableCut !== 'NOT_ASSESSED' ||
    raw.retention !== 'NOT_ASSESSED' ||
    raw.copyDispatch !== 'NOT_AUTHORIZED' ||
    raw.businessCommit !== 'NOT_AUTHORIZED' ||
    !Number.isSafeInteger(raw.entryCount) ||
    raw.entryCount < 1 ||
    !Number.isSafeInteger(raw.fileCount) ||
    raw.fileCount < 0 ||
    ![raw.entriesDigest, raw.filesDigest, raw.manifestHash].every(hash) ||
    !keys(raw.binding, [
      'transferId',
      'itemId',
      'requestVersion',
      'observedSeal',
      'observedSealHash',
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
    ])
  )
    throw conflict();
  const binding = raw.binding,
    seal = binding.observedSeal;
  if (
    ![binding.transferId, binding.itemId, seal.archiveId].every(
      (v) => typeof v === 'string' && v.length > 0,
    ) ||
    ![
      binding.observedSealHash,
      seal.acceptanceBindingHash,
      seal.definitionHash,
      seal.reservationBindingHash,
    ].every(hash) ||
    !Number.isSafeInteger(binding.requestVersion) ||
    binding.requestVersion < 2 ||
    !Number.isSafeInteger(seal.reservationEpoch) ||
    seal.reservationEpoch < 1 ||
    !Number.isSafeInteger(seal.captureRevision) ||
    seal.captureRevision < 0 ||
    seal.expectedEntryCount !== raw.entryCount ||
    seal.expectedFileCount !== raw.fileCount ||
    (raw.fileCount === 0) !==
      (raw.filesDigest ===
        archiveHash([ITEM_MANIFEST_DIGEST_PROTOCOL, 'FILES'])) ||
    raw.entriesDigest ===
      archiveHash([ITEM_MANIFEST_DIGEST_PROTOCOL, 'ENTRIES'])
  )
    throw conflict();
  const copy = structuredClone(raw),
    { manifestHash, ...definition } = copy;
  if (
    manifestHash !== archiveHash(definition) ||
    copy.binding.observedSealHash !==
      archiveHash({
        protocol: 'ITEM_COPY_PREPARATION_OBSERVATION_V1',
        transferId: copy.binding.transferId,
        itemId: copy.binding.itemId,
        requestVersion: copy.binding.requestVersion,
        observedSeal: copy.binding.observedSeal,
      })
  )
    throw conflict();
  Object.freeze(copy.binding.observedSeal);
  Object.freeze(copy.binding);
  return Object.freeze(copy);
}

export function matchItemManifestDigest(
  input: ItemManifestDigestInput,
  snapshot: ItemCaptureSnapshot,
  raw: ItemManifestDigestResult,
) {
  const observed = captureItemManifestDigest(raw);
  const inspection = inspectItemCopyPreparation(input.selector, snapshot);
  const expected = {
    transferId: inspection.transferId,
    itemId: inspection.itemId,
    requestVersion: inspection.requestVersion,
    observedSeal: inspection.observedSeal,
    observedSealHash: inspection.observedSealHash,
  };
  if (
    inspection.observedSealHash !== input.expectedSealHash ||
    archiveHash(expected) !== archiveHash(observed.binding)
  )
    throw conflict();
  return observed;
}

/** Pure, process-local traversal. No reader, checkpoint import, persistence or permission.
 * Snapshots/rows must come from a trusted future reader; this is not authentication.
 * Memory is O(distinct referenced files), not O(payloads) and not constant space. */
export class ItemManifestDigest {
  private readonly input: ItemManifestDigestInput;
  private readonly archive: NonNullable<ItemCaptureSnapshot['archive']>;
  private readonly binding: ItemManifestDigestResult['binding'];
  private phase: 'ENTRIES' | 'FILES' | 'COMPLETE' = 'ENTRIES';
  private afterId?: string;
  private entryCount = 0;
  private animalCount = 0;
  private fileCount = 0;
  private entriesDigest = archiveHash([
    ITEM_MANIFEST_DIGEST_PROTOCOL,
    'ENTRIES',
  ]);
  private filesDigest = archiveHash([ITEM_MANIFEST_DIGEST_PROTOCOL, 'FILES']);
  private readonly referenced = new Map<string, string>();
  private result?: ItemManifestDigestResult;

  constructor(
    raw: ItemManifestDigestInput,
    snapshot: ItemCaptureSnapshot,
    private readonly keyFromUrl: (url: string) => string | undefined,
  ) {
    this.input = itemManifestDigestInput(raw);
    const inspection = this.check(snapshot);
    this.archive = Object.freeze(structuredClone(snapshot.archive!));
    this.binding = Object.freeze({
      transferId: inspection.transferId,
      itemId: inspection.itemId,
      requestVersion: inspection.requestVersion,
      observedSeal: inspection.observedSeal,
      observedSealHash: inspection.observedSealHash,
    });
  }
  /** Each phase ends only after an actual empty page, including short and zero-file cuts. */
  get nextPage(): ItemManifestCursor {
    return Object.freeze({
      phase: this.phase,
      afterId: this.afterId,
      limit: ITEM_MANIFEST_PAGE_SIZE,
    });
  }
  private check(snapshot: ItemCaptureSnapshot) {
    const inspection = inspectItemCopyPreparation(
      this.input.selector,
      snapshot,
    );
    if (inspection.observedSealHash !== this.input.expectedSealHash)
      throw conflict();
    return inspection;
  }
  private page(
    snapshot: ItemCaptureSnapshot,
    phase: 'ENTRIES' | 'FILES',
    rows: readonly unknown[],
  ) {
    this.check(snapshot);
    if (
      this.phase !== phase ||
      !Array.isArray(rows) ||
      rows.length > ITEM_MANIFEST_PAGE_SIZE
    )
      throw conflict();
  }
  appendEntries(
    snapshot: ItemCaptureSnapshot,
    rows: readonly ArchiveEntry[],
  ): void {
    this.page(snapshot, 'ENTRIES', rows);
    if (!rows.length) {
      if (
        this.entryCount !== this.archive.expectedEntryCount ||
        this.animalCount !== 1 ||
        this.referenced.size !== this.archive.expectedFileCount
      )
        throw conflict();
      this.phase = 'FILES';
      this.afterId = undefined;
      return;
    }
    // Validate the entire page before advancing any digest, cursor or reference set.
    let after = this.afterId,
      digest = this.entriesDigest,
      animals = this.animalCount;
    const pending = new Map<string, string>();
    try {
      for (const raw of rows) {
        const entry = structuredClone(raw);
        if (
          !entry ||
          !hash(entry.id) ||
          (after !== undefined && entry.id <= after) ||
          entry.archiveId !== this.archive.id ||
          entry.retained !== undefined ||
          !['ANIMAL', 'DIARY_ENTRY', 'MEDICAL_DOCUMENT'].includes(entry.kind)
        )
          throw conflict();
        const rebuilt = buildArchiveEntry(
          this.archive,
          { kind: entry.kind, data: entry.payload } as ArchiveRecordInput,
          this.keyFromUrl,
        );
        if (
          entry.id !== rebuilt.entry.id ||
          entry.resourceId !== rebuilt.entry.resourceId ||
          entry.contentHash !== rebuilt.entry.contentHash ||
          archiveHash(entry.fileBindings) !==
            archiveHash(rebuilt.entry.fileBindings)
        )
          throw conflict();
        if (entry.kind === 'ANIMAL') animals++;
        for (const definition of rebuilt.files) {
          const expected = archiveHash(definition),
            existing =
              pending.get(definition.id) ?? this.referenced.get(definition.id);
          if (existing !== undefined && existing !== expected) throw conflict();
          pending.set(definition.id, expected);
        }
        digest = archiveHash({
          previous: digest,
          id: entry.id,
          contentHash: entry.contentHash,
        });
        after = entry.id;
      }
    } catch {
      throw conflict();
    }
    if (
      this.entryCount + rows.length > this.archive.expectedEntryCount! ||
      animals > 1 ||
      this.referenced.size +
        [...pending.keys()].filter((id) => !this.referenced.has(id)).length >
        this.archive.expectedFileCount!
    )
      throw conflict();
    for (const [id, definition] of pending) this.referenced.set(id, definition);
    this.entriesDigest = digest;
    this.entryCount += rows.length;
    this.animalCount = animals;
    this.afterId = after;
  }
  appendFiles(
    snapshot: ItemCaptureSnapshot,
    rows: readonly ArchiveFile[],
  ): void {
    this.page(snapshot, 'FILES', rows);
    if (!rows.length) {
      if (this.fileCount !== this.archive.expectedFileCount) throw conflict();
      this.phase = 'COMPLETE';
      this.afterId = undefined;
      return;
    }
    let after = this.afterId,
      digest = this.filesDigest;
    try {
      for (const raw of rows) {
        const file = structuredClone(raw);
        if (
          !file ||
          !hash(file.id) ||
          (after !== undefined && file.id <= after)
        )
          throw conflict();
        const definition = captureItemArchiveFileDefinition(this.archive, file);
        const paths = Object.fromEntries(
          Object.entries(definition).filter(([key]) => key !== 'source'),
        );
        if (this.referenced.get(file.id) !== archiveHash(paths))
          throw conflict();
        digest = archiveHash({
          previous: digest,
          id: file.id,
          definitionHash: file.definitionHash,
        });
        after = file.id;
      }
    } catch {
      throw conflict();
    }
    if (this.fileCount + rows.length > this.archive.expectedFileCount!)
      throw conflict();
    this.filesDigest = digest;
    this.fileCount += rows.length;
    this.afterId = after;
  }
  finish(snapshot: ItemCaptureSnapshot): ItemManifestDigestResult {
    this.check(snapshot);
    if (this.phase !== 'COMPLETE') throw conflict();
    if (!this.result) {
      const definition = {
        protocol: ITEM_MANIFEST_DIGEST_PROTOCOL,
        binding: this.binding,
        entryCount: this.entryCount,
        fileCount: this.fileCount,
        entriesDigest: this.entriesDigest,
        filesDigest: this.filesDigest,
        integrity: 'DECLARED_COUNTS_AND_BINDINGS_MATCH' as const,
        reservation: 'OBSERVED_ONLY' as const,
        provenance: 'NOT_ASSESSED' as const,
        stableCut: 'NOT_ASSESSED' as const,
        retention: 'NOT_ASSESSED' as const,
        copyDispatch: 'NOT_AUTHORIZED' as const,
        businessCommit: 'NOT_AUTHORIZED' as const,
      };
      this.result = Object.freeze({
        ...definition,
        manifestHash: archiveHash(definition),
      });
    }
    return this.result;
  }
}
