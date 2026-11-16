import { MongoOwnershipArchiveRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-repository';
import { buildArchiveReservation } from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import {
  archiveHash,
  buildArchiveEntry,
  OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  archiveAnimal,
  archiveDefinition as definition,
} from '../fixtures/ownership-archive.fixture';

const query = <T>(value: T) => {
  const q = {
    exec: () => Promise.resolve(value),
    lean: () => q,
    session: () => q,
  };
  return q;
};

describe('Mongo ownership archive boundaries', () => {
  const archive: OwnershipArchive = {
    ...definition,
    definitionHash: archiveHash(definition),
    reservation: buildArchiveReservation(definition, 1),
    state: 'COLLECTING',
    createdAt: '2026-10-25T10:00:00.000Z',
  };
  const entry = buildArchiveEntry(
    definition,
    { kind: 'ANIMAL', data: archiveAnimal },
    () => undefined,
  ).entry;
  const transaction = () => {
    const endSession = jest.fn().mockResolvedValue(undefined);
    const withTransaction = jest.fn((work: () => Promise<void>) => work());
    return {
      db: {
        startSession: () => Promise.resolve({ endSession, withTransaction }),
      },
      endSession,
      withTransaction,
    };
  };

  const repositoryFor = (
    archives: Record<string, unknown>,
    entries: unknown,
    files: unknown,
    periods: Record<string, unknown>,
  ) => {
    const tx = transaction();
    return new MongoOwnershipArchiveRepository(
      { db: tx.db, findOne: () => query(archive), ...archives } as never,
      entries as never,
      files as never,
      { exists: () => query(true), ...periods } as never,
      {
        findOne: () => query({ archivePreparationRevision: 0 }),
        updateOne: () => query({ modifiedCount: 1 }),
      } as never,
    );
  };

  it('rejects overwriting an existing cut and always closes its transaction session', async () => {
    const tx = transaction();
    const createEntry = jest.fn();
    const repository = repositoryFor(
      { db: tx.db } as never,
      {
        findOne: () => query({ ...entry, contentHash: 'different-content' }),
        create: createEntry,
      } as never,
      {} as never,
      {} as never,
    );
    await expect(repository.append(definition.id, entry, [])).rejects.toThrow(
      'cannot be overwritten',
    );
    expect(createEntry).not.toHaveBeenCalled();
    expect(tx.endSession).toHaveBeenCalledTimes(1);
  });

  it('does not append records after a concurrent seal has won', async () => {
    const tx = transaction();
    const createEntry = jest.fn();
    const repository = repositoryFor(
      { db: tx.db, updateOne: () => query({ matchedCount: 0 }) } as never,
      { findOne: () => query(null), create: createEntry } as never,
      {} as never,
      {} as never,
    );
    await expect(repository.append(definition.id, entry, [])).rejects.toThrow(
      'no longer accepts',
    );
    expect(createEntry).not.toHaveBeenCalled();
    expect(tx.endSession).toHaveBeenCalledTimes(1);
  });

  it('refuses sealing without exactly one animal snapshot', async () => {
    const tx = transaction();
    const updateArchive = jest.fn().mockReturnValue(query({ matchedCount: 1 }));
    const repository = repositoryFor(
      {
        db: tx.db,
        findOne: () => query(archive),
        updateOne: updateArchive,
      } as never,
      {
        countDocuments: (filter: { kind?: string }) =>
          query(filter.kind ? 0 : 1),
      } as never,
      {} as never,
      {} as never,
    );
    await expect(repository.seal(definition.id, 1)).rejects.toThrow(
      'lacks its animal snapshot',
    );
    expect(updateArchive).toHaveBeenCalledTimes(1);
  });

  it('checkpoints capture only on its expected revision and never after sealing', async () => {
    const update = jest.fn().mockReturnValue(query({ modifiedCount: 1 }));
    const repository = repositoryFor(
      { updateOne: update } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const next = {
      revision: 3,
      phase: 'DIARY' as const,
      afterId: 'entry-100',
      entryCount: 101,
    };
    await expect(
      repository.checkpointCapture(definition.id, 2, next),
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(
      { id: definition.id, state: 'COLLECTING', 'capture.revision': 2 },
      { $set: { capture: next } },
      { session: expect.anything() as unknown },
    );
    update.mockReturnValueOnce(query({ modifiedCount: 0 }));
    await expect(
      repository.checkpointCapture(definition.id, 2, next),
    ).resolves.toBe(false);
    await expect(
      repository.checkpointCapture(definition.id, 2, { ...next, revision: 4 }),
    ).rejects.toThrow('Invalid capture revision');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it.each(['DIARY', 'MEDICAL'] as const)(
    'does not seal live captures still in %s even if record counts would match',
    async (phase) => {
      const tx = transaction();
      const update = jest.fn();
      const repository = repositoryFor(
        {
          db: tx.db,
          findOne: () =>
            query({
              ...archive,
              capture: { phase, revision: 2, entryCount: 3 },
            }),
          updateOne: update,
        } as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(repository.seal(definition.id, 3)).rejects.toThrow(
        'live dossier capture has not completed',
      );
      expect(update).not.toHaveBeenCalled();
      expect(tx.endSession).toHaveBeenCalledTimes(1);
    },
  );

  it('requires the persisted capture count rather than an arbitrary caller count', async () => {
    const tx = transaction();
    const repository = repositoryFor(
      {
        db: tx.db,
        findOne: () =>
          query({
            ...archive,
            capture: { phase: 'COMPLETE', revision: 3, entryCount: 3 },
          }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(repository.seal(definition.id, 2)).rejects.toThrow(
      'live dossier capture has not completed',
    );
    expect(tx.endSession).toHaveBeenCalledTimes(1);
  });

  it('does not mark an archive ready while any file is pending', async () => {
    const updateArchive = jest.fn();
    const repository = repositoryFor(
      {
        findOne: () =>
          query({ ...archive, state: 'COPYING', expectedFileCount: 2 }),
        updateOne: updateArchive,
      } as never,
      {} as never,
      {
        countDocuments: () => query(2),
        exists: () => query({ _id: 'pending-file' }),
      } as never,
      {} as never,
    );
    await expect(repository.markReadyIfComplete(definition.id)).resolves.toBe(
      false,
    );
    expect(updateArchive).not.toHaveBeenCalled();
  });

  it.each(['missing', 'importing', 'count mismatch'])(
    'refuses sealing a later period with %s inherited history',
    async (problem) => {
      const tx = transaction();
      const later = {
        ...archive,
        ownershipVersion: 2,
        definitionHash: archiveHash({ ...definition, ownershipVersion: 2 }),
        reservation: buildArchiveReservation(
          { ...definition, ownershipVersion: 2 },
          1,
        ),
        ...(problem === 'missing'
          ? {}
          : {
              history: {
                sourceArchiveId: 'previous',
                sourceDefinitionHash: 'hash',
                expectedEntryCount: 3,
                expectedFileCount: 1,
                revision: 1,
                phase: problem === 'importing' ? 'IMPORTING' : 'COMPLETE',
                entryCount: 2,
              },
            }),
      };
      const update = jest.fn();
      const repository = repositoryFor(
        { db: tx.db, findOne: () => query(later), updateOne: update } as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(repository.seal(later.id, 4)).rejects.toThrow(
        'retained history import has not completed',
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('counts retained snapshots separately so previous profiles cannot replace the current one', async () => {
    const tx = transaction();
    const update = jest.fn().mockReturnValue(query({ matchedCount: 1 }));
    const later = {
      ...archive,
      ownershipVersion: 2,
      definitionHash: archiveHash({ ...definition, ownershipVersion: 2 }),
      reservation: buildArchiveReservation(
        { ...definition, ownershipVersion: 2 },
        1,
      ),
      history: {
        sourceArchiveId: 'previous',
        sourceDefinitionHash: 'hash',
        expectedEntryCount: 3,
        expectedFileCount: 1,
        revision: 1,
        phase: 'COMPLETE',
        entryCount: 3,
      },
    };
    const repository = repositoryFor(
      { db: tx.db, findOne: () => query(later), updateOne: update } as never,
      {
        countDocuments: (filter: { kind?: string }) =>
          query(
            filter.kind === 'ANIMAL'
              ? 1
              : filter.kind === 'RETAINED_RECORD'
                ? 2
                : 4,
          ),
      } as never,
      { countDocuments: () => query(1) } as never,
      {} as never,
    );
    await expect(repository.seal(later.id, 4)).rejects.toThrow(
      'retained history manifest is incomplete',
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('cannot confirm a copied file using a lost lease token', async () => {
    const updateFile = jest.fn().mockReturnValue(query({ modifiedCount: 0 }));
    const repository = repositoryFor(
      { findOne: () => query({ ...archive, state: 'COPYING' }) } as never,
      {} as never,
      {
        findOne: () => query({ id: 'file', archiveId: definition.id }),
        updateOne: updateFile,
      } as never,
      {} as never,
    );
    await expect(
      repository.completeFile('file', 'stale-worker', {
        sha256: 'hash',
        historical: { etag: 'h', size: 12 },
        recipientStaging: { etag: 'r', size: 12 },
      }),
    ).resolves.toBe(false);
    expect(updateFile).toHaveBeenCalledWith(
      {
        id: 'file',
        state: 'COPYING',
        leaseToken: 'stale-worker',
      },
      expect.anything(),
      { session: expect.anything() as unknown },
    );
  });

  it('returns ready when another worker won the same completion transition', async () => {
    const find = jest
      .fn()
      .mockReturnValueOnce(
        query({ ...archive, state: 'COPYING', expectedFileCount: 0 }),
      )
      .mockReturnValueOnce(
        query({ ...archive, state: 'READY', expectedFileCount: 0 }),
      );
    const repository = repositoryFor(
      { findOne: find, updateOne: () => query({ modifiedCount: 0 }) } as never,
      {} as never,
      {
        countDocuments: () => query(0),
        exists: () => query(null),
      } as never,
      {} as never,
    );
    await expect(repository.markReadyIfComplete(definition.id)).resolves.toBe(
      true,
    );
  });
});
