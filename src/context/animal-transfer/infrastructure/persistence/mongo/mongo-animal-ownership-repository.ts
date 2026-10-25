import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v5 as uuidv5 } from 'uuid';
import {
  AnimalDocument,
  AnimalEntity,
} from '../../../../animal/infrastructure/persistence/mongo/animal.schema';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import {
  AnimalOwnershipControl,
  AnimalOwnershipRepository,
  EnsureAnimalOwnershipInput,
} from '../../../domain/animal-ownership';
import {
  AnimalOwnershipControlDocument,
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodDocument,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';

const OWNERSHIP_PERIOD_NAMESPACE = 'aa44e937-629a-44d8-b8f7-4e92221d73fc';

@Injectable()
export class MongoAnimalOwnershipRepository implements AnimalOwnershipRepository {
  constructor(
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periodModel: Model<AnimalOwnershipPeriodDocument>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controlModel: Model<AnimalOwnershipControlDocument>,
    @InjectModel(AnimalEntity.name)
    private readonly animalModel: Model<AnimalDocument>,
  ) {}

  async listAnimalsForInitialization(
    afterId: string | undefined,
    limit: number,
  ): Promise<Array<{ id: string; ownerId: string; createdAt?: string }>> {
    return this.animalModel
      .find(afterId ? { id: { $gt: afterId } } : {})
      .select({ _id: 0, id: 1, ownerId: 1, createdAt: 1 })
      .sort({ id: 1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async ensureCurrentOwnership(
    input: EnsureAnimalOwnershipInput,
  ): Promise<void> {
    await this.runIdempotentUpsert(() =>
      this.controlModel
        .updateOne(
          { animalId: input.animalId },
          {
            $setOnInsert: {
              animalId: input.animalId,
              ownerId: input.ownerId,
              ownershipVersion: 1,
            },
          },
          { upsert: true },
        )
        .exec(),
    );

    const control = await this.findControl(input.animalId);
    if (!control || control.ownerId !== input.ownerId) {
      throw new ConflictError('The animal ownership control is inconsistent');
    }

    await this.runIdempotentUpsert(() =>
      this.periodModel
        .updateOne(
          {
            animalId: input.animalId,
            status: AnimalOwnershipPeriodStatus.Active,
          },
          {
            $setOnInsert: {
              id: uuidv5(input.animalId, OWNERSHIP_PERIOD_NAMESPACE),
              animalId: input.animalId,
              ownerId: input.ownerId,
              ownershipVersion: 1,
              startedAt: input.startedAt,
              startedAtKnown: Boolean(input.startedAt),
              startProvenance: input.startProvenance,
              status: AnimalOwnershipPeriodStatus.Active,
            },
          },
          { upsert: true },
        )
        .exec(),
    );

    const period = await this.periodModel
      .findOne({
        animalId: input.animalId,
        status: AnimalOwnershipPeriodStatus.Active,
      })
      .lean()
      .exec();
    if (
      !period ||
      period.ownerId !== control.ownerId ||
      period.ownershipVersion !== control.ownershipVersion
    ) {
      throw new ConflictError('The animal ownership period is inconsistent');
    }
  }

  async findControl(animalId: string): Promise<AnimalOwnershipControl | null> {
    const control = await this.controlModel.findOne({ animalId }).lean().exec();
    if (!control) return null;
    return {
      animalId: control.animalId,
      ownerId: control.ownerId,
      ownershipVersion: control.ownershipVersion,
      transferLock: control.transferLock
        ? {
            transferId: control.transferLock.transferId,
            lockedAt: control.transferLock.lockedAt,
          }
        : undefined,
    };
  }

  async acquireTransferLock(input: {
    animalId: string;
    ownerId: string;
    expectedOwnershipVersion: number;
    transferId: string;
    lockedAt: string;
  }): Promise<boolean> {
    const result = await this.controlModel
      .updateOne(
        {
          animalId: input.animalId,
          ownerId: input.ownerId,
          ownershipVersion: input.expectedOwnershipVersion,
          transferLock: { $exists: false },
        },
        {
          $set: {
            transferLock: {
              transferId: input.transferId,
              lockedAt: input.lockedAt,
            },
          },
        },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async releaseTransferLock(
    animalId: string,
    transferId: string,
  ): Promise<boolean> {
    const result = await this.controlModel
      .updateOne(
        { animalId, 'transferLock.transferId': transferId },
        { $unset: { transferLock: 1 } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  private async runIdempotentUpsert(
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      const mongoError = error as { code?: unknown };
      if (mongoError?.code === 11000) {
        return;
      }
      throw error;
    }
  }
}
