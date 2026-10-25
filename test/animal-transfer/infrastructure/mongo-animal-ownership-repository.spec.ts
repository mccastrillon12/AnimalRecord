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
      },
      {
        $set: {
          transferLock: {
            transferId,
            lockedAt: '2026-10-25T12:00:00.000Z',
          },
        },
      },
    );

    controlExec.mockResolvedValueOnce({ modifiedCount: 1 });
    await expect(
      repository.releaseTransferLock(animalId, transferId),
    ).resolves.toBe(true);
    expect(controlUpdateOne).toHaveBeenNthCalledWith(
      2,
      { animalId, 'transferLock.transferId': transferId },
      { $unset: { transferLock: 1 } },
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
