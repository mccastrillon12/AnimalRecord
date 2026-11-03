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
const conflict = () =>
  new ConflictError('Item manifest traversal integrity is inconsistent');
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

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
    if (
      !raw ||
      Object.keys(raw).sort().join(',') !== 'expectedSealHash,selector' ||
      !hash(raw.expectedSealHash)
    )
      throw new InvalidArgumentError('Invalid item manifest digest input');
    this.input = Object.freeze({
      selector: itemCaptureInput(raw.selector),
      expectedSealHash: raw.expectedSealHash,
    });
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
  get nextPage() {
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
