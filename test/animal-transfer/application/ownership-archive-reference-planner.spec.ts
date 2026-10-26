import { OwnershipArchiveReferencePlanner } from '../../../src/context/animal-transfer/application/ownership-archive-reference-planner';
import {
  AnimalOwnershipControl,
  AnimalOwnershipRepository,
} from '../../../src/context/animal-transfer/domain/animal-ownership';
import {
  ArchiveEntry,
  OwnershipArchiveRepository,
  OwnershipArchiveStorage,
  archiveHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ARCHIVE_REFERENCE_PLAN_PROTOCOL,
  ArchiveEntryReferencePlan,
  ArchiveReferencePlanProgress,
  OwnershipArchiveReferencePlanRepository,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';
import {
  historyArchive,
  historyClone as clone,
  historyKeyFromUrl,
  historyRecord,
} from '../fixtures/ownership-archive-history.fixture';

describe('Paginated internal reference planner', () => {
  const setup = (count = 1) => {
    const archive = historyArchive(1);
    archive.state = 'READY';
    archive.expectedEntryCount = count;
    archive.expectedFileCount = 0;
    const records = [
      historyRecord(archive, { kind: 'ANIMAL', data: archiveAnimal }).entry,
    ];
    for (let n = 1; n < count; n++)
      records.push(
        historyRecord(archive, {
          kind: 'DIARY_ENTRY',
          data: {
            id: `diary-${String(n).padStart(4, '0')}`,
            animalId: archive.animalId,
            title: 'Title',
            content: 'Original',
            date: '2020-01-01',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
            attachments: [],
          },
        }).entry,
      );
    records.sort((a, b) => a.id.localeCompare(b.id));
    const saved = new Map<string, ArchiveEntryReferencePlan>();
    const control: AnimalOwnershipControl = {
      animalId: archive.animalId,
      ownerId: archive.ownerId,
      ownershipVersion: 1,
      activeWrites: [],
      transferLock: {
        transferId: archive.transferId,
        lockedAt: archive.createdAt,
      },
    };
    const ownership = {
      findControl: jest.fn(() => Promise.resolve(clone(control))),
    };
    const repository = {
      listEntries: jest.fn(
        (_id: string, after: string | undefined, limit: number) =>
          Promise.resolve(
            clone(
              records.filter((r) => !after || r.id > after).slice(0, limit),
            ),
          ),
      ),
    };
    const store = {
      find: jest.fn(() => Promise.resolve(clone(archive))),
      start: jest.fn(() => {
        archive.referencePlan ??= {
          protocol: ARCHIVE_REFERENCE_PLAN_PROTOCOL,
          definitionHash: archive.definitionHash,
          revision: 0,
          phase: 'PLANNING',
          entryCount: 0,
        };
        return Promise.resolve(clone(archive));
      }),
      findFile: jest
        .fn<
          ReturnType<OwnershipArchiveReferencePlanRepository['findFile']>,
          Parameters<OwnershipArchiveReferencePlanRepository['findFile']>
        >()
        .mockResolvedValue(null),
      savePage: jest.fn(
        (
          _id: string,
          expected: ArchiveReferencePlanProgress,
          plans: ArchiveEntryReferencePlan[],
          next: ArchiveReferencePlanProgress,
        ) => {
          if (archiveHash(expected) !== archiveHash(archive.referencePlan))
            return Promise.resolve(false);
          plans.forEach((p) => saved.set(p.entryId, clone(p)));
          archive.referencePlan = clone(next);
          return Promise.resolve(true);
        },
      ),
    };
    const storage = {
      keyFromUrl: jest.fn(historyKeyFromUrl),
      inspect: jest.fn(),
      copyAndVerify: jest.fn(),
      assertTransferSafe: jest.fn(),
    };
    const make = () =>
      new OwnershipArchiveReferencePlanner(
        ownership as unknown as AnimalOwnershipRepository,
        repository as unknown as OwnershipArchiveRepository,
        store,
        storage as OwnershipArchiveStorage,
      );
    return {
      archive,
      records,
      saved,
      control,
      ownership,
      repository,
      store,
      storage,
      make,
    };
  };

  it('plans 101 entries with restart and retains READY/reservation without touching payloads, periods or S3', async () => {
    const s = setup(101);
    const originals = clone(s.records);
    await s.make().start(s.archive.id);
    const first = await s.make().planBatch(s.archive.id);
    expect(first.referencePlan).toMatchObject({
      phase: 'PLANNING',
      entryCount: 100,
      revision: 1,
    });
    const second = await s.make().planBatch(s.archive.id);
    expect(second.referencePlan).toMatchObject({
      phase: 'PLANNED',
      entryCount: 101,
      revision: 2,
    });
    await s.make().planBatch(s.archive.id);
    expect(s.repository.listEntries).toHaveBeenCalledTimes(2);
    expect(s.saved.size).toBe(101);
    expect(s.records).toEqual(originals);
    expect(s.archive.state).toBe('READY');
    expect(s.control.transferLock!.transferId).toBe(s.archive.transferId);
    expect(s.storage.inspect).not.toHaveBeenCalled();
    expect(s.storage.copyAndVerify).not.toHaveBeenCalled();
  });
  it('finishes exactly 100 records using an empty last page', async () => {
    const s = setup(100);
    await s.make().start(s.archive.id);
    await s.make().planBatch(s.archive.id);
    expect(s.archive.referencePlan!.phase).toBe('PLANNING');
    await s.make().planBatch(s.archive.id);
    expect(s.archive.referencePlan).toMatchObject({
      phase: 'PLANNED',
      entryCount: 100,
    });
  });
  it('handles concurrent instances and a lost reply after the atomic page commit without double counting', async () => {
    const s = setup(101);
    await s.make().start(s.archive.id);
    await Promise.all([
      s.make().planBatch(s.archive.id),
      s.make().planBatch(s.archive.id),
    ]);
    expect(s.archive.referencePlan).toMatchObject({
      revision: 1,
      entryCount: 100,
    });
    const save = s.store.savePage.getMockImplementation()!;
    s.store.savePage.mockImplementationOnce(async (...args) => {
      await save(...args);
      throw new Error('lost reply');
    });
    await expect(s.make().planBatch(s.archive.id)).rejects.toThrow(
      'lost reply',
    );
    await s.make().planBatch(s.archive.id);
    expect(s.archive.referencePlan).toMatchObject({
      revision: 2,
      entryCount: 101,
      phase: 'PLANNED',
    });
    expect(s.saved.size).toBe(101);
  });
  it.each([
    'short page',
    'oversized page',
    'duplicate cursor',
    'missing file',
    'changed content',
  ])('does not persist a partial plan on %s', async (problem) => {
    const s = setup(2);
    await s.make().start(s.archive.id);
    if (problem === 'short page') s.records.pop();
    if (problem === 'oversized page')
      s.repository.listEntries.mockResolvedValue(
        Array(101).fill(s.records[0]) as ArchiveEntry[],
      );
    if (problem === 'duplicate cursor') s.records[1] = clone(s.records[0]);
    if (problem === 'missing file')
      s.records[0].fileBindings = [{ path: '/file', fileId: 'missing' }];
    if (problem === 'changed content')
      s.records[0].payload.name = 'not the cut';
    await expect(s.make().planBatch(s.archive.id)).rejects.toThrow();
    expect(s.store.savePage).not.toHaveBeenCalled();
    expect(s.saved.size).toBe(0);
    expect(s.archive.referencePlan!.revision).toBe(0);
  });
  it.each(['lock', 'version', 'writer', 'protocol'])(
    'rejects a changed %s',
    async (problem) => {
      const s = setup();
      await s.make().start(s.archive.id);
      if (problem === 'lock') delete s.control.transferLock;
      if (problem === 'version') s.control.ownershipVersion++;
      if (problem === 'writer')
        s.control.activeWrites = [{ token: 'legacy', startedAt: 'old' }];
      if (problem === 'protocol')
        Object.assign(s.archive.referencePlan!, { protocol: 'FUTURE' });
      await expect(s.make().planBatch(s.archive.id)).rejects.toThrow();
      expect(s.store.savePage).not.toHaveBeenCalled();
    },
  );
});
