import { OwnershipArchiveHistoryImporter } from '../../../src/context/animal-transfer/application/ownership-archive-history-importer';
import {
  AnimalOwnershipControl,
  AnimalOwnershipRepository,
} from '../../../src/context/animal-transfer/domain/animal-ownership';
import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchiveRepository,
  OwnershipArchiveStorage,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  OwnershipArchiveHistoryRepository,
  buildRetainedArchiveEntry,
} from '../../../src/context/animal-transfer/domain/ownership-archive-history';
import {
  archiveAnimal,
  archiveMedicalDocument,
} from '../fixtures/ownership-archive.fixture';
import {
  historyArchive,
  historyClone as clone,
  historyKeyFromUrl,
  historyRecord,
} from '../fixtures/ownership-archive-history.fixture';

describe('Explicit retained history import (internal)', () => {
  const setup = (count = 1) => {
    const source = historyArchive(1);
    const target = historyArchive(2);
    const records = Array.from(
      { length: count },
      (_, n) =>
        historyRecord(source, {
          kind: 'DIARY_ENTRY',
          data: {
            id: `diary-${String(n).padStart(4, '0')}`,
            animalId: source.animalId,
            title: 'Retained even after deletion',
            content: 'Original',
            date: '2020-01-01',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-02',
            attachments: [],
          },
        }).entry,
    ).sort((a, b) => a.id.localeCompare(b.id));
    source.state = 'READY';
    source.expectedEntryCount = records.length;
    source.expectedFileCount = 0;
    const targets = new Map<string, ArchiveEntry>();
    const manifests = new Map<string, ArchiveFile>();
    const control: AnimalOwnershipControl = {
      animalId: target.animalId,
      ownerId: target.ownerId,
      ownershipVersion: target.ownershipVersion,
      reservationEpoch: 1,
      transferLock: {
        transferId: target.transferId,
        lockedAt: target.createdAt,
      },
      activeWrites: [],
    };
    const ownership = {
      findControl: jest.fn(() => Promise.resolve(clone(control))),
    };
    const repository = {
      find: jest.fn(() => Promise.resolve(clone(target))),
      listEntries: jest.fn(
        (_id: string, after: string | undefined, limit: number) =>
          Promise.resolve(
            clone(
              records
                .filter((record) => !after || record.id > after)
                .slice(0, limit),
            ),
          ),
      ),
      append: jest.fn(
        (_id: string, entry: ArchiveEntry, files: ArchiveFile[]) => {
          const previous = targets.get(entry.id);
          if (previous && previous.contentHash !== entry.contentHash)
            return Promise.reject(new Error('overwrite'));
          if (!previous && target.state !== 'COLLECTING')
            return Promise.reject(new Error('sealed'));
          targets.set(entry.id, clone(entry));
          files.forEach((file) => manifests.set(file.id, clone(file)));
          return Promise.resolve();
        },
      ),
    };
    const history: jest.Mocked<OwnershipArchiveHistoryRepository> = {
      start: jest.fn((_id, sourceId) => {
        if (!target.history)
          target.history = {
            sourceArchiveId: sourceId,
            sourceDefinitionHash: source.definitionHash,
            expectedEntryCount: source.expectedEntryCount!,
            expectedFileCount: source.expectedFileCount!,
            revision: 0,
            phase: 'IMPORTING',
            entryCount: 0,
          };
        return Promise.resolve(clone(target));
      }),
      source: jest.fn<
        ReturnType<OwnershipArchiveHistoryRepository['source']>,
        Parameters<OwnershipArchiveHistoryRepository['source']>
      >(() => Promise.resolve(clone(source))),
      findFile: jest.fn(),
      checkpoint: jest.fn((_id, expected, next) => {
        if (target.history!.revision !== expected.revision)
          return Promise.resolve(false);
        target.history = clone(next);
        return Promise.resolve(true);
      }),
    };
    const storage = {
      keyFromUrl: jest.fn(historyKeyFromUrl),
      inspect: jest.fn(),
      copyAndVerify: jest.fn(),
      assertTransferSafe: jest.fn(),
    };
    const make = () =>
      new OwnershipArchiveHistoryImporter(
        ownership as unknown as AnimalOwnershipRepository,
        repository as unknown as OwnershipArchiveRepository,
        history,
        storage as OwnershipArchiveStorage,
      );
    return {
      source,
      target,
      targets,
      manifests,
      records,
      control,
      ownership,
      repository,
      history,
      storage,
      make,
    };
  };

  it('pages 101 records, restarts from persisted progress and does not read S3 or mutate live resources', async () => {
    const s = setup(101);
    await s.make().start(s.target.id, s.source.id);
    const first = await s.make().importBatch(s.target.id);
    expect(first.history).toMatchObject({
      phase: 'IMPORTING',
      entryCount: 100,
      revision: 1,
    });
    expect(s.targets.size).toBe(100);
    const second = await s.make().importBatch(s.target.id);
    expect(second.history).toMatchObject({
      phase: 'COMPLETE',
      entryCount: 101,
      revision: 2,
    });
    expect(s.targets.size).toBe(101);
    await s.make().importBatch(s.target.id);
    expect(s.repository.listEntries).toHaveBeenCalledTimes(2);
    expect(s.storage.inspect).not.toHaveBeenCalled();
    expect(s.storage.copyAndVerify).not.toHaveBeenCalled();
    expect(s.control.transferLock!.transferId).toBe(s.target.transferId);
  });

  it('imports both a deleted A snapshot and B replacement into the C→A return preparation', async () => {
    const s = setup();
    const a = historyArchive(1);
    const b = historyArchive(2);
    const c = historyArchive(3, 3, 1);
    const old = historyRecord(a, {
      kind: 'MEDICAL_DOCUMENT',
      data: archiveMedicalDocument(),
    });
    const retainedAtB = buildRetainedArchiveEntry(
      b,
      a,
      old.entry,
      old.files,
      historyKeyFromUrl,
    );
    retainedAtB.files.forEach((file) => {
      file.state = 'VERIFIED';
      file.verified = clone(old.files[0].verified!);
    });
    const replacement = archiveMedicalDocument();
    replacement.ownerId = b.ownerId;
    replacement.description = 'Replacement by B';
    replacement.version++;
    replacement.storageKey = replacement.storageKey.replace(
      a.ownerId,
      b.ownerId,
    );
    replacement.documentLocations![0].storageKey = replacement.storageKey;
    const currentAtB = historyRecord(b, {
      kind: 'MEDICAL_DOCUMENT',
      data: replacement,
    });
    const profileAtB = historyRecord(b, {
      kind: 'ANIMAL',
      data: { ...archiveAnimal, ownerId: b.ownerId, name: 'Name by B' },
    });
    Object.assign(s.source, b, {
      state: 'READY',
      expectedEntryCount: 3,
      expectedFileCount: 2,
    });
    Object.assign(s.target, c);
    Object.assign(s.control, {
      ownerId: c.ownerId,
      ownershipVersion: 3,
      transferLock: { transferId: c.transferId, lockedAt: c.createdAt },
    });
    s.records.splice(
      0,
      s.records.length,
      retainedAtB.entry,
      currentAtB.entry,
      profileAtB.entry,
    );
    s.records.sort((x, y) => x.id.localeCompare(y.id));
    const bound = new Map(
      [...retainedAtB.files, ...currentAtB.files].map((file) => [
        file.id,
        file,
      ]),
    );
    s.history.findFile.mockImplementation((_archiveId, fileId) =>
      Promise.resolve(clone(bound.get(fileId) ?? null)),
    );
    await s.make().start(c.id, b.id);
    await s.make().importBatch(c.id);
    expect(s.target.history).toMatchObject({
      phase: 'COMPLETE',
      entryCount: 3,
    });
    const snapshots = [...s.targets.values()].filter(
      (entry) => entry.retained!.kind === 'MEDICAL_DOCUMENT',
    );
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((entry) => entry.retained!.resourceId)).toEqual([
      replacement.id,
      replacement.id,
    ]);
    expect(snapshots.map((entry) => entry.payload.description)).toEqual(
      expect.arrayContaining([undefined, 'Replacement by B']),
    );
    expect(s.manifests.size).toBe(2);
    for (const file of s.manifests.values()) {
      expect(file.sourceKey).toContain(`ownership-archives/${b.id}/`);
      expect(file.recipientFinalKey).toContain(
        `users/${a.ownerId}/animals/${a.animalId}/retained-history/`,
      );
      expect(file.recipientFinalKey).not.toBe(old.files[0].historicalKey);
    }
    expect(old.entry.payload.description).toBeUndefined();
    expect(s.storage.inspect).not.toHaveBeenCalled();
  });

  it('replays a partially appended page and an uncertain checkpoint without duplicating snapshots', async () => {
    const s = setup(3);
    await s.make().start(s.target.id, s.source.id);
    const append = s.repository.append.getMockImplementation()!;
    s.repository.append
      .mockImplementationOnce(append)
      .mockRejectedValueOnce(new Error('lost append reply'));
    await expect(s.make().importBatch(s.target.id)).rejects.toThrow(
      'lost append reply',
    );
    expect(s.target.history!.entryCount).toBe(0);
    expect(s.targets.size).toBe(1);
    const checkpoint = s.history.checkpoint.getMockImplementation()!;
    s.history.checkpoint.mockImplementationOnce(async (...args) => {
      await checkpoint(...args);
      throw new Error('lost checkpoint reply');
    });
    await expect(s.make().importBatch(s.target.id)).rejects.toThrow(
      'lost checkpoint reply',
    );
    await s.make().importBatch(s.target.id);
    expect(s.targets.size).toBe(3);
    expect(s.target.history!.phase).toBe('COMPLETE');
  });

  it('concurrent instances cannot advance the same page/count twice', async () => {
    const s = setup(101);
    await s.make().start(s.target.id, s.source.id);
    await Promise.all([
      s.make().importBatch(s.target.id),
      s.make().importBatch(s.target.id),
    ]);
    expect(s.target.history!.entryCount).toBe(100);
    expect(s.target.history!.revision).toBe(1);
    expect(s.targets.size).toBe(100);
    await s.make().importBatch(s.target.id);
    expect(s.target.history!.entryCount).toBe(101);
  });

  it('handles a full final page using an empty completion page', async () => {
    const s = setup(100);
    await s.make().start(s.target.id, s.source.id);
    await s.make().importBatch(s.target.id);
    expect(s.target.history!.phase).toBe('IMPORTING');
    await s.make().importBatch(s.target.id);
    expect(s.target.history).toMatchObject({
      phase: 'COMPLETE',
      entryCount: 100,
    });
  });

  it.each(['lock lost', 'version changed', 'writer present'])(
    'refuses %s without removing tokens or reservation',
    async (problem) => {
      const s = setup();
      if (problem === 'lock lost') delete s.control.transferLock;
      if (problem === 'version changed') s.control.ownershipVersion++;
      if (problem === 'writer present')
        s.control.activeWrites = [{ token: 'legacy', startedAt: 'old' }];
      await expect(s.make().start(s.target.id, s.source.id)).rejects.toThrow(
        'drained transfer reservation',
      );
      expect(s.history.start.mock.calls).toHaveLength(0);
    },
  );

  it.each([
    'duplicate cursor',
    'oversized page',
    'short count',
    'missing file',
  ])('keeps progress open on %s', async (problem) => {
    const s = setup(2);
    await s.make().start(s.target.id, s.source.id);
    if (problem === 'duplicate cursor') s.records[1] = clone(s.records[0]);
    if (problem === 'oversized page')
      s.repository.listEntries.mockResolvedValue(
        Array(101).fill(s.records[0]) as ArchiveEntry[],
      );
    if (problem === 'short count') s.records.pop();
    if (problem === 'missing file') {
      s.records[0].fileBindings = [{ path: '/file', fileId: 'missing' }];
      s.history.findFile.mockResolvedValue(null);
    }
    await expect(s.make().importBatch(s.target.id)).rejects.toThrow();
    expect(s.target.history!.phase).toBe('IMPORTING');
    expect(s.history.checkpoint.mock.calls).toHaveLength(0);
    expect(s.control.transferLock).toBeDefined();
  });

  it('does not adopt automatic initial-period captures or start import without an explicit source', async () => {
    const s = setup();
    await expect(s.make().importBatch(s.target.id)).rejects.toThrow(
      'No valid explicit',
    );
    await s.make().start(s.target.id, s.source.id);
    s.target.capture = { revision: 0, phase: 'ANIMAL', entryCount: 0 };
    await expect(s.make().importBatch(s.target.id)).rejects.toThrow(
      'No valid explicit',
    );
    expect(archiveAnimal.nameHistory).toHaveLength(1);
  });
});
