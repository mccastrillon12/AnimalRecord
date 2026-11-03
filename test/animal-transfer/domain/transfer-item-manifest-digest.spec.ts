import {
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
  buildArchiveEntry,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ItemCaptureSnapshot,
  inspectItemCopyPreparation,
} from '../../../src/context/animal-transfer/domain/transfer-item-capture';
import { ItemManifestDigest } from '../../../src/context/animal-transfer/domain/transfer-item-manifest-digest';
import { captureItemArchiveFileDefinition } from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';

async function fixture(count = 1, withFiles = true, shared = false) {
  const f = await historicalCopyPreparationFixture();
  const selector = f.input.selector;
  const archive = f.state.db.archives.find(
    (a) => a.id === f.state.db.files[0].archiveId,
  )! as unknown as OwnershipArchive;
  const keyFromUrl = (url: string) =>
    url.startsWith('https://test/') ? url.slice(13) : undefined;
  const prefix = `users/${archive.ownerId}/animals/${archive.animalId}/`;
  const animal = buildArchiveEntry(
    archive,
    {
      kind: 'ANIMAL',
      data: {
        ...archiveAnimal,
        id: archive.animalId,
        ownerId: archive.ownerId,
        ...(withFiles
          ? { profilePictureUrl: `https://test/${prefix}profile/photo.jpg` }
          : {}),
      },
    },
    keyFromUrl,
  );
  const built = [
    animal,
    ...Array.from({ length: count - 1 }, (_, i) =>
      buildArchiveEntry(
        archive,
        {
          kind: 'DIARY_ENTRY',
          data: {
            id: f.id(300 + i),
            animalId: archive.animalId,
            title: `Entry ${i}`,
            date: '2026-01-01',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
            attachments: withFiles
              ? [
                  {
                    id: f.id(700 + i),
                    fileName: 'photo.jpg',
                    fileType: 'image',
                    mimeType: 'image/jpeg',
                    size: 12,
                    createdAt: '2026-01-01',
                    url: `https://test/${prefix}${shared ? 'profile/photo.jpg' : `diary/${i}.jpg`}`,
                  },
                ]
              : [],
          },
        },
        keyFromUrl,
      ),
    ),
  ];
  const files = new Map<string, ArchiveFile>();
  for (const row of built)
    for (const file of row.files) {
      const definition = {
        ...file,
        source: { etag: 'source', size: 12, versionId: 'v1' },
      };
      files.set(file.id, {
        ...definition,
        definitionHash: archiveHash(definition),
        state: 'PENDING',
      });
    }
  archive.expectedEntryCount = count;
  archive.capture!.entryCount = count;
  archive.expectedFileCount = files.size;
  const snapshot = {
    request: f.state.db.requests[0],
    item: f.state.db.items.find((i) => i._id === selector.itemId),
    claim: f.state.db.claims.find((c) => c._id === archive.animalId),
    archive,
    control: f.state.db.controls.find((c) => c.animalId === archive.animalId),
  } as ItemCaptureSnapshot;
  const input = {
    selector: { ...selector },
    expectedSealHash: inspectItemCopyPreparation(selector, snapshot)
      .observedSealHash,
  };
  const entries = built
    .map((b) => b.entry)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const manifest = [...files.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const create = () => new ItemManifestDigest(input, snapshot, keyFromUrl);
  const complete = (digest = create(), size = 100) => {
    for (let i = 0; i < entries.length; i += size)
      digest.appendEntries(snapshot, entries.slice(i, i + size));
    digest.appendEntries(snapshot, []);
    for (let i = 0; i < manifest.length; i += size)
      digest.appendFiles(snapshot, manifest.slice(i, i + size));
    digest.appendFiles(snapshot, []);
    return digest.finish(snapshot);
  };
  return {
    f,
    snapshot,
    input,
    archive,
    entries,
    files: manifest,
    create,
    complete,
    keyFromUrl,
  };
}

describe('Pure local item manifest traversal; no reader, persistence or permission', () => {
  it('binds the completed digest to the original seal without changing inputs or calling a store', async () => {
    const t = await fixture(3),
      before = structuredClone(t.snapshot),
      calls = t.f.calls.length;
    const result = t.complete();
    expect(result).toMatchObject({
      protocol: 'ITEM_MANIFEST_DIGEST_V1',
      entryCount: 3,
      fileCount: 3,
      binding: {
        itemId: t.input.selector.itemId,
        observedSealHash: t.input.expectedSealHash,
      },
      integrity: 'DECLARED_COUNTS_AND_BINDINGS_MATCH',
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    const { manifestHash, ...definition } = result;
    expect(manifestHash).toBe(archiveHash(definition));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.binding)).toBe(true);
    expect(Object.isFrozen(result.binding.observedSeal)).toBe(true);
    expect(t.snapshot).toEqual(before);
    expect(t.f.calls).toHaveLength(calls);
    expect(JSON.stringify(result)).not.toMatch(
      /users\/|Brownie|payload|leaseToken|sourceKey|sha256/,
    );
  });
  it('has identical digests beyond 100 rows for different page boundaries and never closes a short page', async () => {
    const t = await fixture(203),
      large = t.create(),
      small = t.create();
    large.appendEntries(t.snapshot, t.entries.slice(0, 100));
    expect(large.nextPage).toEqual({
      phase: 'ENTRIES',
      afterId: t.entries[99].id,
      limit: 100,
    });
    large.appendEntries(t.snapshot, t.entries.slice(100, 200));
    large.appendEntries(t.snapshot, t.entries.slice(200));
    expect(() => large.finish(t.snapshot)).toThrow('integrity');
    large.appendEntries(t.snapshot, []);
    for (let i = 0; i < t.files.length; i += 100)
      large.appendFiles(t.snapshot, t.files.slice(i, i + 100));
    expect(large.nextPage.phase).toBe('FILES');
    expect(() => large.finish(t.snapshot)).toThrow('integrity');
    large.appendFiles(t.snapshot, []);
    expect(large.finish(t.snapshot)).toEqual(t.complete(small, 17));
    expect(large.finish(t.snapshot)).toBe(large.finish(t.snapshot));
  });
  it('requires both terminal empty pages when no files exist', async () => {
    const t = await fixture(1, false),
      d = t.create();
    d.appendEntries(t.snapshot, t.entries);
    expect(() => d.appendFiles(t.snapshot, [])).toThrow('integrity');
    d.appendEntries(t.snapshot, []);
    expect(() => d.finish(t.snapshot)).toThrow('integrity');
    d.appendFiles(t.snapshot, []);
    expect(d.finish(t.snapshot)).toMatchObject({ entryCount: 1, fileCount: 0 });
  });
  it('counts a file referenced by several entries once', async () => {
    const t = await fixture(4, true, true);
    expect(t.complete()).toMatchObject({ entryCount: 4, fileCount: 1 });
  });
  it('changes only the entry digest when a valid snapshot payload changes', async () => {
    const t = await fixture(),
      before = t.complete(),
      entry = t.entries[0];
    entry.payload.name = 'Another recorded name';
    entry.contentHash = archiveHash({
      kind: entry.kind,
      payload: entry.payload,
      fileBindings: entry.fileBindings,
    });
    const after = t.complete();
    expect(after.entriesDigest).not.toBe(before.entriesDigest);
    expect(after.filesDigest).toBe(before.filesDigest);
    expect(after.manifestHash).not.toBe(before.manifestHash);
  });
  it('requires exactly one animal entry even when all supplied row counts match', async () => {
    const t = await fixture(2, false);
    t.archive.expectedEntryCount = 1;
    t.archive.capture!.entryCount = 1;
    t.input.expectedSealHash = inspectItemCopyPreparation(
      t.input.selector,
      t.snapshot,
    ).observedSealHash;
    const d = t.create();
    d.appendEntries(
      t.snapshot,
      t.entries.filter((e) => e.kind !== 'ANIMAL'),
    );
    expect(() => d.appendEntries(t.snapshot, [])).toThrow('integrity');
  });
  it('rejects excess entries instead of accepting the first declared count', async () => {
    const t = await fixture(2);
    t.archive.expectedEntryCount = 1;
    t.archive.capture!.entryCount = 1;
    t.input.expectedSealHash = inspectItemCopyPreparation(
      t.input.selector,
      t.snapshot,
    ).observedSealHash;
    const d = t.create(),
      cursor = d.nextPage;
    expect(() => d.appendEntries(t.snapshot, t.entries)).toThrow('integrity');
    expect(d.nextPage).toEqual(cursor);
  });
  it('compares distinct referenced files with the sealed file count before completing entries', async () => {
    const t = await fixture();
    t.archive.expectedFileCount = 2;
    t.input.expectedSealHash = inspectItemCopyPreparation(
      t.input.selector,
      t.snapshot,
    ).observedSealHash;
    const d = t.create();
    d.appendEntries(t.snapshot, t.entries);
    expect(() => d.appendEntries(t.snapshot, [])).toThrow('integrity');
  });
  it('rejects a self-consistent unreferenced file instead of substituting it for the missing referenced file', async () => {
    const t = await fixture(),
      d = t.create();
    d.appendEntries(t.snapshot, t.entries);
    d.appendEntries(t.snapshot, []);
    const file = { ...t.files[0], relativeKey: 'other.jpg' };
    file.sourceKey = `users/${t.archive.ownerId}/animals/${t.archive.animalId}/other.jpg`;
    file.id = archiveHash([t.archive.id, file.sourceKey]);
    file.historicalKey = `users/${t.archive.ownerId}/animals/${t.archive.animalId}/ownership-archives/${t.archive.id}/other.jpg`;
    file.recipientStagingKey = `users/${t.archive.recipientId}/animals/${t.archive.animalId}/transfer-preparations/${t.archive.id}/other.jpg`;
    file.recipientFinalKey = `users/${t.archive.recipientId}/animals/${t.archive.animalId}/other.jpg`;
    const definition = {
      id: file.id,
      archiveId: file.archiveId,
      sourceKey: file.sourceKey,
      relativeKey: file.relativeKey,
      historicalKey: file.historicalKey,
      recipientStagingKey: file.recipientStagingKey,
      recipientFinalKey: file.recipientFinalKey,
      source: file.source,
    };
    file.definitionHash = archiveHash(definition);
    expect(captureItemArchiveFileDefinition(t.archive, file)).toEqual(
      definition,
    );
    expect(() => d.appendFiles(t.snapshot, [file])).toThrow('integrity');
  });
  it('ignores operational metadata and object key insertion order, while hashing immutable source revisions', async () => {
    const t = await fixture(2),
      first = t.complete();
    for (const entry of t.entries) {
      entry.payload = Object.fromEntries(
        Object.entries(entry.payload).reverse(),
      );
      entry.referencePlan = { ignored: true } as never;
    }
    for (const file of t.files) {
      file.state = 'VERIFIED';
      file.leaseToken = 'technical';
      file.verified = { ignored: true } as never;
      file.historicalCopyIntent = { ignored: true } as never;
      file.historicalByteObservation = { ignored: true } as never;
      file.stagingCopyIntent = { ignored: true } as never;
    }
    expect(t.complete()).toEqual(first);
    const file = t.files[0];
    const definition = captureItemArchiveFileDefinition(t.archive, file);
    file.source.versionId = 'v2';
    file.definitionHash = archiveHash({ ...definition, source: file.source });
    const changed = t.complete();
    expect(changed.entriesDigest).toBe(first.entriesDigest);
    expect(changed.filesDigest).not.toBe(first.filesDigest);
    expect(changed.manifestHash).not.toBe(first.manifestHash);
  });
  it.each(['entries', 'files'] as const)(
    'rejects a missing %s row even when the caller sends an empty terminal page',
    async (kind) => {
      const t = await fixture(2),
        d = t.create();
      if (kind === 'entries') {
        d.appendEntries(t.snapshot, t.entries.slice(0, 1));
        expect(() => d.appendEntries(t.snapshot, [])).toThrow('integrity');
      } else {
        d.appendEntries(t.snapshot, t.entries);
        d.appendEntries(t.snapshot, []);
        d.appendFiles(t.snapshot, t.files.slice(0, 1));
        expect(() => d.appendFiles(t.snapshot, [])).toThrow('integrity');
      }
    },
  );
  it.each([
    'entryOrder',
    'entryDuplicate',
    'entryCrossPage',
    'fileOrder',
    'fileDuplicate',
    'fileCrossPage',
  ] as const)(
    'rejects %s instead of deduplicating or sorting supplied pages',
    async (kind) => {
      const t = await fixture(3),
        d = t.create();
      if (kind.startsWith('entry')) {
        if (kind === 'entryCrossPage')
          d.appendEntries(t.snapshot, t.entries.slice(0, 1));
        const page =
          kind === 'entryOrder'
            ? [...t.entries].reverse()
            : [t.entries[0], t.entries[0]];
        expect(() => d.appendEntries(t.snapshot, page)).toThrow('integrity');
      } else {
        d.appendEntries(t.snapshot, t.entries);
        d.appendEntries(t.snapshot, []);
        if (kind === 'fileCrossPage')
          d.appendFiles(t.snapshot, t.files.slice(0, 1));
        const page =
          kind === 'fileOrder'
            ? [...t.files].reverse()
            : [t.files[0], t.files[0]];
        expect(() => d.appendFiles(t.snapshot, page)).toThrow('integrity');
      }
    },
  );
  it.each(['entries', 'files'] as const)(
    'keeps the entire %s page unadvanced if its last row is corrupt',
    async (kind) => {
      const t = await fixture(3),
        d = t.create(),
        expected = t.complete();
      if (kind === 'entries') {
        const page = structuredClone(t.entries);
        page[2].contentHash = 'b'.repeat(64);
        const cursor = d.nextPage;
        expect(() => d.appendEntries(t.snapshot, page)).toThrow('integrity');
        expect(d.nextPage).toEqual(cursor);
        expect(t.complete(d)).toEqual(expected);
      } else {
        d.appendEntries(t.snapshot, t.entries);
        d.appendEntries(t.snapshot, []);
        const page = structuredClone(t.files);
        page[2].definitionHash = 'b'.repeat(64);
        const cursor = d.nextPage;
        expect(() => d.appendFiles(t.snapshot, page)).toThrow('integrity');
        expect(d.nextPage).toEqual(cursor);
        d.appendFiles(t.snapshot, t.files);
        d.appendFiles(t.snapshot, []);
        expect(d.finish(t.snapshot)).toEqual(expected);
      }
    },
  );
  it.each([
    'id',
    'archive',
    'kind',
    'resource',
    'hash',
    'payload',
    'binding',
    'retained',
  ] as const)(
    'rejects an inconsistent entry %s, including self-consistent tampered bindings',
    async (kind) => {
      const t = await fixture(),
        d = t.create(),
        row = structuredClone(t.entries[0]);
      if (kind === 'id') row.id = 'b'.repeat(64);
      if (kind === 'archive') row.archiveId = t.f.id(90);
      if (kind === 'kind') row.kind = 'RETAINED_RECORD';
      if (kind === 'resource') row.resourceId = t.f.id(90);
      if (kind === 'hash') row.contentHash = 'b'.repeat(64);
      if (kind === 'payload') row.payload.ownerId = t.f.id(90);
      if (kind === 'binding') {
        row.fileBindings = [];
        row.contentHash = archiveHash({
          kind: row.kind,
          payload: row.payload,
          fileBindings: [],
        });
      }
      if (kind === 'retained') row.retained = null as never;
      expect(() => d.appendEntries(t.snapshot, [row])).toThrow('integrity');
    },
  );
  it.each([
    'id',
    'hash',
    'sourceKey',
    'destination',
    'revision',
    'retained',
    'state',
  ] as const)(
    'rejects an inconsistent file %s using the same validator as copy intents',
    async (kind) => {
      const t = await fixture(),
        d = t.create(),
        row = structuredClone(t.files[0]);
      d.appendEntries(t.snapshot, t.entries);
      d.appendEntries(t.snapshot, []);
      if (kind === 'id') row.id = 'b'.repeat(64);
      if (kind === 'hash') row.definitionHash = 'b'.repeat(64);
      if (kind === 'sourceKey') row.sourceKey = 'users/other/file.jpg';
      if (kind === 'destination') row.recipientStagingKey = row.sourceKey;
      if (kind === 'revision') row.source.size = 0;
      if (kind === 'retained') row.retained = null as never;
      if (kind === 'state') row.state = 'UNSUPPORTED' as never;
      expect(() => d.appendFiles(t.snapshot, [row])).toThrow();
    },
  );
  it.each([
    'epoch',
    'claim',
    'request',
    'capture',
    'counts',
    'reservation',
  ] as const)(
    'rechecks the original %s identity on each supplied snapshot',
    async (kind) => {
      const t = await fixture(),
        d = t.create(),
        changed = structuredClone(t.snapshot);
      if (kind === 'epoch') changed.control!.reservationEpoch!++;
      if (kind === 'claim') changed.claim!.acceptanceOperationId = t.f.id(90);
      if (kind === 'request') changed.request!.version++;
      if (kind === 'capture') changed.archive!.capture!.revision++;
      if (kind === 'counts') changed.archive!.expectedFileCount = 2;
      if (kind === 'reservation') delete changed.archive!.reservation;
      expect(() => d.appendEntries(changed, t.entries)).toThrow();
    },
  );
  it.each(['files', 'finish', 'cached'] as const)(
    'rechecks identity before %s, including an already computed result',
    async (where) => {
      const t = await fixture(),
        d = t.create();
      if (where === 'cached') t.complete(d);
      else {
        d.appendEntries(t.snapshot, t.entries);
        d.appendEntries(t.snapshot, []);
      }
      if (where === 'finish') {
        d.appendFiles(t.snapshot, t.files);
        d.appendFiles(t.snapshot, []);
      }
      const changed = structuredClone(t.snapshot);
      changed.control!.reservationEpoch!++;
      expect(() =>
        where === 'files' ? d.appendFiles(changed, t.files) : d.finish(changed),
      ).toThrow();
    },
  );
  it('does not retain mutable caller pins or page payloads', async () => {
    const t = await fixture(),
      d = t.create(),
      expected = t.complete();
    t.input.expectedSealHash = 'b'.repeat(64);
    t.input.selector.expectedCaptureRevision = 99;
    d.appendEntries(t.snapshot, t.entries);
    t.entries[0].payload.name = 'Later name';
    d.appendEntries(t.snapshot, []);
    d.appendFiles(t.snapshot, t.files);
    t.files[0].source.etag = 'later';
    d.appendFiles(t.snapshot, []);
    expect(d.finish(t.snapshot)).toEqual(expected);
  });
  it.each(['entries', 'files'] as const)(
    'rejects oversized or non-array %s pages without imposing a business limit',
    async (kind) => {
      const t = await fixture(),
        d = t.create();
      if (kind === 'entries') {
        expect(() =>
          d.appendEntries(
            t.snapshot,
            Array.from({ length: 101 }, () => t.entries[0]),
          ),
        ).toThrow('integrity');
        expect(() => d.appendEntries(t.snapshot, null as never)).toThrow(
          'integrity',
        );
      } else {
        d.appendEntries(t.snapshot, t.entries);
        d.appendEntries(t.snapshot, []);
        expect(() =>
          d.appendFiles(
            t.snapshot,
            Array.from({ length: 101 }, () => t.files[0]),
          ),
        ).toThrow('integrity');
        expect(() => d.appendFiles(t.snapshot, null as never)).toThrow(
          'integrity',
        );
      }
    },
  );
  it('rejects extra input, stale seal pins and unsupported resumption from a supplied JSON digest', async () => {
    const t = await fixture();
    expect(
      () =>
        new ItemManifestDigest(
          { ...t.input, manifestHash: 'a'.repeat(64) } as never,
          t.snapshot,
          t.keyFromUrl,
        ),
    ).toThrow('Invalid');
    expect(
      () =>
        new ItemManifestDigest(
          { ...t.input, expectedSealHash: 'b'.repeat(64) },
          t.snapshot,
          t.keyFromUrl,
        ),
    ).toThrow('integrity');
    expect(
      () =>
        new ItemManifestDigest(
          { ...t.input, expectedSealHash: 'bad' },
          t.snapshot,
          t.keyFromUrl,
        ),
    ).toThrow('Invalid');
    const d = t.create();
    t.complete(d);
    expect(d.nextPage.phase).toBe('COMPLETE');
    expect(() => d.appendEntries(t.snapshot, [])).toThrow('integrity');
    expect(() => d.appendFiles(t.snapshot, [])).toThrow('integrity');
  });
});
