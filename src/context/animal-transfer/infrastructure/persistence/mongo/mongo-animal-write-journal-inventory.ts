import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { validate as isUuid } from 'uuid';
import { AnimalWriteJournal } from '../../../domain/animal-write-journal';
import {
  AnimalWriteJournalInventoryRepository,
  AnimalWriteJournalObservation,
} from '../../../domain/animal-write-journal-inventory';
import { ANIMAL_WRITE_JOURNAL_MODEL } from './mongo-animal-write-journal';
import { InvalidArgumentError } from '../../../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';

@Injectable()
export class MongoAnimalWriteJournalInventory implements AnimalWriteJournalInventoryRepository {
  constructor(
    @InjectModel(ANIMAL_WRITE_JOURNAL_MODEL)
    private readonly journals: Model<AnimalWriteJournal>,
  ) {}

  async list(
    animalId: string,
    afterOperationId: string | undefined,
    limit: number,
  ): Promise<AnimalWriteJournalObservation[]> {
    if (
      !isUuid(animalId) ||
      (afterOperationId !== undefined && !isUuid(afterOperationId)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 51
    )
      throw new InvalidArgumentError('Invalid journal inventory query');
    const rows = await this.journals
      .find({
        'claims.animalId': animalId,
        ...(afterOperationId ? { id: { $gt: afterOperationId } } : {}),
      })
      .select({
        _id: 0,
        id: 1,
        instanceId: 1,
        instanceStartedAt: 1,
        protocol: 1,
        kind: 1,
        issuesUploadUrl: 1,
        createdAt: 1,
        updatedAt: 1,
        lifecycle: 1,
        callback: 1,
        callbackPermittedAt: 1,
        callbackSettledAt: 1,
        coordinatorOutcome: 1,
        coordinatorSettledAt: 1,
        claims: 1,
      })
      .collation({ locale: 'simple' })
      .sort({ id: 1 })
      .limit(limit)
      .read('primary')
      .readConcern('majority')
      .maxTimeMS(5000)
      .lean()
      .exec();
    return rows.map((row) => {
      // Read all claims to detect duplicates; never expose another animal's scope.
      const claims = Array.isArray(row.claims)
        ? row.claims.filter((claim) => claim.animalId === animalId)
        : [];
      if (claims.length !== 1)
        throw new ConflictError('Invalid journal inventory claims');
      const claim = claims[0];
      return {
        operationId: row.id,
        instanceId: row.instanceId,
        instanceStartedAt: row.instanceStartedAt,
        kind: row.kind,
        issuesUploadUrl: row.issuesUploadUrl,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lifecycle: row.lifecycle,
        callback: row.callback,
        ...(row.protocol !== undefined ? { protocol: row.protocol } : {}),
        ...(row.callbackPermittedAt !== undefined
          ? { callbackPermittedAt: row.callbackPermittedAt }
          : {}),
        ...(row.callbackSettledAt !== undefined
          ? { callbackSettledAt: row.callbackSettledAt }
          : {}),
        ...(row.coordinatorOutcome !== undefined
          ? { coordinatorOutcome: row.coordinatorOutcome }
          : {}),
        ...(row.coordinatorSettledAt !== undefined
          ? { coordinatorSettledAt: row.coordinatorSettledAt }
          : {}),
        claim: {
          animalId: claim.animalId,
          state: claim.state,
          updatedAt: claim.updatedAt,
          ...(claim.ownershipVersion !== undefined
            ? { ownershipVersion: claim.ownershipVersion }
            : {}),
        },
      };
    });
  }
}
