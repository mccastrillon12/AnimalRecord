import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import {
  AnimalWriteJournalInventoryPage,
  AnimalWriteJournalInventoryRepository,
} from '../domain/animal-write-journal-inventory';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';

@Injectable()
export class AnimalWriteJournalInventory {
  constructor(
    @Inject('AnimalWriteJournalInventoryRepository')
    private readonly repository: AnimalWriteJournalInventoryRepository,
  ) {}

  async list(input: {
    animalId: string;
    afterOperationId?: string;
    limit?: number;
  }): Promise<AnimalWriteJournalInventoryPage> {
    if (!input || !isUuid(input.animalId))
      throw new InvalidArgumentError('Invalid journal inventory animal');
    const limit = input.limit === undefined ? 20 : input.limit;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (input.afterOperationId !== undefined && !isUuid(input.afterOperationId))
    )
      throw new InvalidArgumentError(
        'Invalid journal inventory cursor or limit',
      );
    const observations = await this.repository.list(
      input.animalId,
      input.afterOperationId,
      limit + 1,
    );
    if (observations.length > limit + 1)
      throw new ConflictError('Journal inventory exceeded its page limit');
    let previous = input.afterOperationId ?? '';
    for (const observation of observations) {
      if (
        !isUuid(observation.operationId) ||
        observation.operationId <= previous ||
        observation.claim.animalId !== input.animalId ||
        (observation.claim.ownershipVersion !== undefined &&
          (!Number.isSafeInteger(observation.claim.ownershipVersion) ||
            observation.claim.ownershipVersion < 1))
      )
        throw new ConflictError('Invalid journal inventory order or scope');
      previous = observation.operationId;
    }
    const items = observations.slice(0, limit);
    return {
      animalId: input.animalId,
      coverage: 'INCOMPLETE',
      remoteEffects: 'NOT_ASSESSED',
      items,
      ...(observations.length > limit
        ? { nextOperationId: items[items.length - 1].operationId }
        : {}),
    };
  }
}
