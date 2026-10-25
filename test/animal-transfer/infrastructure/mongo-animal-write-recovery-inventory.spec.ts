import { MongoAnimalWriteRecoveryInventory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-recovery-inventory';
import { AnimalOwnershipControl } from '../../../src/context/animal-transfer/domain/animal-ownership';

const query = (result: unknown) => {
  const q = {
    select: jest.fn(),
    sort: jest.fn(),
    limit: jest.fn(),
    read: jest.fn(),
    readConcern: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  for (const method of [
    q.select,
    q.sort,
    q.limit,
    q.read,
    q.readConcern,
    q.lean,
  ])
    method.mockReturnValue(q);
  return q;
};
const control: AnimalOwnershipControl = {
  animalId: 'animal-1',
  ownerId: 'owner',
  ownershipVersion: 1,
  activeWrites: [{ token: 'unknown-operation', startedAt: '2000-01-01' }],
};

describe('Mongo recovery inventory is observational, never a force-unlock', () => {
  const setup = () => {
    const controlRead = query([control]);
    const jobRead = query([]);
    const controls = { find: jest.fn().mockReturnValue(controlRead) };
    const jobs = { find: jest.fn().mockReturnValue(jobRead) };
    return {
      repository: new MongoAnimalWriteRecoveryInventory(
        controls as never,
        jobs as never,
      ),
      controls,
      jobs,
      controlRead,
      jobRead,
    };
  };

  it('reads a minimal primary/majority projection by animal cursor without any age predicate or mutation capability', async () => {
    const ctx = setup();
    expect(await ctx.repository.list('animal-0', 21)).toEqual([
      { control, migrationLink: 'NOT_MIGRATION' },
    ]);
    expect(ctx.controls.find).toHaveBeenCalledWith({
      animalId: { $gt: 'animal-0' },
      $or: [
        { 'activeWrites.0': { $exists: true } },
        { transferLock: { $exists: true } },
      ],
    });
    expect(ctx.controlRead.select).toHaveBeenCalledWith({
      _id: 0,
      animalId: 1,
      ownerId: 1,
      ownershipVersion: 1,
      activeWrites: 1,
      uploadsValidUntil: 1,
      transferLock: 1,
    });
    expect(ctx.controlRead.sort).toHaveBeenCalledWith({ animalId: 1 });
    expect(ctx.controlRead.limit).toHaveBeenCalledWith(21);
    expect(ctx.controlRead.read).toHaveBeenCalledWith('primary');
    expect(ctx.controlRead.readConcern).toHaveBeenCalledWith('majority');
    expect(ctx.jobs.find).not.toHaveBeenCalled();
    expect(Object.keys(ctx.controls)).toEqual(['find']);
  });

  it('enriches matching migrations in one bounded lookup and exposes missing/mismatched links without treating them as unlockable', async () => {
    const ctx = setup();
    const reserved = {
      ...control,
      activeWrites: [],
      transferLock: {
        transferId: 'media-migration:job-1',
        lockedAt: '2000-01-01',
      },
    };
    const missing = {
      ...reserved,
      animalId: 'animal-2',
      transferLock: {
        ...reserved.transferLock,
        transferId: 'media-migration:missing',
      },
    };
    const mismatch = { ...reserved, animalId: 'animal-3' };
    const other = {
      ...control,
      animalId: 'animal-4',
      transferLock: { transferId: 'archive-transfer', lockedAt: '2000-01-01' },
    };
    const migration = {
      id: 'job-1',
      animalId: control.animalId,
      ownerId: control.ownerId,
      ownershipVersion: 1,
      phase: 'PROFILE',
      revision: 7,
    };
    ctx.controlRead.exec.mockResolvedValue([
      reserved,
      missing,
      mismatch,
      other,
    ]);
    ctx.jobRead.exec.mockResolvedValue([migration]);
    const rows = await ctx.repository.list(undefined, 50);
    expect(rows.map((row) => row.migrationLink)).toEqual([
      'MATCHED',
      'MISSING',
      'MISMATCH',
      'NOT_MIGRATION',
    ]);
    expect(rows[0].migration).toEqual(migration);
    expect(rows[2].migration).toBeUndefined();
    expect(ctx.jobs.find).toHaveBeenCalledWith({
      id: { $in: ['job-1', 'missing'] },
    });
    expect(ctx.jobs.find).toHaveBeenCalledTimes(1);
    expect(ctx.jobRead.select).toHaveBeenCalledWith({
      _id: 0,
      id: 1,
      animalId: 1,
      ownerId: 1,
      ownershipVersion: 1,
      phase: 1,
      revision: 1,
      afterId: 1,
    });
    expect(ctx.jobRead.read).toHaveBeenCalledWith('primary');
    expect(ctx.jobRead.readConcern).toHaveBeenCalledWith('majority');
  });

  it('does not conceal a terminal migration that still appears reserved, or infer whether its worker has died', async () => {
    const ctx = setup();
    const reserved = {
      ...control,
      transferLock: {
        transferId: 'media-migration:job',
        lockedAt: '2000-01-01',
      },
    };
    ctx.controlRead.exec.mockResolvedValue([reserved]);
    ctx.jobRead.exec.mockResolvedValue([
      { id: 'job', ...control, phase: 'STOPPED', revision: 1 },
    ]);
    const rows = await ctx.repository.list(undefined, 20);
    expect(rows[0].migrationLink).toBe('MATCHED');
    expect(rows[0].migration?.phase).toBe('STOPPED');
    expect(rows[0].control.activeWrites).toEqual(control.activeWrites);
  });

  it('rejects invalid limits, avoids empty lookups and propagates unavailable reads', async () => {
    const ctx = setup();
    await expect(ctx.repository.list(undefined, 52)).rejects.toThrow(
      'Invalid inventory page',
    );
    expect(ctx.controls.find).not.toHaveBeenCalled();
    ctx.controlRead.exec.mockResolvedValue([]);
    expect(await ctx.repository.list(undefined, 20)).toEqual([]);
    expect(ctx.jobs.find).not.toHaveBeenCalled();
    ctx.controlRead.exec.mockRejectedValue(new Error('Read unavailable'));
    await expect(ctx.repository.list(undefined, 20)).rejects.toThrow(
      'Read unavailable',
    );
  });
});
