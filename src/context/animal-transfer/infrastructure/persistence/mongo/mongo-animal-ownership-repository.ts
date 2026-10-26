import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { v5 as uuidv5 } from 'uuid';
import { drainedAnimalReservationFilter } from '../../../domain/drained-animal-reservation-filter';
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
  ANIMAL_WRITE_PROTOCOL,
  ANIMAL_WRITE_KINDS,
  AnimalWriteJournal,
  AnimalWriteRecoveryRequest,
} from '../../../domain/animal-write-journal';
import {
  AnimalOwnershipControlDocument,
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodDocument,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';
import { ANIMAL_WRITE_JOURNAL_MODEL } from './mongo-animal-write-journal';

const OWNERSHIP_PERIOD_NAMESPACE = 'aa44e937-629a-44d8-b8f7-4e92221d73fc';
// A write must not start under a claim that a primary failover could roll back.
const OWNERSHIP_WRITE_OPTIONS = { writeConcern: { w: 'majority' as const } };

@Injectable()
export class MongoAnimalOwnershipRepository implements AnimalOwnershipRepository {
  constructor(
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periodModel: Model<AnimalOwnershipPeriodDocument>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controlModel: Model<AnimalOwnershipControlDocument>,
    @InjectModel(AnimalEntity.name)
    private readonly animalModel: Model<AnimalDocument>,
    @InjectModel(ANIMAL_WRITE_JOURNAL_MODEL)
    private readonly journalModel: Model<AnimalWriteJournal>,
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
      activeWrites: control.activeWrites?.map((write) => ({
        token: write.token,
        startedAt: write.startedAt,
        ...(write.operationId ? { operationId: write.operationId } : {}),
        ...(write.instanceId ? { instanceId: write.instanceId } : {}),
      })),
      uploadsValidUntil: control.uploadsValidUntil,
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
        drainedAnimalReservationFilter(
          input.animalId,
          input.ownerId,
          input.expectedOwnershipVersion,
        ),
        {
          $set: {
            transferLock: {
              transferId: input.transferId,
              lockedAt: input.lockedAt,
            },
          },
        },
        OWNERSHIP_WRITE_OPTIONS,
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async beginWrite(input: {
    animalId: string;
    ownerId: string;
    expectedOwnershipVersion: number;
    token: string;
    startedAt: string;
    journal?: { operationId: string; instanceId: string };
  }): Promise<boolean> {
    if (
      input.journal &&
      (input.journal.operationId !== input.token || !input.journal.instanceId)
    )
      throw new ConflictError(
        'The write claim journal identity is inconsistent',
      );
    if (!input.journal) return this.beginLegacyWrite(input);
    const identity = input.journal;
    let acquired = false;
    await this.transaction(async (session) => {
      acquired = false;
      const result = await this.controlModel
        .updateOne(
          {
            animalId: input.animalId,
            ownerId: input.ownerId,
            ownershipVersion: input.expectedOwnershipVersion,
            transferLock: { $exists: false },
            'activeWrites.token': { $ne: input.token },
          },
          {
            $push: {
              activeWrites: {
                token: input.token,
                startedAt: input.startedAt,
                operationId: identity.operationId,
                instanceId: identity.instanceId,
              },
            },
          },
          { session },
        )
        .exec();
      if (result.modifiedCount !== 1) return;
      const journal = await this.journalModel
        .updateOne(
          {
            id: identity.operationId,
            instanceId: identity.instanceId,
            actorId: input.ownerId,
            protocol: ANIMAL_WRITE_PROTOCOL,
            lifecycle: 'OPEN',
            callback: 'NOT_STARTED',
            callbackPermittedAt: { $exists: false },
            claims: {
              $elemMatch: {
                animalId: input.animalId,
                state: 'INTENT',
                ownershipVersion: input.expectedOwnershipVersion,
              },
            },
          },
          {
            $set: {
              'claims.$.state': 'ACQUIRED',
              'claims.$.updatedAt': input.startedAt,
              updatedAt: input.startedAt,
            },
          },
          { session },
        )
        .exec();
      if (journal.matchedCount !== 1)
        throw new ConflictError(
          'The animal write journal changed; refresh before retrying',
        );
      acquired = true;
    });
    return acquired;
  }

  async recoverWriteBeforeCallback(
    input: AnimalWriteRecoveryRequest,
  ): Promise<AnimalWriteJournal> {
    await this.transaction(async (session) => {
      const journal = await this.journalModel
        .findOne({ id: input.operationId })
        .session(session)
        .lean()
        .exec();
      if (!journal)
        throw new ConflictError('The animal write journal was not found');
      if (journal.instanceId !== input.instanceId)
        throw new ConflictError(
          'The animal write journal instance does not match',
        );
      if (journal.lifecycle === 'RECOVERED_BEFORE_CALLBACK') {
        this.assertSameRecovery(journal, input);
        return;
      }
      if (
        journal.lifecycle !== 'OPEN' ||
        journal.protocol !== ANIMAL_WRITE_PROTOCOL ||
        !['NOT_STARTED', 'NOT_INVOKED'].includes(journal.callback) ||
        journal.callbackPermittedAt !== undefined ||
        !ANIMAL_WRITE_KINDS.includes(journal.kind) ||
        journal.kind === 'UNSPECIFIED' ||
        journal.recovery ||
        !journal.claims.length ||
        new Set(journal.claims.map((claim) => claim.animalId)).size !==
          journal.claims.length
      )
        throw new ConflictError(
          'The write can no longer be recovered before its callback',
        );
      // Both acquisition and MAY_RUN write this journal. The terminal update
      // below must remain in the same transaction as every token removal:
      // a stale snapshot conflicts and retries; a late acquisition then aborts.
      const recoveryClaims = [];
      for (const claim of journal.claims) {
        if (claim.state === 'RECOVERED')
          throw new ConflictError('The animal write recovery is inconsistent');
        const control = await this.controlModel
          .findOne({ animalId: claim.animalId })
          .session(session)
          .select({ _id: 0, activeWrites: 1 })
          .lean()
          .exec();
        const collisions =
          control?.activeWrites?.filter(
            (write) =>
              write.token === input.operationId ||
              write.operationId === input.operationId,
          ) ?? [];
        if (
          collisions.length > 1 ||
          collisions.some(
            (write) =>
              write.token !== input.operationId ||
              write.operationId !== input.operationId ||
              write.instanceId !== input.instanceId,
          )
        )
          throw new ConflictError(
            'The write claim identity is inconsistent; recovery was not applied',
          );
        const tokenRemoved = collisions.length === 1;
        if (tokenRemoved) {
          const released = await this.controlModel
            .updateOne(
              {
                animalId: claim.animalId,
                activeWrites: {
                  $elemMatch: {
                    token: input.operationId,
                    operationId: input.operationId,
                    instanceId: input.instanceId,
                  },
                },
              },
              {
                $pull: {
                  activeWrites: {
                    token: input.operationId,
                    operationId: input.operationId,
                    instanceId: input.instanceId,
                  },
                },
              },
              { session },
            )
            .exec();
          if (released.matchedCount !== 1)
            throw new ConflictError(
              'The write claim changed; recovery was not applied',
            );
        }
        recoveryClaims.push({
          animalId: claim.animalId,
          previousState: claim.state,
          tokenRemoved,
        });
      }
      const recoveredAt = new Date().toISOString();
      const recovered = await this.journalModel
        .updateOne(
          {
            id: input.operationId,
            instanceId: input.instanceId,
            lifecycle: 'OPEN',
            protocol: ANIMAL_WRITE_PROTOCOL,
            callback: { $in: ['NOT_STARTED', 'NOT_INVOKED'] },
            callbackPermittedAt: { $exists: false },
            kind: { $ne: 'UNSPECIFIED' },
            recovery: { $exists: false },
          },
          {
            $set: {
              lifecycle: 'RECOVERED_BEFORE_CALLBACK',
              callback: 'NOT_INVOKED',
              callbackSettledAt: recoveredAt,
              updatedAt: recoveredAt,
              'claims.$[].state': 'RECOVERED',
              'claims.$[].updatedAt': recoveredAt,
              recovery: {
                requestId: input.requestId,
                operatorId: input.operatorId,
                reason: input.reason,
                evidenceRef: input.evidenceRef,
                recoveredAt,
                claims: recoveryClaims,
              },
            },
          },
          { session },
        )
        .exec();
      if (recovered.matchedCount !== 1)
        throw new ConflictError('The write advanced; recovery was not applied');
    });
    const journal = await this.findWriteJournal(input.operationId);
    if (!journal || journal.lifecycle !== 'RECOVERED_BEFORE_CALLBACK')
      throw new ConflictError(
        'The animal write recovery could not be confirmed',
      );
    this.assertSameRecovery(journal, input);
    return journal;
  }

  async endWrite(animalId: string, token: string): Promise<void> {
    await this.controlModel
      .updateOne(
        { animalId },
        { $pull: { activeWrites: { token } } },
        OWNERSHIP_WRITE_OPTIONS,
      )
      .exec();
  }

  async recordUploadWindow(
    animalId: string,
    token: string,
    validUntil: string,
  ): Promise<boolean> {
    const result = await this.controlModel
      .updateOne(
        {
          animalId,
          'activeWrites.token': token,
          transferLock: { $exists: false },
        },
        {
          $max: { uploadsValidUntil: validUntil },
        },
        OWNERSHIP_WRITE_OPTIONS,
      )
      .exec();
    return result.matchedCount === 1;
  }

  async releaseTransferLock(
    animalId: string,
    transferId: string,
  ): Promise<boolean> {
    const result = await this.controlModel
      .updateOne(
        { animalId, 'transferLock.transferId': transferId },
        { $unset: { transferLock: 1 } },
        OWNERSHIP_WRITE_OPTIONS,
      )
      .exec();
    return result.modifiedCount === 1;
  }

  private async beginLegacyWrite(input: {
    animalId: string;
    ownerId: string;
    expectedOwnershipVersion: number;
    token: string;
    startedAt: string;
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
          $push: {
            activeWrites: {
              token: input.token,
              startedAt: input.startedAt,
            },
          },
        },
        OWNERSHIP_WRITE_OPTIONS,
      )
      .exec();
    return result.modifiedCount === 1;
  }

  private async findWriteJournal(
    operationId: string,
  ): Promise<AnimalWriteJournal | null> {
    return this.journalModel
      .findOne({ id: operationId })
      .select({ _id: 0, __v: 0 })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  }

  private assertSameRecovery(
    journal: AnimalWriteJournal,
    input: AnimalWriteRecoveryRequest,
  ): void {
    const recovery = journal.recovery;
    if (
      !recovery ||
      recovery.requestId !== input.requestId ||
      recovery.operatorId !== input.operatorId ||
      recovery.reason !== input.reason ||
      recovery.evidenceRef !== input.evidenceRef
    )
      throw new ConflictError(
        'The write was recovered by a different recovery request',
      );
  }

  private async transaction(
    operation: (session: ClientSession) => Promise<void>,
  ): Promise<void> {
    const session = await this.controlModel.db.startSession();
    try {
      await session.withTransaction(() => operation(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });
    } finally {
      await session.endSession();
    }
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
