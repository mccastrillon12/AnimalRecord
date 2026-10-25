import { LegacyAnimalMediaMigration } from '../../../src/context/animal-media/application/legacy-animal-media-migration';
import {
  LegacyMediaCopier,
  LegacyMediaMigrationRepository,
  MediaMigration,
  MediaMigrationDefinition,
  MigrationPage,
} from '../../../src/context/animal-media/domain/legacy-media-migration';

const definition: MediaMigrationDefinition = {
  id: '123e4567-e89b-42d3-a456-426614174020',
  ownerId: '123e4567-e89b-42d3-a456-426614174001',
  animalId: '123e4567-e89b-42d3-a456-426614174010',
  ownershipVersion: 1,
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('Explicit legacy media migration orchestration', () => {
  const setup = () => {
    let persisted: MediaMigration | null = {
      ...definition,
      phase: 'PROFILE',
      revision: 0,
    };
    let failCheckpoint = false;
    const pages: MigrationPage[] = [
      {
        references: [{ kind: 'PROFILE', url: 'old-picture' }],
        next: { phase: 'DIARY' },
      },
      {
        references: [
          {
            kind: 'DIARY',
            entryId: 'entry-1',
            attachmentId: 'a',
            url: 'old-a',
          },
        ],
        next: { phase: 'DIARY', afterId: 'entry-20' },
      },
      {
        references: [
          {
            kind: 'DIARY',
            entryId: 'entry-21',
            attachmentId: 'b',
            url: 'old-b',
          },
        ],
        next: { phase: 'COMPLETED' },
      },
    ];
    const jobs: jest.Mocked<LegacyMediaMigrationRepository> = {
      start: jest
        .fn()
        .mockImplementation(() => Promise.resolve(clone(persisted!))),
      find: jest
        .fn()
        .mockImplementation(() => Promise.resolve(clone(persisted))),
      readPage: jest
        .fn()
        .mockImplementation((job: MediaMigration) =>
          Promise.resolve(clone(pages[job.revision])),
        ),
      commitPage: jest
        .fn()
        .mockImplementation((job: MediaMigration, page: MigrationPage) => {
          if (failCheckpoint)
            return Promise.reject(new Error('Checkpoint failed'));
          if (persisted!.revision === job.revision)
            persisted = { ...job, ...page.next, revision: job.revision + 1 };
          return Promise.resolve();
        }),
    };
    const copier: jest.Mocked<LegacyMediaCopier> = {
      prepare: jest
        .fn()
        .mockImplementation((_job, ref: { url: string }) =>
          Promise.resolve(`sealed:${ref.url}`),
        ),
    };
    return {
      service: new LegacyAnimalMediaMigration(jobs, copier),
      jobs,
      copier,
      fail: () => {
        failCheckpoint = true;
      },
      recover: () => {
        failCheckpoint = false;
      },
      missing: () => {
        persisted = null;
      },
    };
  };

  it('validates explicit job identity/version before any repository call', async () => {
    const ctx = setup();
    for (const bad of [
      { ...definition, id: 'bad' },
      { ...definition, ownershipVersion: 0 },
      { ...definition, ownershipVersion: 1.5 },
    ])
      await expect(ctx.service.start(bad)).rejects.toThrow(
        'Invalid media migration',
      );
    expect(ctx.jobs.start.mock.calls).toHaveLength(0);
    await expect(ctx.service.start(definition)).resolves.toMatchObject({
      phase: 'PROFILE',
    });
  });

  it('advances one bounded page at a time, resumes with the persisted cursor, then stops without recopying', async () => {
    const ctx = setup();
    await expect(
      ctx.service.migrateBatch(definition.id),
    ).resolves.toMatchObject({ phase: 'DIARY', revision: 1 });
    const restarted = new LegacyAnimalMediaMigration(ctx.jobs, ctx.copier);
    await expect(restarted.migrateBatch(definition.id)).resolves.toMatchObject({
      afterId: 'entry-20',
      revision: 2,
    });
    await expect(restarted.migrateBatch(definition.id)).resolves.toMatchObject({
      phase: 'COMPLETED',
      revision: 3,
    });
    await restarted.migrateBatch(definition.id);
    expect(ctx.jobs.readPage.mock.calls).toHaveLength(3);
    for (const call of ctx.jobs.readPage.mock.calls) expect(call[1]).toBe(20);
    expect(ctx.jobs.commitPage.mock.calls[0][2]).toEqual([
      {
        before: { kind: 'PROFILE', url: 'old-picture' },
        afterUrl: 'sealed:old-picture',
      },
    ]);
    expect(ctx.copier.prepare.mock.calls).toHaveLength(3);
  });

  it('does not checkpoint or activate references if copy verification fails', async () => {
    const ctx = setup();
    ctx.copier.prepare.mockRejectedValueOnce(new Error('S3 uncertain'));
    await expect(ctx.service.migrateBatch(definition.id)).rejects.toThrow(
      'S3 uncertain',
    );
    expect(ctx.jobs.commitPage.mock.calls).toHaveLength(0);
    expect(await ctx.jobs.find(definition.id)).toMatchObject({
      phase: 'PROFILE',
      revision: 0,
    });
  });

  it('replays the same page after checkpoint failure without inventing a new identity or cursor', async () => {
    const ctx = setup();
    ctx.fail();
    await expect(ctx.service.migrateBatch(definition.id)).rejects.toThrow(
      'Checkpoint failed',
    );
    expect(await ctx.jobs.find(definition.id)).toMatchObject({ revision: 0 });
    ctx.recover();
    await ctx.service.migrateBatch(definition.id);
    expect(ctx.copier.prepare.mock.calls[0]).toEqual(
      ctx.copier.prepare.mock.calls[1],
    );
    expect(await ctx.jobs.find(definition.id)).toMatchObject({ revision: 1 });
  });

  it('concurrent workers cannot regress or double advance the same persisted revision', async () => {
    const ctx = setup();
    await Promise.all([
      ctx.service.migrateBatch(definition.id),
      ctx.service.migrateBatch(definition.id),
    ]);
    expect(await ctx.jobs.find(definition.id)).toMatchObject({ revision: 1 });
  });

  it('does not rewrite already protected references and rejects missing jobs', async () => {
    const ctx = setup();
    ctx.copier.prepare.mockResolvedValue('old-picture');
    await ctx.service.migrateBatch(definition.id);
    expect(ctx.jobs.commitPage.mock.calls[0][2]).toEqual([]);
    ctx.missing();
    await expect(ctx.service.migrateBatch(definition.id)).rejects.toThrow(
      'not found',
    );
  });

  it('after a lost commit response resumes from the durable next phase, not the old references', async () => {
    const ctx = setup();
    const commit = ctx.jobs.commitPage.getMockImplementation()!;
    ctx.jobs.commitPage.mockImplementationOnce(async (...args) => {
      await commit(...args);
      throw new Error('Commit acknowledgement lost');
    });
    await expect(ctx.service.migrateBatch(definition.id)).rejects.toThrow(
      'acknowledgement lost',
    );
    expect(await ctx.jobs.find(definition.id)).toMatchObject({
      phase: 'DIARY',
      revision: 1,
    });
    await ctx.service.migrateBatch(definition.id);
    expect(ctx.copier.prepare.mock.calls.map(([, ref]) => ref.url)).toEqual([
      'old-picture',
      'old-a',
    ]);
  });
});
