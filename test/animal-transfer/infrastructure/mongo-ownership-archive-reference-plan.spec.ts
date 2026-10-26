import { MongoOwnershipArchiveReferencePlan } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-reference-plan';
import {
  ARCHIVE_REFERENCE_PLAN_PROTOCOL,
  ArchiveReferencePlanProgress,
  buildArchiveEntryReferencePlan,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';
import {
  historyArchive,
  historyClone as clone,
  historyKeyFromUrl,
  historyRecord,
} from '../fixtures/ownership-archive-history.fixture';
import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import { OwnershipArchiveReferencePlanner } from '../../../src/context/animal-transfer/application/ownership-archive-reference-planner';
import {
  OwnershipArchiveSchema,
  OwnershipArchiveEntrySchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { AnimalOwnershipControlSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';

const query = <T>(value: T) => {
  const q = {
    session: jest.fn(),
    lean: jest.fn(),
    read: jest.fn(),
    readConcern: jest.fn(),
    exec: jest.fn(() => Promise.resolve(clone(value))),
  };
  q.session.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  q.read.mockReturnValue(q);
  q.readConcern.mockReturnValue(q);
  return q;
};

describe('Mongo reference-plan transactions and fences', () => {
  const setup = (version = 1) => {
    const archive = historyArchive(version);
    archive.state = 'READY';
    archive.expectedEntryCount = 1;
    archive.expectedFileCount = 0;
    if (version > 1)
      archive.history = {
        sourceArchiveId: historyArchive(version - 1).id,
        sourceDefinitionHash: 'a'.repeat(64),
        expectedEntryCount: 1,
        expectedFileCount: 0,
        revision: 1,
        entryCount: 1,
        phase: 'COMPLETE',
      };
    const entry = historyRecord(archive, {
      kind: 'ANIMAL',
      data: { ...archiveAnimal, ownerId: archive.ownerId },
    }).entry;
    const plan = buildArchiveEntryReferencePlan(
      archive,
      entry,
      [],
      historyKeyFromUrl,
    );
    const expected: ArchiveReferencePlanProgress = {
      protocol: ARCHIVE_REFERENCE_PLAN_PROTOCOL,
      definitionHash: archive.definitionHash,
      revision: 0,
      phase: 'PLANNING',
      entryCount: 0,
    };
    const next: ArchiveReferencePlanProgress = {
      ...expected,
      revision: 1,
      phase: 'PLANNED',
      afterId: entry.id,
      entryCount: 1,
    };
    const state = {
      active: true,
      control: true,
      advanced: true,
      entryMatches: true,
      total: 1,
      planned: 1,
      profiles: 1,
      files: 0,
      referenced: 0,
      pending: false,
    };
    const commit = jest.fn();
    const session = {
      endSession: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn(async (work: () => Promise<unknown>) => {
        const result = await work();
        commit();
        return result;
      }),
    };
    const archives = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      findOne: jest.fn(() => query(archive)),
      updateOne: jest.fn(() =>
        query({ modifiedCount: state.advanced ? 1 : 0 }),
      ),
    };
    const entries = {
      updateOne: jest.fn(() =>
        query({ matchedCount: state.entryMatches ? 1 : 0 }),
      ),
      countDocuments: jest.fn(
        (filter: { kind?: string; 'referencePlan.protocol'?: string }) =>
          query(
            filter.kind
              ? filter.kind === 'ANIMAL'
                ? state.profiles
                : 0
              : filter['referencePlan.protocol']
                ? state.planned
                : state.total,
          ),
      ),
      aggregate: jest.fn(() => query([{ count: state.referenced }])),
    };
    const files = {
      countDocuments: jest.fn(() => query(state.files)),
      exists: jest.fn(() => query(state.pending ? { _id: 'pending' } : null)),
      findOne: jest.fn(() => query(null)),
    };
    const controls = {
      updateOne: jest.fn(() => query({ modifiedCount: state.control ? 1 : 0 })),
    };
    const periods = {
      exists: jest.fn(() => query(state.active ? { _id: 'active' } : null)),
    };
    const repository = new MongoOwnershipArchiveReferencePlan(
      archives as never,
      entries as never,
      files as never,
      controls as never,
      periods as never,
    );
    const save = () => {
      archive.referencePlan ??= clone(expected);
      return repository.savePage(archive.id, expected, [plan], next);
    };
    return {
      archive,
      entry,
      plan,
      expected,
      next,
      state,
      commit,
      session,
      archives,
      entries,
      files,
      controls,
      periods,
      repository,
      save,
    };
  };

  it('starts under a matching period and writes the control fence in a snapshot/majority transaction', async () => {
    const s = setup();
    const archive = await s.repository.start(s.archive.id);
    expect(archive.referencePlan).toEqual(s.expected);
    expect(s.controls.updateOne).toHaveBeenCalledWith(
      {
        animalId: s.archive.animalId,
        ownerId: s.archive.ownerId,
        ownershipVersion: 1,
        'transferLock.transferId': s.archive.transferId,
        $expr: { $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0] },
      },
      { $inc: { archiveReferencePlanRevision: 1 } },
      { session: s.session },
    );
    expect(s.periods.exists).toHaveBeenCalledWith({
      id: s.archive.periodId,
      animalId: s.archive.animalId,
      ownerId: s.archive.ownerId,
      ownershipVersion: 1,
      status: 'ACTIVE',
    });
    expect(s.session.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      },
    );
    expect(s.session.endSession).toHaveBeenCalledTimes(1);
    expect(s.entries.updateOne).not.toHaveBeenCalled();
  });
  it('reuses the same protocol without replacing progress and refuses an incompatible marker', async () => {
    const s = setup();
    s.archive.referencePlan = clone(s.expected);
    await s.repository.start(s.archive.id);
    expect(s.archives.updateOne).not.toHaveBeenCalled();
    Object.assign(s.archive.referencePlan, { protocol: 'OTHER' });
    await expect(s.repository.start(s.archive.id)).rejects.toThrow(
      'valid archive reference plan',
    );
  });
  it.each(['missing period', 'lock/version/writer mismatch', 'not ready'])(
    'rejects %s before writing progress',
    async (problem) => {
      const s = setup();
      if (problem === 'missing period') s.state.active = false;
      if (problem === 'lock/version/writer mismatch') s.state.control = false;
      if (problem === 'not ready') s.archive.state = 'COPYING';
      await expect(s.repository.start(s.archive.id)).rejects.toThrow();
      expect(s.archives.updateOne).not.toHaveBeenCalled();
      expect(s.commit).not.toHaveBeenCalled();
      expect(s.session.endSession).toHaveBeenCalledTimes(1);
    },
  );
  it('persists page and cursor in the same transaction with pinned source and plan hashes', async () => {
    const s = setup();
    await expect(s.save()).resolves.toBe(true);
    expect(s.archives.updateOne).toHaveBeenCalledWith(
      {
        id: s.archive.id,
        state: 'READY',
        definitionHash: s.archive.definitionHash,
        referencePlan: s.expected,
      },
      { $set: { referencePlan: s.next }, $inc: { __v: 1 } },
      { session: s.session },
    );
    expect(s.entries.updateOne).toHaveBeenCalledWith(
      {
        archiveId: s.archive.id,
        id: s.entry.id,
        contentHash: s.entry.contentHash,
        $or: [
          { referencePlan: { $exists: false } },
          { 'referencePlan.planHash': s.plan.planHash },
        ],
      },
      { $set: { referencePlan: s.plan } },
      { session: s.session },
    );
    expect(s.entries.aggregate).toHaveBeenCalledWith([
      { $match: { archiveId: s.archive.id } },
      { $unwind: '$fileBindings' },
      { $group: { _id: '$fileBindings.fileId' } },
      { $count: 'count' },
    ]);
    expect(s.commit).toHaveBeenCalledTimes(1);
  });
  it('does not write a stale page after another worker advanced the header', async () => {
    const s = setup();
    s.archive.referencePlan = clone(s.next);
    await expect(s.save()).resolves.toBe(false);
    expect(s.controls.updateOne).not.toHaveBeenCalled();
    expect(s.entries.updateOne).not.toHaveBeenCalled();
    expect(s.archives.updateOne).not.toHaveBeenCalled();
  });
  it('does not commit page/header if any entry changed', async () => {
    const s = setup();
    s.state.entryMatches = false;
    await expect(s.save()).rejects.toThrow(
      'already has a different reference plan',
    );
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.session.endSession).toHaveBeenCalledTimes(1);
  });
  it.each([
    'total',
    'planned',
    'profiles',
    'files',
    'referenced',
    'pending',
  ] as const)(
    'refuses final completion with inconsistent %s',
    async (problem) => {
      const s = setup();
      if (problem === 'pending') s.state.pending = true;
      else
        s.state[problem] =
          problem === 'files' || problem === 'referenced' ? 1 : 0;
      await expect(s.save()).rejects.toThrow('manifest is incomplete');
      expect(s.commit).not.toHaveBeenCalled();
    },
  );
  it('allows an empty last page while preserving its last cursor', async () => {
    const s = setup();
    const previous = {
      ...s.expected,
      revision: 1,
      entryCount: 1,
      afterId: s.entry.id,
    };
    s.archive.referencePlan = clone(previous);
    await expect(
      s.repository.savePage(s.archive.id, previous, [], {
        ...previous,
        revision: 2,
        phase: 'PLANNED',
      }),
    ).resolves.toBe(true);
    expect(s.entries.updateOne).not.toHaveBeenCalled();
  });

  it('refuses a later cut whose retained antecedents are absent even when the top-level counts match', async () => {
    const s = setup(2);
    await expect(s.save()).rejects.toThrow('omitted retained history');
    expect(s.commit).not.toHaveBeenCalled();
  });

  it('exports only an internal planner and leaves new persisted fields optional without defaults or TTL', () => {
    const exported = Reflect.getMetadata(
      'exports',
      OwnershipArchiveModule,
    ) as unknown[];
    expect(exported).toContain(OwnershipArchiveReferencePlanner);
    expect(
      Reflect.getMetadata('controllers', OwnershipArchiveModule),
    ).toBeUndefined();
    for (const path of [
      OwnershipArchiveSchema.path('referencePlan'),
      OwnershipArchiveEntrySchema.path('referencePlan'),
      AnimalOwnershipControlSchema.path('archiveReferencePlanRevision'),
    ]) {
      expect(path.options.default).toBeUndefined();
      expect(path.options.required).not.toBe(true);
    }
    for (const schema of [
      OwnershipArchiveSchema,
      OwnershipArchiveEntrySchema,
      AnimalOwnershipControlSchema,
    ]) {
      expect(
        schema
          .indexes()
          .every(([, options]) => options.expireAfterSeconds === undefined),
      ).toBe(true);
    }
  });
  it('rejects a changed plan hash or cursor before opening a transaction', async () => {
    const s = setup();
    await expect(
      s.repository.savePage(
        s.archive.id,
        s.expected,
        [{ ...s.plan, planHash: 'bad' }],
        s.next,
      ),
    ).rejects.toThrow('Invalid reference plan page');
    await expect(
      s.repository.savePage(s.archive.id, s.expected, [s.plan], {
        ...s.next,
        afterId: 'other',
      }),
    ).rejects.toThrow('Invalid reference plan cursor');
    expect(s.archives.db.startSession).not.toHaveBeenCalled();
  });
  it('reads the header and bound files on primary with majority', async () => {
    const s = setup();
    await s.repository.find(s.archive.id);
    await s.repository.findFile(s.archive.id, 'file');
    const headerQuery = s.archives.findOne.mock.results[0].value as ReturnType<
      typeof query
    >;
    const fileQuery = s.files.findOne.mock.results[0].value as ReturnType<
      typeof query
    >;
    for (const q of [headerQuery, fileQuery]) {
      expect(q.read).toHaveBeenCalledWith('primary');
      expect(q.readConcern).toHaveBeenCalledWith('majority');
    }
    expect(s.files.findOne).toHaveBeenCalledWith({
      archiveId: s.archive.id,
      id: 'file',
    });
  });
});
