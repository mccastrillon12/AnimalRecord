import { MongoOwnershipArchiveRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-repository';
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
  const result = { exec: () => Promise.resolve(value) };
  return {
    ...result,
    lean: () => result,
    session: () => ({ ...result, lean: () => result }),
  };
};

describe('Mongo ownership archive boundaries', () => {
  const archive: OwnershipArchive = {
    ...definition,
    definitionHash: archiveHash(definition),
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

  it('rejects overwriting an existing cut and always closes its transaction session', async () => {
    const tx = transaction();
    const createEntry = jest.fn();
    const repository = new MongoOwnershipArchiveRepository(
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
    const repository = new MongoOwnershipArchiveRepository(
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
    const repository = new MongoOwnershipArchiveRepository(
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

  it('does not mark an archive ready while any file is pending', async () => {
    const updateArchive = jest.fn();
    const repository = new MongoOwnershipArchiveRepository(
      {
        findOne: () =>
          query({ ...archive, state: 'COPYING', expectedFileCount: 2 }),
        updateOne: updateArchive,
      } as never,
      {} as never,
      {
        countDocuments: () => query(2),
        exists: () => Promise.resolve({ _id: 'pending-file' }),
      } as never,
      {} as never,
    );
    await expect(repository.markReadyIfComplete(definition.id)).resolves.toBe(
      false,
    );
    expect(updateArchive).not.toHaveBeenCalled();
  });

  it('cannot confirm a copied file using a lost lease token', async () => {
    const updateFile = jest.fn().mockReturnValue(query({ modifiedCount: 0 }));
    const repository = new MongoOwnershipArchiveRepository(
      {} as never,
      {} as never,
      { updateOne: updateFile } as never,
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
    const repository = new MongoOwnershipArchiveRepository(
      { findOne: find, updateOne: () => query({ modifiedCount: 0 }) } as never,
      {} as never,
      {
        countDocuments: () => query(0),
        exists: () => Promise.resolve(null),
      } as never,
      {} as never,
    );
    await expect(repository.markReadyIfComplete(definition.id)).resolves.toBe(
      true,
    );
  });
});
