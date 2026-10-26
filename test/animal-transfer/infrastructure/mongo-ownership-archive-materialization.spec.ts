import { MongoOwnershipArchiveMaterialization } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-materialization';
import { OwnershipArchiveMaterializer } from '../../../src/context/animal-transfer/application/ownership-archive-materializer';
import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import {
  OwnershipArchiveSchema,
  OwnershipArchiveFileSchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { AnimalOwnershipControlSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { materializationFixture } from '../fixtures/ownership-archive-materialization.fixture';
import { buildArchiveMaterialization } from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import {
  historyClone as clone,
  historyUuid,
} from '../fixtures/ownership-archive-history.fixture';

const query = <T>(value: T) => {
  const q = {
    session: jest.fn(),
    lean: jest.fn(),
    select: jest.fn(),
    sort: jest.fn(),
    exec: jest.fn(() => Promise.resolve(clone(value))),
  };
  q.session.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.sort.mockReturnValue(q);
  return q;
};
describe('Mongo materialization evidence and work fences', () => {
  const setup = () => {
    const s = materializationFixture();
    const token = historyUuid(500);
    const state = {
      active: true,
      control: true,
      plan: true,
      file: true,
      saved: true,
      pending: true,
      count: 1,
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
      findOne: jest.fn(() => query(s.archive)),
      updateOne: jest.fn(() => query({ modifiedCount: state.saved ? 1 : 0 })),
    };
    const entries = {
      findOne: jest.fn(() => query(state.plan ? s.entry : null)),
    };
    const files = {
      findOne: jest.fn(() => query(state.file ? s.file : null)),
      updateOne: jest.fn(() => query({ modifiedCount: state.saved ? 1 : 0 })),
      countDocuments: jest.fn(() => query(state.count)),
      exists: jest.fn(() => query(state.pending ? { _id: 'pending' } : null)),
    };
    const controls = {
      updateOne: jest.fn(() => query({ modifiedCount: state.control ? 1 : 0 })),
    };
    const periods = {
      exists: jest.fn(() => query(state.active ? { _id: 'active' } : null)),
    };
    const repository = new MongoOwnershipArchiveMaterialization(
      archives as never,
      entries as never,
      files as never,
      controls as never,
      periods as never,
    );
    const claim = () =>
      repository.claim(
        s.archive.id,
        token,
        '2026-10-25T10:00:00.000Z',
        '2026-10-25T10:05:00.000Z',
      );
    return {
      ...s,
      token,
      state,
      commit,
      session,
      archives,
      entries,
      files,
      controls,
      periods,
      repository,
      claim,
    };
  };
  it('starts explicitly and leaves previous headers without defaults/backfill', async () => {
    const s = setup();
    delete s.archive.materialization;
    const archive = await s.repository.start(s.archive.id);
    expect(archive.materialization!.phase).toBe('MATERIALIZING');
    expect(s.archives.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        materialization: { $exists: false },
        state: 'READY',
      }),
      expect.objectContaining({
        $set: { materialization: archive.materialization },
      }),
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
  });
  it('claims a fixed intent using a drained control fence and the persisted reference plan', async () => {
    const s = setup();
    await expect(s.claim()).resolves.toEqual(s.intent);
    expect(s.controls.updateOne).toHaveBeenCalledWith(
      {
        animalId: s.archive.animalId,
        ownerId: s.archive.ownerId,
        ownershipVersion: 1,
        'transferLock.transferId': s.archive.transferId,
        $expr: { $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0] },
      },
      { $inc: { archiveMaterializationRevision: 1 } },
      { session: s.session },
    );
    expect(s.files.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'VERIFIED',
        $or: expect.arrayContaining([
          {
            'materialization.state': 'MATERIALIZING',
            'materialization.leaseUntil': { $lte: '2026-10-25T10:00:00.000Z' },
          },
        ]) as unknown,
      }),
    );
    expect(s.entries.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        'referencePlan.bindings.fileId': s.file.id,
        $expr: { $eq: ['$referencePlan.sourceContentHash', '$contentHash'] },
      }),
    );
    expect(s.files.updateOne).toHaveBeenCalledWith(
      {
        id: s.file.id,
        archiveId: s.archive.id,
        state: 'VERIFIED',
        materialization: { $exists: false },
      },
      {
        $set: {
          materialization: {
            intent: s.intent,
            state: 'MATERIALIZING',
            leaseToken: s.token,
            leaseUntil: '2026-10-25T10:05:00.000Z',
          },
        },
      },
      { session: s.session },
    );
  });
  it.each([
    'period',
    'control',
    'plan',
    'changed intent',
    'changed reference plan',
  ])('refuses %s without committing a file intent', async (problem) => {
    const s = setup();
    if (problem === 'period') s.state.active = false;
    if (problem === 'control') s.state.control = false;
    if (problem === 'plan') s.state.plan = false;
    if (problem === 'changed intent')
      s.file.materialization = {
        intent: { ...s.intent, sha256: 'b'.repeat(64) },
        state: 'PENDING',
      };
    if (problem === 'changed reference plan')
      s.archive.referencePlan!.revision++;
    await expect(s.claim()).rejects.toThrow();
    expect(s.files.updateOne).not.toHaveBeenCalled();
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.session.endSession).toHaveBeenCalledTimes(1);
  });
  it('does not confirm or release another worker token after a lease was reclaimed', async () => {
    const s = setup();
    s.file.materialization = {
      intent: s.intent,
      state: 'MATERIALIZING',
      leaseToken: 'new-worker',
    };
    await expect(
      s.repository.complete(s.intent, s.token, { etag: 'final', size: 12 }),
    ).resolves.toBe(false);
    expect(s.files.updateOne).not.toHaveBeenCalled();
    await s.repository.release(s.intent, s.token);
    expect(s.files.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        'materialization.leaseToken': s.token,
        'materialization.intent.definitionHash': s.intent.definitionHash,
      }),
      expect.objectContaining({ $set: { 'materialization.state': 'PENDING' } }),
      { session: s.session },
    );
  });
  it('records only verified output under its current token and immutable intent', async () => {
    const s = setup();
    s.file.materialization = {
      intent: s.intent,
      state: 'MATERIALIZING',
      leaseToken: s.token,
    };
    await expect(
      s.repository.complete(s.intent, s.token, {
        etag: 'final',
        size: 12,
        versionId: 'final-v1',
      }),
    ).resolves.toBe(true);
    expect(s.files.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        'materialization.state': 'MATERIALIZING',
        'materialization.leaseToken': s.token,
      }),
      expect.objectContaining({
        $set: {
          'materialization.state': 'VERIFIED',
          'materialization.verified': {
            etag: 'final',
            size: 12,
            versionId: 'final-v1',
          },
        },
      }),
      { session: s.session },
    );
  });
  it('does not adopt a new stage revision after a partial attempt or uncertain reply', async () => {
    const s = setup();
    s.file.materialization = { intent: s.intent, state: 'PENDING' };
    s.file.verified!.recipientStaging.etag = 'new-stage';
    await expect(s.claim()).rejects.toThrow();
    expect(s.files.updateOne).not.toHaveBeenCalled();
  });
  it('only marks complete with the exact manifest count and no unverified intent', async () => {
    const s = setup();
    await expect(s.repository.markComplete(s.archive.id)).resolves.toBe(false);
    s.state.pending = false;
    s.state.count = 0;
    await expect(s.repository.markComplete(s.archive.id)).resolves.toBe(false);
    s.state.count = 1;
    await expect(s.repository.markComplete(s.archive.id)).resolves.toBe(true);
    expect(s.archives.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        'materialization.phase': 'MATERIALIZING',
        'materialization.definitionHash':
          s.archive.materialization!.definitionHash,
      }),
      expect.objectContaining({
        $set: { 'materialization.phase': 'MATERIALIZED' },
      }),
      { session: s.session },
    );
  });
  it('does not restart work after MATERIALIZED or conceal inconsistent recorded completion', async () => {
    const s = setup();
    s.archive.materialization!.phase = 'MATERIALIZED';
    await expect(s.claim()).resolves.toBeNull();
    expect(s.files.findOne).not.toHaveBeenCalled();
    await expect(s.repository.markComplete(s.archive.id)).rejects.toThrow(
      'no longer matches',
    );
    s.state.pending = false;
    await expect(s.repository.markComplete(s.archive.id)).resolves.toBe(true);
  });
  it('handles an empty file manifest without claiming any remote copy', async () => {
    const s = setup();
    s.archive.expectedFileCount = 0;
    s.archive.materialization = buildArchiveMaterialization(s.archive);
    s.state.pending = false;
    s.state.count = 0;
    await expect(s.repository.markComplete(s.archive.id)).resolves.toBe(true);
  });
  it('exports an internal service with optional fields and no TTL or controller', () => {
    expect(
      Reflect.getMetadata('exports', OwnershipArchiveModule) as unknown[],
    ).toContain(OwnershipArchiveMaterializer);
    expect(
      Reflect.getMetadata('controllers', OwnershipArchiveModule),
    ).toBeUndefined();
    for (const field of [
      OwnershipArchiveSchema.path('materialization'),
      OwnershipArchiveFileSchema.path('materialization'),
      AnimalOwnershipControlSchema.path('archiveMaterializationRevision'),
    ]) {
      expect(field.options.default).toBeUndefined();
      expect(field.options.required).not.toBe(true);
    }
    for (const schema of [
      OwnershipArchiveSchema,
      OwnershipArchiveFileSchema,
      AnimalOwnershipControlSchema,
    ])
      expect(
        schema.indexes().every(([, o]) => o.expireAfterSeconds === undefined),
      ).toBe(true);
  });
});
