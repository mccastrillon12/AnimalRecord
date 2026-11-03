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
import { historicalCopyPreparationFixture } from './historical-copy-preparation.fixture';
import { archiveAnimal } from './ownership-archive.fixture';

export async function itemManifestFixture(
  count = 1,
  withFiles = true,
  shared = false,
) {
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
  f.state.db.entries = structuredClone(entries) as unknown as Record<
    string,
    unknown
  >[];
  f.state.db.files = structuredClone(manifest) as unknown as Record<
    string,
    unknown
  >[];
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
