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
import { AnimalWriteJournal } from '../../../src/context/animal-transfer/domain/animal-write-journal';

describe('MongoAnimalOwnershipRepository', () => {
  const animalId = '123e4567-e89b-42d3-a456-426614174010';
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const operationId = '123e4567-e89b-42d3-a456-426614174020';
  const instanceId = '123e4567-e89b-42d3-a456-426614174021';
  const requestId = '123e4567-e89b-42d3-a456-426614174022';
  const operatorId = '123e4567-e89b-42d3-a456-426614174023';

  const createRepository = () => {
    const periodExec = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    const controlExec = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    const journalExec = jest
      .fn()
      .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const journalFindExec = jest.fn().mockResolvedValue(null);
    const periodUpdateOne = jest.fn().mockReturnValue({ exec: periodExec });
    const controlUpdateOne = jest.fn().mockReturnValue({ exec: controlExec });
    const journalUpdateOne = jest.fn().mockReturnValue({ exec: journalExec });
    const endSession = jest.fn().mockResolvedValue(undefined);
    const session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession,
    };
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
    const controlRead = {
      session: jest.fn(),
      select: jest.fn(),
      lean: jest.fn(),
      exec: findControlExec,
    };
    controlRead.session.mockReturnValue(controlRead);
    controlRead.select.mockReturnValue(controlRead);
    controlRead.lean.mockReturnValue(controlRead);
    const controlModel = {
      updateOne: controlUpdateOne,
      findOne: jest.fn().mockReturnValue(controlRead),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    } as unknown as Model<AnimalOwnershipControlDocument>;
    const journalRead = {
      session: jest.fn(),
      select: jest.fn(),
      read: jest.fn(),
      readConcern: jest.fn(),
      lean: jest.fn(),
      exec: journalFindExec,
    };
    for (const method of [
      journalRead.session,
      journalRead.select,
      journalRead.read,
      journalRead.readConcern,
      journalRead.lean,
    ])
      method.mockReturnValue(journalRead);
    const journalModel = {
      updateOne: journalUpdateOne,
      findOne: jest.fn().mockReturnValue(journalRead),
    } as unknown as Model<AnimalWriteJournal>;
    return {
      repository: new MongoAnimalOwnershipRepository(
        periodModel,
        controlModel,
        {} as Model<AnimalDocument>,
        journalModel,
      ),
      periodUpdateOne,
      controlUpdateOne,
      periodExec,
      controlExec,
      findControlExec,
      findPeriodExec,
      journalUpdateOne,
      journalExec,
      journalFindExec,
      journalModel,
      controlModel,
      session,
      endSession,
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
      {
        animalId,
        ownerId,
        ownershipVersion: 1,
        transferLock: { $exists: false },
        'activeWrites.token': { $ne: 'operation' },
      },
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
      { session: ctx.session },
    );
    expect(ctx.journalUpdateOne).toHaveBeenCalledWith(
      {
        id: 'operation',
        instanceId: 'instance',
        actorId: ownerId,
        protocol: 'TRANSACTIONAL_CLAIMS_V1',
        lifecycle: 'OPEN',
        callback: 'NOT_STARTED',
        callbackPermittedAt: { $exists: false },
        claims: {
          $elemMatch: {
            animalId,
            state: 'INTENT',
            ownershipVersion: 1,
          },
        },
      },
      {
        $set: {
          'claims.$.state': 'ACQUIRED',
          'claims.$.updatedAt': 'now',
          updatedAt: 'now',
        },
      },
      { session: ctx.session },
    );
    expect(ctx.session.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
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

  it('does not leave a control claim committed when the journal authorization fence changed', async () => {
    const ctx = createRepository();
    ctx.controlExec.mockResolvedValueOnce({ modifiedCount: 1 });
    ctx.journalExec.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(
      ctx.repository.beginWrite({
        animalId,
        ownerId,
        expectedOwnershipVersion: 1,
        token: operationId,
        startedAt: 'now',
        journal: { operationId, instanceId },
      }),
    ).rejects.toThrow('journal changed');
    expect(ctx.session.withTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.endSession).toHaveBeenCalledTimes(1);
  });

  it('returns NOT_ACQUIRED without advancing the journal when the control cannot be claimed', async () => {
    const ctx = createRepository();
    ctx.controlExec.mockResolvedValueOnce({ modifiedCount: 0 });
    await expect(
      ctx.repository.beginWrite({
        animalId,
        ownerId,
        expectedOwnershipVersion: 1,
        token: operationId,
        startedAt: 'now',
        journal: { operationId, instanceId },
      }),
    ).resolves.toBe(false);
    expect(ctx.journalUpdateOne).not.toHaveBeenCalled();
  });

  it('recovers only a labeled NOT_STARTED operation and fences late acquisitions in the same transaction', async () => {
    const ctx = createRepository();
    const input = {
      operationId,
      instanceId,
      requestId,
      operatorId,
      reason: 'OPERATOR_INTERVENTION' as const,
      evidenceRef: 'incident-42',
    };
    const open: AnimalWriteJournal = {
      protocol: 'TRANSACTIONAL_CLAIMS_V1',
      id: operationId,
      instanceId,
      instanceStartedAt: 'before',
      actorId: ownerId,
      kind: 'ANIMAL_UPDATE',
      issuesUploadUrl: false,
      createdAt: 'before',
      updatedAt: 'before',
      lifecycle: 'OPEN',
      callback: 'NOT_STARTED',
      claims: [
        {
          animalId,
          state: 'ACQUIRE_UNKNOWN',
          updatedAt: 'before',
          ownershipVersion: 1,
        },
      ],
    };
    const recovered: AnimalWriteJournal = {
      ...open,
      lifecycle: 'RECOVERED_BEFORE_CALLBACK',
      callback: 'NOT_INVOKED',
      claims: [{ ...open.claims[0], state: 'RECOVERED' }],
      recovery: {
        requestId,
        operatorId,
        reason: input.reason,
        evidenceRef: input.evidenceRef,
        recoveredAt: 'after',
        claims: [
          {
            animalId,
            previousState: 'ACQUIRE_UNKNOWN',
            tokenRemoved: true,
          },
        ],
      },
    };
    ctx.journalFindExec
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(recovered);
    ctx.findControlExec.mockResolvedValueOnce({
      animalId,
      activeWrites: [
        {
          token: operationId,
          startedAt: 'before',
          operationId,
          instanceId,
        },
        { token: 'legacy-token', startedAt: 'before' },
      ],
    });
    ctx.controlExec.mockResolvedValueOnce({ matchedCount: 1 });
    await expect(
      ctx.repository.recoverWriteBeforeCallback(input),
    ).resolves.toEqual(recovered);
    expect(ctx.controlUpdateOne).toHaveBeenCalledWith(
      {
        animalId,
        activeWrites: {
          $elemMatch: { token: operationId, operationId, instanceId },
        },
      },
      {
        $pull: {
          activeWrites: { token: operationId, operationId, instanceId },
        },
      },
      { session: ctx.session },
    );
    expect(ctx.journalUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        id: operationId,
        instanceId,
        lifecycle: 'OPEN',
        callback: { $in: ['NOT_STARTED', 'NOT_INVOKED'] },
        callbackPermittedAt: { $exists: false },
        kind: { $ne: 'UNSPECIFIED' },
      }),
      {
        $set: expect.objectContaining({
          lifecycle: 'RECOVERED_BEFORE_CALLBACK',
          callback: 'NOT_INVOKED',
          'claims.$[].state': 'RECOVERED',
          recovery: expect.objectContaining({
            requestId,
            operatorId,
            reason: input.reason,
            evidenceRef: input.evidenceRef,
            claims: [
              {
                animalId,
                previousState: 'ACQUIRE_UNKNOWN',
                tokenRemoved: true,
              },
            ],
          }) as unknown,
        }) as unknown,
      },
      { session: ctx.session },
    );
  });

  it.each([
    { callback: 'MAY_RUN' as const, kind: 'ANIMAL_UPDATE' as const },
    { callback: 'NOT_STARTED' as const, kind: 'UNSPECIFIED' as const },
  ])(
    'refuses recovery for callback=$callback kind=$kind without removing tokens',
    async ({ callback, kind }) => {
      const ctx = createRepository();
      ctx.journalFindExec.mockResolvedValueOnce({
        protocol: 'TRANSACTIONAL_CLAIMS_V1',
        id: operationId,
        instanceId,
        lifecycle: 'OPEN',
        callback,
        kind,
        claims: [],
      });
      await expect(
        ctx.repository.recoverWriteBeforeCallback({
          operationId,
          instanceId,
          requestId,
          operatorId,
          reason: 'OPERATOR_INTERVENTION',
          evidenceRef: 'incident-42',
        }),
      ).rejects.toThrow('can no longer be recovered');
      expect(ctx.controlUpdateOne).not.toHaveBeenCalled();
      expect(ctx.journalUpdateOne).not.toHaveBeenCalled();
    },
  );

  it('does not reinterpret or remove a colliding legacy token', async () => {
    const ctx = createRepository();
    ctx.journalFindExec.mockResolvedValueOnce({
      protocol: 'TRANSACTIONAL_CLAIMS_V1',
      id: operationId,
      instanceId,
      lifecycle: 'OPEN',
      callback: 'NOT_STARTED',
      kind: 'ANIMAL_UPDATE',
      claims: [{ animalId, state: 'INTENT' }],
    });
    ctx.findControlExec.mockResolvedValueOnce({
      animalId,
      activeWrites: [{ token: operationId, startedAt: 'before' }],
    });
    await expect(
      ctx.repository.recoverWriteBeforeCallback({
        operationId,
        instanceId,
        requestId,
        operatorId,
        reason: 'INSTANCE_TERMINATION_CONFIRMED',
        evidenceRef: 'shutdown-record-7',
      }),
    ).rejects.toThrow('identity is inconsistent');
    expect(ctx.controlUpdateOne).not.toHaveBeenCalled();
    expect(ctx.journalUpdateOne).not.toHaveBeenCalled();
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
        reservationEpoch: { $exists: false },
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
        $inc: { reservationEpoch: 1 },
      },
      { writeConcern: { w: 'majority' } },
    );

    controlExec.mockResolvedValueOnce({ modifiedCount: 1 });
    await expect(
      repository.releaseTransferLock(animalId, transferId, 1),
    ).resolves.toBe(true);
    expect(controlUpdateOne).toHaveBeenNthCalledWith(
      2,
      { animalId, 'transferLock.transferId': transferId, reservationEpoch: 1 },
      { $unset: { transferLock: 1 }, $inc: { reservationEpoch: 1 } },
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
