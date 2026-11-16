import {
  AnimalWriteJournalSchema,
  MongoAnimalWriteJournal,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';
import { AnimalWriteJournal } from '../../../src/context/animal-transfer/domain/animal-write-journal';

const entry: AnimalWriteJournal = {
  protocol: 'TRANSACTIONAL_CLAIMS_V1',
  id: 'operation',
  instanceId: 'instance',
  instanceStartedAt: '2026-10-25',
  actorId: 'owner',
  createdAt: '2026-10-25',
  updatedAt: '2026-10-25',
  kind: 'ANIMAL_UPDATE',
  issuesUploadUrl: false,
  lifecycle: 'OPEN',
  callback: 'NOT_STARTED',
  claims: [
    { animalId: 'animal', state: 'NOT_ATTEMPTED', updatedAt: '2026-10-25' },
  ],
};
const handle = { id: entry.id, instanceId: entry.instanceId };
const majority = { writeConcern: { w: 'majority' } };

describe('Mongo write journal transition guards (simulated model)', () => {
  const setup = () => {
    const read = {
      select: jest.fn(),
      read: jest.fn(),
      readConcern: jest.fn(),
      lean: jest.fn(),
      exec: jest.fn().mockResolvedValue(entry),
    };
    for (const method of [read.select, read.read, read.readConcern, read.lean])
      method.mockReturnValue(read);
    const write = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const model = {
      create: jest.fn().mockResolvedValue([entry]),
      findOne: jest.fn().mockReturnValue(read),
      updateOne: jest.fn().mockReturnValue({ exec: write }),
    };
    return {
      repository: new MongoAnimalWriteJournal(model as never),
      model,
      read,
      write,
    };
  };

  it('creates with majority without upsert/reusing an operation ID, and propagates uncertain persistence errors', async () => {
    const ctx = setup();
    await ctx.repository.create(entry);
    expect(ctx.model.create).toHaveBeenCalledWith([entry], { w: 'majority' });
    ctx.model.create.mockRejectedValueOnce({ code: 11000 });
    await expect(ctx.repository.create(entry)).rejects.toThrow(
      'ID has already been used',
    );
    const error = new Error('Unknown write acknowledgement');
    ctx.model.create.mockRejectedValueOnce(error);
    await expect(ctx.repository.create(entry)).rejects.toBe(error);
  });

  it('reads internal evidence from primary/majority without Mongo identity/version fields', async () => {
    const ctx = setup();
    await expect(ctx.repository.find('operation')).resolves.toEqual(entry);
    expect(ctx.model.findOne).toHaveBeenCalledWith({ id: 'operation' });
    expect(ctx.read.select).toHaveBeenCalledWith({ _id: 0, __v: 0 });
    expect(ctx.read.read).toHaveBeenCalledWith('primary');
    expect(ctx.read.readConcern).toHaveBeenCalledWith('majority');
  });

  it('rejects empty/duplicate scope or pre-completed journals instead of inventing initial evidence', async () => {
    const ctx = setup();
    for (const invalid of [
      { ...entry, claims: [] },
      { ...entry, claims: [entry.claims[0], entry.claims[0]] },
      { ...entry, lifecycle: 'LOCALLY_FINISHED' as const },
      { ...entry, callback: 'RETURNED' as const },
    ])
      await expect(ctx.repository.create(invalid)).rejects.toThrow(
        'Invalid initial',
      );
    expect(ctx.model.create).not.toHaveBeenCalled();
  });

  it('persists INTENT/version only for its own open operation and previously unattempted animal', async () => {
    const ctx = setup();
    await ctx.repository.claim(handle, 'animal', 'INTENT', 'now', 2);
    expect(ctx.model.updateOne).toHaveBeenCalledWith(
      {
        ...handle,
        lifecycle: 'OPEN',
        callback: 'NOT_STARTED',
        claims: {
          $elemMatch: { animalId: 'animal', state: { $in: ['NOT_ATTEMPTED'] } },
        },
      },
      {
        $set: {
          'claims.$.state': 'INTENT',
          'claims.$.updatedAt': 'now',
          'claims.$.ownershipVersion': 2,
          updatedAt: 'now',
        },
      },
      majority,
    );
    await expect(
      ctx.repository.claim(handle, 'animal', 'INTENT', 'now', 0),
    ).rejects.toThrow('Invalid animal write');
    expect(ctx.model.updateOne).toHaveBeenCalledTimes(1);
  });

  it.each(['ACQUIRED', 'NOT_ACQUIRED', 'ACQUIRE_UNKNOWN'] as const)(
    'records %s only from persisted INTENT',
    async (state) => {
      const ctx = setup();
      await ctx.repository.claim(handle, 'animal', state, 'now');
      expect(ctx.model.updateOne).toHaveBeenCalledWith(
        {
          ...handle,
          lifecycle: 'OPEN',
          claims: {
            $elemMatch: {
              animalId: 'animal',
              state: { $in: [state === 'ACQUIRED' ? 'ACQUIRED' : 'INTENT'] },
            },
          },
        },
        {
          $set: {
            'claims.$.state': state,
            'claims.$.updatedAt': 'now',
            updatedAt: 'now',
          },
        },
        majority,
      );
    },
  );

  it.each(['RELEASED', 'RELEASE_UNKNOWN'] as const)(
    'does not turn unknown acquisition into an authorized release (%s)',
    async (state) => {
      const ctx = setup();
      await ctx.repository.claim(handle, 'animal', state, 'now');
      expect(ctx.model.updateOne).toHaveBeenCalledWith(
        {
          ...handle,
          lifecycle: 'OPEN',
          claims: {
            $elemMatch: {
              animalId: 'animal',
              state: { $in: ['INTENT', 'ACQUIRED'] },
            },
          },
        },
        expect.anything(),
        majority,
      );
    },
  );

  it('permits callback exactly once with a nonempty scope and every acquisition known', async () => {
    const ctx = setup();
    await ctx.repository.permitCallback(handle, 'now');
    expect(ctx.model.updateOne).toHaveBeenCalledWith(
      {
        ...handle,
        lifecycle: 'OPEN',
        callback: 'NOT_STARTED',
        protocol: 'TRANSACTIONAL_CLAIMS_V1',
        callbackPermittedAt: { $exists: false },
        'claims.0': { $exists: true },
        claims: { $not: { $elemMatch: { state: { $ne: 'ACQUIRED' } } } },
      },
      {
        $set: {
          callback: 'MAY_RUN',
          callbackPermittedAt: 'now',
          updatedAt: 'now',
        },
      },
      majority,
    );
    ctx.write.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(ctx.repository.permitCallback(handle, 'now')).rejects.toThrow(
      'journal changed',
    );
  });

  it('distinguishes possible execution from NOT_INVOKED and local callback outcomes, with guarded majority updates', async () => {
    const ctx = setup();
    await ctx.repository.settleCallback(handle, 'NOT_INVOKED', 'now');
    expect(ctx.model.updateOne).toHaveBeenLastCalledWith(
      {
        ...handle,
        lifecycle: 'OPEN',
        callback: { $in: ['NOT_STARTED', 'MAY_RUN'] },
      },
      {
        $set: {
          callback: 'NOT_INVOKED',
          callbackSettledAt: 'now',
          updatedAt: 'now',
        },
      },
      majority,
    );
    await ctx.repository.settleCallback(handle, 'THREW', 'then');
    expect(ctx.model.updateOne).toHaveBeenLastCalledWith(
      { ...handle, lifecycle: 'OPEN', callback: { $in: ['MAY_RUN'] } },
      {
        $set: {
          callback: 'THREW',
          callbackSettledAt: 'then',
          updatedAt: 'then',
        },
      },
      majority,
    );
  });

  it('does not close over unknown claims or an unsettled callback, even after recording a local coordinator outcome', async () => {
    const ctx = setup();
    ctx.write
      .mockResolvedValueOnce({ matchedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0 });
    await ctx.repository.finish(handle, 'THREW', 'now');
    const settled = ['RETURNED', 'THREW', 'NOT_INVOKED'];
    expect(ctx.model.updateOne).toHaveBeenNthCalledWith(
      1,
      {
        ...handle,
        lifecycle: 'OPEN',
        callback: { $in: settled },
        coordinatorOutcome: { $exists: false },
      },
      {
        $set: {
          coordinatorOutcome: 'THREW',
          coordinatorSettledAt: 'now',
          updatedAt: 'now',
        },
      },
      majority,
    );
    expect(ctx.model.updateOne).toHaveBeenNthCalledWith(
      2,
      {
        ...handle,
        lifecycle: 'OPEN',
        callback: { $in: settled },
        coordinatorOutcome: 'THREW',
        claims: {
          $not: {
            $elemMatch: {
              state: { $nin: ['NOT_ATTEMPTED', 'NOT_ACQUIRED', 'RELEASED'] },
            },
          },
        },
      },
      { $set: { lifecycle: 'LOCALLY_FINISHED', updatedAt: 'now' } },
      majority,
    );
  });

  it('never ignores a mismatched identity/phase or an unavailable write', async () => {
    const ctx = setup();
    ctx.write.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(
      ctx.repository.claim(handle, 'animal', 'ACQUIRED', 'now'),
    ).rejects.toThrow('journal changed');
    const error = new Error('Journal unavailable');
    ctx.write.mockRejectedValueOnce(error);
    await expect(ctx.repository.finish(handle, 'RETURNED', 'now')).rejects.toBe(
      error,
    );
    expect(ctx.model.updateOne).toHaveBeenCalledTimes(2);
  });

  it('indexes identity/instance without TTL and defines no raw payload, error or clinical columns', () => {
    const indexes = AnimalWriteJournalSchema.indexes();
    expect(indexes).toContainEqual([
      { id: 1 },
      { unique: true, background: true },
    ]);
    expect(
      indexes.some(([, options]) => options.expireAfterSeconds !== undefined),
    ).toBe(false);
    for (const field of [
      'payload',
      'error',
      'extraction',
      'file',
      'uploadUrl',
      'password',
      'otp',
    ])
      expect(AnimalWriteJournalSchema.path(field)).toBeUndefined();
  });
});
