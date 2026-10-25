import {
  MongoLegacyMediaMigrationRepository,
  LegacyMediaMigrationSchema,
} from '../../../src/context/animal-media/infrastructure/mongo-legacy-media-migration-repository';
import {
  MediaMigration,
  MigrationPage,
  mediaMigrationLockId,
} from '../../../src/context/animal-media/domain/legacy-media-migration';
import { drainedAnimalReservationFilter } from '../../../src/context/animal-transfer/domain/drained-animal-reservation-filter';

const job: MediaMigration = {
  id: 'job',
  animalId: 'animal',
  ownerId: 'owner',
  ownershipVersion: 1,
  phase: 'PROFILE',
  revision: 0,
};
const url = 'https://bucket/users/owner/animals/animal/profile_1.jpeg';
const afterUrl = 'https://bucket/users/owner/animals/animal/profile_2.jpeg';
const page: MigrationPage = {
  references: [{ kind: 'PROFILE', url }],
  next: { phase: 'DIARY' },
};
const change = { before: page.references[0], afterUrl };
const query = (data: unknown) => {
  const q = {
    session: jest.fn(),
    select: jest.fn(),
    sort: jest.fn(),
    limit: jest.fn(),
    read: jest.fn(),
    readConcern: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(data),
  };
  for (const method of [
    q.session,
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

describe('Mongo legacy migration protocol (models/session simulated)', () => {
  const setup = () => {
    const session = {
      withTransaction: jest.fn(async (op: () => Promise<void>) => op()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const jobRead = query(job),
      animalRead = query({ id: 'animal', profilePictureUrl: url }),
      periodRead = query({ id: 'period' });
    const controlRead = query({ animalId: 'animal' }),
      diaryRead = query([]);
    const ticketRead = query({
      pinned: { sha256: 'hash' },
      sealed: { etag: 'final' },
      legacy: { kind: 'PROFILE' },
    });
    const jobWrite = query({ matchedCount: 1 }),
      controlWrite = query({ matchedCount: 1 });
    const animalWrite = query({ matchedCount: 1 }),
      diaryWrite = query({ matchedCount: 1 });
    const jobs = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      findOne: jest.fn().mockReturnValue(jobRead),
      create: jest.fn().mockResolvedValue([job]),
      updateOne: jest.fn().mockReturnValue(jobWrite),
    };
    const animals = {
      findOne: jest.fn().mockReturnValue(animalRead),
      updateOne: jest.fn().mockReturnValue(animalWrite),
    };
    const controls = {
      findOne: jest.fn().mockReturnValue(controlRead),
      updateOne: jest.fn().mockReturnValue(controlWrite),
    };
    const periods = { findOne: jest.fn().mockReturnValue(periodRead) };
    const diary = {
      find: jest.fn().mockReturnValue(diaryRead),
      updateOne: jest.fn().mockReturnValue(diaryWrite),
    };
    const uploads = { findOne: jest.fn().mockReturnValue(ticketRead) };
    const storage = {
      keyFromUrl: (value: string) => value.replace('https://bucket/', ''),
    };
    const repository = new MongoLegacyMediaMigrationRepository(
      jobs as never,
      animals as never,
      diary as never,
      controls as never,
      periods as never,
      uploads as never,
      storage as never,
    );
    return {
      repository,
      session,
      jobs,
      animals,
      controls,
      periods,
      diary,
      uploads,
      jobRead,
      animalRead,
      periodRead,
      controlRead,
      diaryRead,
      ticketRead,
      jobWrite,
      controlWrite,
      animalWrite,
      diaryWrite,
    };
  };

  it('creates the job and claims a drained reservation in one majority/snapshot transaction', async () => {
    const ctx = setup();
    ctx.jobs.findOne.mockReturnValueOnce(query(null));
    await ctx.repository.start(job);
    expect(ctx.controls.updateOne).toHaveBeenCalledWith(
      drainedAnimalReservationFilter('animal', 'owner', 1),
      expect.objectContaining({
        $set: {
          transferLock: {
            transferId: mediaMigrationLockId(job.id),
            lockedAt: expect.any(String) as unknown,
          },
        },
      }),
      { session: ctx.session },
    );
    expect(ctx.jobs.create).toHaveBeenCalledWith([{ ...job }], {
      session: ctx.session,
    });
    expect(ctx.session.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
    );
    expect(ctx.session.endSession).toHaveBeenCalledTimes(1);
  });

  it('retries an existing definition without acquiring a second reservation, and rejects ID reuse', async () => {
    const ctx = setup();
    await ctx.repository.start(job);
    expect(ctx.controls.updateOne).not.toHaveBeenCalled();
    await expect(
      ctx.repository.start({ ...job, ownerId: 'other' }),
    ).rejects.toThrow('different definition');
  });

  it.each(['animal', 'period', 'busy'])(
    'fails closed before job creation when %s is inconsistent',
    async (kind) => {
      const ctx = setup();
      ctx.jobs.findOne.mockReturnValueOnce(query(null));
      if (kind === 'animal') ctx.animalRead.exec.mockResolvedValue(null);
      if (kind === 'period') ctx.periodRead.exec.mockResolvedValue(null);
      if (kind === 'busy')
        ctx.controlWrite.exec.mockResolvedValue({ matchedCount: 0 });
      await expect(ctx.repository.start(job)).rejects.toThrow();
      expect(ctx.jobs.create).not.toHaveBeenCalled();
      expect(ctx.session.endSession).toHaveBeenCalledTimes(1);
    },
  );

  it('reads projections from primary/majority and traverses exact diary pages by ID without filtering out media', async () => {
    const ctx = setup();
    expect(await ctx.repository.readPage(job, 20)).toEqual(page);
    const entries = Array.from({ length: 20 }, (_, i) => ({
      id: `entry-${String(i).padStart(2, '0')}`,
      attachments: [],
    }));
    ctx.diaryRead.exec.mockResolvedValue(entries);
    const diaryJob: MediaMigration = {
      ...job,
      phase: 'DIARY',
      revision: 1,
      afterId: 'entry-00',
    };
    // A result including the previous cursor is rejected, not silently skipped.
    await expect(ctx.repository.readPage(diaryJob, 20)).rejects.toThrow(
      'cursor',
    );
    delete diaryJob.afterId;
    expect((await ctx.repository.readPage(diaryJob, 20)).next).toEqual({
      phase: 'DIARY',
      afterId: 'entry-19',
    });
    expect(ctx.diaryRead.limit).toHaveBeenCalledWith(20);
    expect(ctx.diaryRead.read).toHaveBeenCalledWith('primary');
    expect(ctx.diaryRead.readConcern).toHaveBeenCalledWith('majority');
    ctx.diaryRead.exec.mockResolvedValue([]);
    expect(
      (await ctx.repository.readPage({ ...diaryJob, afterId: 'entry-19' }, 20))
        .next.phase,
    ).toBe('COMPLETED');
    expect(ctx.diary.find).toHaveBeenLastCalledWith({
      animalId: 'animal',
      id: { $gt: 'entry-19' },
    });
  });

  it('rejects lost reservations, invalid limits and duplicate attachment identities', async () => {
    const ctx = setup();
    await expect(ctx.repository.readPage(job, 21)).rejects.toThrow('page size');
    ctx.controlRead.exec.mockResolvedValueOnce(null);
    await expect(ctx.repository.readPage(job, 20)).rejects.toThrow(
      'reservation',
    );
    ctx.diaryRead.exec.mockResolvedValue([
      { id: 'entry', attachments: [{ id: 'same' }, { id: 'same' }] },
    ]);
    await expect(
      ctx.repository.readPage({ ...job, phase: 'DIARY' }, 20),
    ).rejects.toThrow('duplicate attachments');
  });

  it('writes the reservation fence, sealed provenance, URL-only CAS and cursor in the same session', async () => {
    const ctx = setup();
    await ctx.repository.commitPage(job, page, [change]);
    expect(ctx.jobs.updateOne).toHaveBeenCalledWith(
      { id: 'job', phase: 'PROFILE', revision: 0 },
      {
        $set: { phase: 'DIARY' },
        $unset: { afterId: 1 },
        $inc: { revision: 1 },
      },
      { session: ctx.session },
    );
    expect(ctx.controls.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        'transferLock.transferId': 'media-migration:job',
        'activeWrites.0': { $exists: false },
      }),
      { $inc: { mediaMigrationRevision: 1 } },
      { session: ctx.session },
    );
    expect(ctx.uploads.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        'legacy.sourceUrl': url,
        'legacy.migrationId': 'job',
        sealed: { $exists: true },
      }),
    );
    expect(ctx.animals.updateOne).toHaveBeenCalledWith(
      { id: 'animal', ownerId: 'owner', profilePictureUrl: url },
      { $set: { profilePictureUrl: afterUrl } },
      { session: ctx.session },
    );
  });

  it('an obsolete page cannot write references or release a reservation after another checkpoint won', async () => {
    const ctx = setup();
    ctx.jobWrite.exec.mockResolvedValue({ matchedCount: 0 });
    await ctx.repository.commitPage(job, page, [change]);
    expect(ctx.controls.updateOne).not.toHaveBeenCalled();
    expect(ctx.animals.updateOne).not.toHaveBeenCalled();
  });

  it.each(['lock', 'ticket', 'reference'])(
    'rejects a page on %s conflict within the transaction instead of acknowledging partial success',
    async (kind) => {
      const ctx = setup();
      if (kind === 'lock')
        ctx.controlWrite.exec.mockResolvedValue({ matchedCount: 0 });
      if (kind === 'ticket') ctx.ticketRead.exec.mockResolvedValue(null);
      if (kind === 'reference')
        ctx.animalWrite.exec.mockResolvedValue({ matchedCount: 0 });
      await expect(
        ctx.repository.commitPage(job, page, [change]),
      ).rejects.toThrow();
      expect(ctx.controls.updateOne).not.toHaveBeenCalledWith(
        expect.anything(),
        { $unset: { transferLock: 1 } },
        expect.anything(),
      );
      expect(ctx.session.endSession).toHaveBeenCalledTimes(1);
    },
  );

  it('changes only the matched diary URL and atomically releases only its own reservation at completion', async () => {
    const ctx = setup();
    const before = {
      kind: 'DIARY' as const,
      entryId: 'entry',
      attachmentId: 'attachment',
      mimeType: 'audio/mp4',
      size: 4,
      url,
    };
    ctx.ticketRead.exec.mockResolvedValue({
      pinned: {},
      sealed: {},
      legacy: { entryId: 'entry', attachmentId: 'attachment' },
    });
    await ctx.repository.commitPage(
      { ...job, phase: 'DIARY', revision: 1 },
      { references: [before], next: { phase: 'COMPLETED' } },
      [{ before, afterUrl }],
    );
    expect(ctx.diary.updateOne).toHaveBeenCalledWith(
      {
        id: 'entry',
        animalId: 'animal',
        attachments: {
          $elemMatch: { id: 'attachment', url, mimeType: 'audio/mp4', size: 4 },
        },
      },
      { $set: { 'attachments.$.url': afterUrl } },
      { session: ctx.session },
    );
    expect(ctx.controls.updateOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'transferLock.transferId': 'media-migration:job',
      }),
      { $unset: { transferLock: 1 } },
      { session: ctx.session },
    );
    expect(ctx.animals.updateOne).not.toHaveBeenCalled();
  });

  it('requires a unique durable job identity and never adds TTL cleanup', () => {
    expect(LegacyMediaMigrationSchema.indexes()).toContainEqual([
      { id: 1 },
      { unique: true, background: true },
    ]);
    expect(
      LegacyMediaMigrationSchema.indexes().some(
        ([, options]) => options.expireAfterSeconds !== undefined,
      ),
    ).toBe(false);
  });

  it('does not reacquire or unlock after an uncertain start acknowledgement; the same ID resumes its persisted job', async () => {
    const ctx = setup();
    ctx.jobs.findOne.mockReturnValueOnce(query(null));
    ctx.session.withTransaction.mockImplementationOnce(async (operation) => {
      await operation();
      throw new Error('Commit acknowledgement lost');
    });
    await expect(ctx.repository.start(job)).rejects.toThrow(
      'acknowledgement lost',
    );
    await expect(ctx.repository.start(job)).resolves.toEqual(job);
    expect(ctx.controls.updateOne).toHaveBeenCalledTimes(1);
    expect(ctx.jobs.create).toHaveBeenCalledTimes(1);
  });

  it('rejects regressing cursors and changes not selected by the page before opening a transaction', async () => {
    const ctx = setup();
    await expect(
      ctx.repository.commitPage(
        { ...job, phase: 'DIARY', afterId: 'z' },
        { references: [], next: { phase: 'DIARY', afterId: 'a' } },
        [],
      ),
    ).rejects.toThrow('Invalid migration page');
    await expect(
      ctx.repository.commitPage(job, { ...page, references: [] }, [change]),
    ).rejects.toThrow('Invalid migration page');
    expect(ctx.jobs.db.startSession).not.toHaveBeenCalled();
  });
});
