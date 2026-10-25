import { OwnershipArchivePreparer } from '../../../src/context/animal-transfer/application/ownership-archive-preparer';
import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchive,
  OwnershipArchiveRepository,
  OwnershipArchiveStorage,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { AnimalOwnershipRepository } from '../../../src/context/animal-transfer/domain/animal-ownership';
import {
  archiveAnimal,
  archiveDefinition as definition,
} from '../fixtures/ownership-archive.fixture';

describe('OwnershipArchivePreparer recovery', () => {
  const setup = () => {
    const archives = new Map<string, OwnershipArchive>();
    const entries = new Map<string, ArchiveEntry>();
    const files = new Map<string, ArchiveFile>();
    const findControl = jest.fn().mockResolvedValue({
      animalId: definition.animalId,
      ownerId: definition.ownerId,
      ownershipVersion: 1,
      transferLock: {
        transferId: definition.transferId,
        lockedAt: '2026-10-25T10:00:00.000Z',
      },
    });
    const repository: jest.Mocked<OwnershipArchiveRepository> = {
      checkpointCapture: jest.fn(),
      create: jest.fn((archive) => {
        archives.set(archive.id, archive);
        return Promise.resolve(archive);
      }),
      find: jest.fn((id) => Promise.resolve(archives.get(id) ?? null)),
      findEntry: jest.fn((_id, entryId) =>
        Promise.resolve(entries.get(entryId) ?? null),
      ),
      append: jest.fn((_id, entry, manifest) => {
        entries.set(entry.id, entry);
        manifest.forEach((file) => files.set(file.id, file));
        return Promise.resolve();
      }),
      seal: jest.fn((id, count) => {
        Object.assign(archives.get(id)!, {
          state: 'COPYING',
          expectedEntryCount: count,
          expectedFileCount: files.size,
        });
        return Promise.resolve();
      }),
      listEntries: jest.fn().mockResolvedValue([]),
      claimFile: jest.fn((_id, token, now, leaseUntil) => {
        const file = [...files.values()].find(
          (candidate) =>
            candidate.state === 'PENDING' ||
            (candidate.state === 'COPYING' && candidate.leaseUntil! <= now),
        );
        if (file)
          Object.assign(file, {
            state: 'COPYING',
            leaseToken: token,
            leaseUntil,
          });
        return Promise.resolve(file ?? null);
      }),
      completeFile: jest.fn((id, token, verified) => {
        const file = files.get(id)!;
        if (file.leaseToken !== token) return Promise.resolve(false);
        Object.assign(file, {
          state: 'VERIFIED',
          verified,
          leaseToken: undefined,
        });
        return Promise.resolve(true);
      }),
      releaseFile: jest.fn((id, token) => {
        const file = files.get(id)!;
        if (file.leaseToken === token)
          Object.assign(file, { state: 'PENDING', leaseToken: undefined });
        return Promise.resolve();
      }),
      markReadyIfComplete: jest.fn((id) => {
        const ready = [...files.values()].every(
          (file) => file.state === 'VERIFIED',
        );
        if (ready) archives.get(id)!.state = 'READY';
        return Promise.resolve(ready);
      }),
    };
    const storage: jest.Mocked<OwnershipArchiveStorage> = {
      assertTransferSafe: jest.fn().mockResolvedValue(undefined),
      keyFromUrl: jest.fn((url: string) => url.slice('https://test/'.length)),
      inspect: jest.fn().mockResolvedValue({
        etag: 'source-etag',
        size: 12,
        versionId: 'source-version',
      }),
      copyAndVerify: jest.fn().mockResolvedValue({
        sha256: 'verified-hash',
        historical: { etag: 'history', size: 12 },
        recipientStaging: { etag: 'recipient', size: 12 },
      }),
    };
    const ownership = { findControl } as unknown as AnimalOwnershipRepository;
    const service = new OwnershipArchivePreparer(
      ownership,
      repository,
      storage,
    );
    const addProfile = () =>
      service.append(definition.id, {
        kind: 'ANIMAL',
        data: {
          ...archiveAnimal,
          profilePictureUrl: `https://test/users/${definition.ownerId}/animals/${definition.animalId}/profile_100.jpeg`,
        },
      });
    return {
      service,
      ownership,
      repository,
      storage,
      files,
      entries,
      archives,
      findControl,
      addProfile,
    };
  };

  it('does not prepare or copy under a lock that still has a persisted writer', async () => {
    const ctx = setup();
    ctx.findControl.mockResolvedValue({
      animalId: definition.animalId,
      ownerId: definition.ownerId,
      ownershipVersion: 1,
      transferLock: {
        transferId: definition.transferId,
        lockedAt: '2026-01-01',
      },
      activeWrites: [{ token: 'still-running', startedAt: '2026-01-01' }],
    });
    await expect(ctx.service.begin(definition)).rejects.toThrow(
      'matching transfer reservation',
    );
    expect(ctx.archives.size).toBe(0);
    expect(ctx.storage.inspect.mock.calls).toHaveLength(0);
  });

  it('resumes after a partial copy failure without recopying verified objects', async () => {
    const ctx = setup();
    await ctx.service.begin(definition);
    await ctx.addProfile();
    await ctx.service.append(definition.id, {
      kind: 'DIARY_ENTRY',
      data: {
        id: 'entry-1',
        animalId: definition.animalId,
        title: 'Control',
        date: '2026-01-01',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        attachments: [
          {
            id: 'photo',
            fileName: 'photo.jpg',
            fileType: 'image',
            mimeType: 'image/jpeg',
            url: `https://test/users/${definition.ownerId}/animals/${definition.animalId}/diary/entry-1/photo.jpg`,
            size: 12,
            createdAt: '2026-01-01',
          },
        ],
      },
    });
    await ctx.service.seal(definition.id, 2);
    ctx.storage.copyAndVerify
      .mockResolvedValueOnce({
        sha256: 'verified-hash',
        historical: { etag: 'history', size: 12 },
        recipientStaging: { etag: 'recipient', size: 12 },
      })
      .mockRejectedValueOnce(new Error('S3 interrupted'));
    await expect(ctx.service.copyBatch(definition.id)).rejects.toThrow(
      'S3 interrupted',
    );
    expect([...ctx.files.values()].map((file) => file.state)).toEqual([
      'VERIFIED',
      'PENDING',
    ]);
    expect(ctx.archives.get(definition.id)!.state).toBe('COPYING');
    const resumed = new OwnershipArchivePreparer(
      ctx.ownership,
      ctx.repository,
      ctx.storage,
    );
    await expect(resumed.copyBatch(definition.id)).resolves.toEqual({
      processed: 1,
      ready: true,
    });
    expect(ctx.storage.copyAndVerify.mock.calls).toHaveLength(3);
    await expect(resumed.copyBatch(definition.id)).resolves.toEqual({
      processed: 0,
      ready: true,
    });
    expect(ctx.findControl.mock.calls.length).toBeGreaterThan(1);
  });

  it('retries an identical record without rereading files, and rejects mutation of its cut', async () => {
    const ctx = setup();
    await ctx.service.begin(definition);
    await ctx.addProfile();
    await ctx.addProfile();
    expect(ctx.storage.inspect.mock.calls).toHaveLength(1);
    await expect(
      ctx.service.append(definition.id, {
        kind: 'ANIMAL',
        data: { ...archiveAnimal, name: 'Changed' },
      }),
    ).rejects.toThrow('cannot be overwritten');
    expect(ctx.entries.size).toBe(1);
  });

  it('requires the exact transfer and ownership version before collecting any data', async () => {
    const ctx = setup();
    ctx.findControl.mockResolvedValue({
      ownerId: definition.ownerId,
      ownershipVersion: 2,
      transferLock: { transferId: definition.transferId },
    });
    await expect(ctx.service.begin(definition)).rejects.toThrow(
      'matching transfer reservation',
    );
    expect(ctx.repository.create.mock.calls).toHaveLength(0);
    expect(ctx.storage.inspect.mock.calls).toHaveLength(0);
  });

  it('does not publish verification when the reservation disappears during S3 work', async () => {
    const ctx = setup();
    await ctx.service.begin(definition);
    await ctx.addProfile();
    await ctx.service.seal(definition.id, 1);
    ctx.storage.copyAndVerify.mockImplementationOnce(() => {
      ctx.findControl.mockResolvedValue(null);
      return Promise.resolve({
        sha256: 'hash',
        historical: { etag: 'h', size: 12 },
        recipientStaging: { etag: 'r', size: 12 },
      });
    });
    await expect(ctx.service.copyBatch(definition.id)).rejects.toThrow(
      'matching transfer reservation',
    );
    expect(ctx.repository.completeFile.mock.calls).toHaveLength(0);
    expect([...ctx.files.values()][0].state).toBe('PENDING');
    expect(ctx.archives.get(definition.id)!.state).toBe('COPYING');
  });

  it('respects a bounded batch and reclaims an expired technical lease after restart', async () => {
    const ctx = setup();
    await ctx.service.begin(definition);
    await ctx.addProfile();
    await ctx.service.seal(definition.id, 1);
    Object.assign([...ctx.files.values()][0], {
      state: 'COPYING',
      leaseToken: 'old-worker',
      leaseUntil: '2000-01-01T00:00:00.000Z',
    });
    await expect(ctx.service.copyBatch(definition.id, 1)).resolves.toEqual({
      processed: 1,
      ready: true,
    });
    expect(ctx.repository.claimFile.mock.calls).toHaveLength(1);
  });

  it('prepares an animal without media without issuing any S3 operations', async () => {
    const ctx = setup();
    await ctx.service.begin(definition);
    await ctx.service.append(definition.id, {
      kind: 'ANIMAL',
      data: archiveAnimal,
    });
    await ctx.service.seal(definition.id, 1);
    await expect(ctx.service.copyBatch(definition.id)).resolves.toEqual({
      processed: 0,
      ready: true,
    });
    expect(ctx.storage.inspect.mock.calls).toHaveLength(0);
    expect(ctx.storage.copyAndVerify.mock.calls).toHaveLength(0);
  });

  it('does not mark a file verified after another worker took its lease', async () => {
    const ctx = setup();
    await ctx.service.begin(definition);
    await ctx.addProfile();
    await ctx.service.seal(definition.id, 1);
    ctx.repository.completeFile.mockResolvedValueOnce(false);
    await expect(ctx.service.copyBatch(definition.id)).rejects.toThrow(
      'no longer owns this file lease',
    );
    expect(ctx.archives.get(definition.id)!.state).toBe('COPYING');
    expect(ctx.repository.markReadyIfComplete.mock.calls).toHaveLength(0);
  });
});
