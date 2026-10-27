import { MongoOwnershipArchiveHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import {
  archiveDefinitionOnly,
  buildArchiveReservation,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { ArchiveHistoryProgress } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  historyArchive,
  historyClone as clone,
} from '../fixtures/ownership-archive-history.fixture';

const query = <T>(value: T) => {
  const q = {
    session: jest.fn(),
    lean: jest.fn(),
    limit: jest.fn(),
    read: jest.fn(),
    readConcern: jest.fn(),
    exec: jest.fn(() => Promise.resolve(clone(value))),
  };
  q.session.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  q.read.mockReturnValue(q);
  q.readConcern.mockReturnValue(q);
  return q;
};

describe('Mongo retained history fences', () => {
  const setup = () => {
    const source = {
      ...historyArchive(1),
      state: 'READY' as const,
      expectedEntryCount: 3,
      expectedFileCount: 1,
    };
    const target = historyArchive(2);
    const active = {
      id: target.periodId,
      animalId: target.animalId,
      ownerId: target.ownerId,
      ownershipVersion: 2,
      status: 'ACTIVE',
      sourceTransferId: source.transferId,
    };
    const closed = {
      id: source.periodId,
      animalId: target.animalId,
      ownerId: source.ownerId,
      ownershipVersion: 1,
      status: 'CLOSED',
      endedAt: '2026-10-25T10:00:00.000Z',
      archiveId: source.id,
    };
    const state = {
      previous: [closed],
      entries: 3,
      files: 1,
      pending: false,
      matched: true,
    };
    const session = {
      endSession: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    };
    const archives = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      findOne: jest.fn((filter: { id: string }) =>
        query(filter.id === target.id ? target : source),
      ),
      updateOne: jest.fn(() => query({ modifiedCount: state.matched ? 1 : 0 })),
    };
    const entries = {
      countDocuments: jest.fn((filter: { kind?: string }) =>
        query(filter.kind === 'ANIMAL' ? 1 : state.entries),
      ),
    };
    const files = {
      countDocuments: jest.fn(() => query(state.files)),
      exists: jest.fn(() => query(state.pending ? { _id: 'pending' } : null)),
      findOne: jest.fn(() => query(null)),
    };
    const periods = {
      exists: jest.fn(() => query(active)),
      findOne: jest.fn(() => query(active)),
      find: jest.fn(() => query(state.previous)),
    };
    const repository = new MongoOwnershipArchiveHistory(
      archives as never,
      entries as never,
      files as never,
      periods as never,
      {
        findOne: () => query({ archivePreparationRevision: 0 }),
        updateOne: () => query({ modifiedCount: 1 }),
      } as never,
    );
    return {
      source,
      target,
      active,
      closed,
      state,
      session,
      archives,
      entries,
      files,
      periods,
      repository,
    };
  };

  it('pins the effective predecessor with a snapshot/primary/majority transaction; READY alone is not evidence', async () => {
    const s = setup();
    const result = await s.repository.start(s.target.id, s.source.id);
    expect(result.history).toMatchObject({
      sourceArchiveId: s.source.id,
      sourceDefinitionHash: s.source.definitionHash,
      expectedEntryCount: 3,
      expectedFileCount: 1,
      phase: 'IMPORTING',
      revision: 0,
    });
    expect(s.periods.find).toHaveBeenCalledWith({
      animalId: s.target.animalId,
      ownershipVersion: 1,
    });
    expect(s.periods.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        id: s.target.periodId,
        ownerId: s.target.ownerId,
        ownershipVersion: 2,
        status: 'ACTIVE',
      }),
    );
    expect(s.archives.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'COLLECTING',
        capture: { $exists: false },
        history: { $exists: false },
      }),
      expect.objectContaining({ $inc: { __v: 1 } }),
      { session: s.session },
    );
    expect(s.session.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      },
    );
    expect(s.session.endSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    'no closed period',
    'duplicate period',
    'unclosed period',
    'wrong archive',
    'wrong recipient',
    'wrong transfer',
    'wrong version',
    'no effective date',
    'pending files',
    'missing entries',
    'missing files',
    'source not ready',
  ])('rejects %s before attaching an import cursor', async (problem) => {
    const s = setup();
    if (problem === 'no closed period') s.state.previous = [];
    if (problem === 'duplicate period') s.state.previous.push(clone(s.closed));
    if (problem === 'unclosed period') s.closed.status = 'ACTIVE';
    if (problem === 'wrong archive') s.closed.archiveId = s.target.id;
    if (problem === 'wrong recipient') s.source.recipientId = s.source.ownerId;
    if (problem === 'wrong transfer')
      s.active.sourceTransferId = s.target.transferId;
    if (problem === 'wrong version') s.source.ownershipVersion = 2;
    if (problem === 'no effective date') s.closed.endedAt = '';
    if (problem === 'pending files') s.state.pending = true;
    if (problem === 'missing entries') s.state.entries--;
    if (problem === 'missing files') s.state.files--;
    if (problem === 'source not ready')
      Object.assign(s.source, { state: 'COPYING' });
    await expect(
      s.repository.start(s.target.id, s.source.id),
    ).rejects.toThrow();
    expect(s.archives.updateOne).not.toHaveBeenCalled();
    expect(s.session.endSession).toHaveBeenCalledTimes(1);
  });

  it('retries the same pinned import, refuses another source and detects changed counts/definition', async () => {
    const s = setup();
    s.target.history = (
      await s.repository.start(s.target.id, s.source.id)
    ).history;
    s.archives.updateOne.mockClear();
    await s.repository.start(s.target.id, s.source.id);
    expect(s.archives.updateOne).not.toHaveBeenCalled();
    await expect(s.repository.start(s.target.id, s.target.id)).rejects.toThrow(
      'same collecting',
    );
    s.source.definitionHash = 'changed';
    await expect(s.repository.source(s.target)).rejects.toThrow(
      'source definition changed',
    );
  });

  it('requires inherited completeness on a later predecessor, not just its READY flag', async () => {
    const s = setup();
    s.target.ownershipVersion = 3;
    s.target.definitionHash = archiveHash(archiveDefinitionOnly(s.target));
    s.target.reservation = buildArchiveReservation(s.target, 1);
    s.active.ownershipVersion = 3;
    s.source.ownershipVersion = 2;
    s.closed.ownershipVersion = 2;
    await expect(s.repository.start(s.target.id, s.source.id)).rejects.toThrow(
      'effective immediate predecessor',
    );
  });

  it('rejects initial automatic captures and sealed destinations', async () => {
    const s = setup();
    s.target.capture = { revision: 0, phase: 'ANIMAL', entryCount: 0 };
    await expect(s.repository.start(s.target.id, s.source.id)).rejects.toThrow(
      'collecting manual archive',
    );
    delete s.target.capture;
    s.target.state = 'READY';
    await expect(s.repository.start(s.target.id, s.source.id)).rejects.toThrow(
      'collecting manual archive',
    );
  });

  it('checkpoints by full pinned progress and re-counts persisted entries/files before completion', async () => {
    const s = setup();
    const expected: ArchiveHistoryProgress = {
      sourceArchiveId: s.source.id,
      sourceDefinitionHash: s.source.definitionHash,
      expectedEntryCount: 3,
      expectedFileCount: 1,
      revision: 1,
      phase: 'IMPORTING',
      entryCount: 2,
      afterId: 'a',
    };
    const next = {
      ...expected,
      revision: 2,
      phase: 'COMPLETE' as const,
      entryCount: 3,
      afterId: 'b',
    };
    await expect(
      s.repository.checkpoint(s.target.id, expected, next),
    ).resolves.toBe(true);
    expect(s.archives.updateOne).toHaveBeenCalledWith(
      { id: s.target.id, state: 'COLLECTING', history: expected },
      { $set: { history: next }, $inc: { __v: 1 } },
      { session: s.session },
    );
    expect(s.entries.countDocuments).toHaveBeenCalledWith({
      archiveId: s.target.id,
      kind: 'RETAINED_RECORD',
    });
    expect(s.files.countDocuments).toHaveBeenCalledWith({
      archiveId: s.target.id,
      'retained.sourceArchiveId': s.source.id,
    });
    s.state.files = 0;
    await expect(
      s.repository.checkpoint(s.target.id, expected, next),
    ).rejects.toThrow('incomplete');
    s.state.matched = false;
    await expect(
      s.repository.checkpoint(s.target.id, expected, next),
    ).resolves.toBe(false);
  });

  it('permits an empty last page but rejects cursor regression and changes to pinned definitions', async () => {
    const s = setup();
    const expected: ArchiveHistoryProgress = {
      sourceArchiveId: s.source.id,
      sourceDefinitionHash: s.source.definitionHash,
      expectedEntryCount: 3,
      expectedFileCount: 1,
      revision: 1,
      phase: 'IMPORTING',
      entryCount: 3,
      afterId: 'b',
    };
    await expect(
      s.repository.checkpoint(s.target.id, expected, {
        ...expected,
        revision: 2,
        phase: 'COMPLETE',
      }),
    ).resolves.toBe(true);
    await expect(
      s.repository.checkpoint(s.target.id, expected, {
        ...expected,
        revision: 2,
        afterId: 'a',
      }),
    ).rejects.toThrow('Invalid retained history checkpoint');
    await expect(
      s.repository.checkpoint(s.target.id, expected, {
        ...expected,
        revision: 2,
        sourceArchiveId: s.target.id,
      }),
    ).rejects.toThrow('Invalid retained history checkpoint');
  });

  it('reads bound files by archive and id from primary with majority', async () => {
    const s = setup();
    await s.repository.findFile(s.source.id, 'file');
    expect(s.files.findOne).toHaveBeenCalledWith({
      archiveId: s.source.id,
      id: 'file',
    });
    const q = s.files.findOne.mock.results[0].value as ReturnType<typeof query>;
    expect(q.read).toHaveBeenCalledWith('primary');
    expect(q.readConcern).toHaveBeenCalledWith('majority');
  });
});
