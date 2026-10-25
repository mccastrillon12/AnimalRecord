import { Model } from 'mongoose';
import { v5 as uuidv5 } from 'uuid';
import { MongoAnimalOwnershipRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import {
  AnimalOwnershipControlDocument,
  AnimalOwnershipPeriodDocument,
  AnimalOwnershipPeriodStatus,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { OwnershipPeriodStartProvenance } from '../../../src/context/animal-transfer/domain/animal-ownership';
import { AnimalDocument } from '../../../src/context/animal/infrastructure/persistence/mongo/animal.schema';

describe('MongoAnimalOwnershipRepository', () => {
  const animalId = '123e4567-e89b-42d3-a456-426614174010';
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';

  const createRepository = () => {
    const periodExec = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    const controlExec = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    const periodUpdateOne = jest.fn().mockReturnValue({ exec: periodExec });
    const controlUpdateOne = jest.fn().mockReturnValue({ exec: controlExec });
    const findControlExec = jest
      .fn()
      .mockResolvedValue({ animalId, ownerId, ownershipVersion: 1 });
    const findPeriodExec = jest
      .fn()
      .mockResolvedValue({ animalId, ownerId, ownershipVersion: 1 });
    const periodModel = {
      updateOne: periodUpdateOne,
      findOne: jest
        .fn()
        .mockReturnValue({ lean: () => ({ exec: findPeriodExec }) }),
    } as unknown as Model<AnimalOwnershipPeriodDocument>;
    const controlModel = {
      updateOne: controlUpdateOne,
      findOne: jest
        .fn()
        .mockReturnValue({ lean: () => ({ exec: findControlExec }) }),
    } as unknown as Model<AnimalOwnershipControlDocument>;
    return {
      repository: new MongoAnimalOwnershipRepository(
        periodModel,
        controlModel,
        {} as Model<AnimalDocument>,
      ),
      periodUpdateOne,
      controlUpdateOne,
      periodExec,
      controlExec,
      findControlExec,
      findPeriodExec,
    };
  };

  it('links new claims to the matching operation/instance and preserves legacy claims without invented attribution', async () => {
    const ctx = createRepository();
    ctx.controlExec.mockResolvedValue({ modifiedCount: 1 });
    const input = {
      animalId,
      ownerId,
      expectedOwnershipVersion: 1,
      token: 'operation',
      startedAt: 'now',
      journal: { operationId: 'operation', instanceId: 'instance' },
    };
    await ctx.repository.beginWrite(input);
    expect(ctx.controlUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        $push: {
          activeWrites: {
            token: 'operation',
            startedAt: 'now',
            operationId: 'operation',
            instanceId: 'instance',
          },
        },
      },
      { writeConcern: { w: 'majority' } },
    );
    ctx.findControlExec.mockResolvedValue({
      animalId,
      ownerId,
      ownershipVersion: 1,
      activeWrites: [
        { token: 'legacy', startedAt: 'before' },
        {
          token: 'operation',
          startedAt: 'now',
          operationId: 'operation',
          instanceId: 'instance',
        },
      ],
    });
    expect((await ctx.repository.findControl(animalId))?.activeWrites).toEqual([
      { token: 'legacy', startedAt: 'before' },
      {
        token: 'operation',
        startedAt: 'now',
        operationId: 'operation',
        instanceId: 'instance',
      },
    ]);
    await expect(
      ctx.repository.beginWrite({
        ...input,
        journal: { operationId: 'other', instanceId: 'instance' },
      }),
    ).rejects.toThrow('journal identity is inconsistent');
    expect(ctx.controlUpdateOne).toHaveBeenCalledTimes(1);
  });

  it('uses insert-only upserts so repeating the ownership backfill is idempotent', async () => {
    const { repository, periodUpdateOne, controlUpdateOne } =
      createRepository();
    const input = {
      animalId,
      ownerId,
      startedAt: '2026-01-02T03:04:05.000Z',
      startProvenance:
        OwnershipPeriodStartProvenance.InferredFromAnimalCreation,
    };

    await repository.ensureCurrentOwnership(input);
    await repository.ensureCurrentOwnership(input);

    expect(controlUpdateOne).toHaveBeenCalledTimes(2);
    expect(controlUpdateOne).toHaveBeenCalledWith(
      { animalId },
      {
        $setOnInsert: {
          animalId,
          ownerId,
          ownershipVersion: 1,
        },
      },
      { upsert: true },
    );
    expect(periodUpdateOne).toHaveBeenCalledTimes(2);
    expect(periodUpdateOne).toHaveBeenCalledWith(
      { animalId, status: AnimalOwnershipPeriodStatus.Active },
      {
        $setOnInsert: {
          id: uuidv5(animalId, 'aa44e937-629a-44d8-b8f7-4e92221d73fc'),
          animalId,
          ownerId,
          ownershipVersion: 1,
          startedAt: input.startedAt,
          startedAtKnown: true,
          startProvenance: input.startProvenance,
          status: AnimalOwnershipPeriodStatus.Active,
        },
      },
      { upsert: true },
    );
  });

  it('acquires and releases a lock only for the expected owner, version and transfer', async () => {
    const { repository, controlUpdateOne, controlExec } = createRepository();
    controlExec.mockResolvedValueOnce({ modifiedCount: 1 });
    const transferId = '123e4567-e89b-42d3-a456-426614174099';

    await expect(
      repository.acquireTransferLock({
        animalId,
        ownerId,
        expectedOwnershipVersion: 3,
        transferId,
        lockedAt: '2026-10-25T12:00:00.000Z',
      }),
    ).resolves.toBe(true);

    expect(controlUpdateOne).toHaveBeenNthCalledWith(
      1,
      {
        animalId,
        ownerId,
        ownershipVersion: 3,
        transferLock: { $exists: false },
        'activeWrites.0': { $exists: false },
        $expr: {
          $lte: [
            { $ifNull: ['$uploadsValidUntil', ''] },
            {
              $dateToString: {
                date: '$$NOW',
                format: '%Y-%m-%dT%H:%M:%S.%LZ',
                timezone: 'UTC',
              },
            },
          ],
        },
      },
      {
        $set: {
          transferLock: {
            transferId,
            lockedAt: '2026-10-25T12:00:00.000Z',
          },
        },
      },
      { writeConcern: { w: 'majority' } },
    );

    controlExec.mockResolvedValueOnce({ modifiedCount: 1 });
    await expect(
      repository.releaseTransferLock(animalId, transferId),
    ).resolves.toBe(true);
    expect(controlUpdateOne).toHaveBeenNthCalledWith(
      2,
      { animalId, 'transferLock.transferId': transferId },
      { $unset: { transferLock: 1 } },
      { writeConcern: { w: 'majority' } },
    );
  });

  it('treats a concurrent unique-key upsert as an idempotent success', async () => {
    const { repository, periodExec } = createRepository();
    periodExec.mockRejectedValueOnce({ code: 11000 });

    await expect(
      repository.ensureCurrentOwnership({
        animalId,
        ownerId,
        startProvenance: OwnershipPeriodStartProvenance.Unknown,
      }),
    ).resolves.toBeUndefined();
  });

  it('atomically claims the expected owner/version and releases only the matching token', async () => {
    const { repository, controlUpdateOne, controlExec } = createRepository();
    const input = {
      animalId,
      ownerId,
      expectedOwnershipVersion: 1,
      token: 'write-1',
      startedAt: '2026-10-25T12:00:00.000Z',
    };
    controlExec.mockResolvedValueOnce({ modifiedCount: 1 });
    await expect(repository.beginWrite(input)).resolves.toBe(true);
    expect(controlUpdateOne).toHaveBeenLastCalledWith(
      {
        animalId,
        ownerId,
        ownershipVersion: 1,
        transferLock: { $exists: false },
      },
      {
        $push: {
          activeWrites: { token: input.token, startedAt: input.startedAt },
        },
      },
      { writeConcern: { w: 'majority' } },
    );
    await repository.endWrite(animalId, input.token);
    expect(controlUpdateOne).toHaveBeenLastCalledWith(
      { animalId },
      { $pull: { activeWrites: { token: input.token } } },
      { writeConcern: { w: 'majority' } },
    );
    await expect(repository.beginWrite(input)).resolves.toBe(false);
  });

  it('extends upload windows monotonically only while the matching write is held', async () => {
    const { repository, controlUpdateOne, controlExec } = createRepository();
    const until = '2026-10-25T12:05:00.000Z';
    // An existing longer window is success too: matchedCount, not modifiedCount.
    controlExec.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 0 });
    await expect(
      repository.recordUploadWindow(animalId, 'write-1', until),
    ).resolves.toBe(true);
    expect(controlUpdateOne).toHaveBeenLastCalledWith(
      {
        animalId,
        'activeWrites.token': 'write-1',
        transferLock: { $exists: false },
      },
      { $max: { uploadsValidUntil: until } },
      { writeConcern: { w: 'majority' } },
    );
    controlExec.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(
      repository.recordUploadWindow(animalId, 'missing', until),
    ).resolves.toBe(false);
  });

  it('rejects an unrelated duplicate-key error if no matching active period exists', async () => {
    const { repository, periodExec, findPeriodExec } = createRepository();
    periodExec.mockRejectedValueOnce({ code: 11000 });
    findPeriodExec.mockResolvedValueOnce(null);
    await expect(
      repository.ensureCurrentOwnership({
        animalId,
        ownerId,
        startProvenance: OwnershipPeriodStartProvenance.Unknown,
      }),
    ).rejects.toThrow('ownership period is inconsistent');
  });

  it('never initializes a new period for an animal whose control belongs to another owner', async () => {
    const { repository, findControlExec, periodUpdateOne } = createRepository();
    findControlExec.mockResolvedValueOnce({
      animalId,
      ownerId: 'another-owner',
      ownershipVersion: 1,
    });
    await expect(
      repository.ensureCurrentOwnership({
        animalId,
        ownerId,
        startProvenance: OwnershipPeriodStartProvenance.Unknown,
      }),
    ).rejects.toThrow('ownership control is inconsistent');
    expect(periodUpdateOne).not.toHaveBeenCalled();
  });
});
