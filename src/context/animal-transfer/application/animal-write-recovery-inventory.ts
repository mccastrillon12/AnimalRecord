import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import {
  AnimalWriteRecoveryInventoryRepository,
  WriteRecoveryObservation,
} from '../domain/animal-write-recovery-inventory';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';

@Injectable()
export class AnimalWriteRecoveryInventory {
  constructor(
    @Inject('AnimalWriteRecoveryInventoryRepository')
    private readonly repository: AnimalWriteRecoveryInventoryRepository,
  ) {}

  async list(
    input: { afterAnimalId?: string; limit?: number } = {},
  ): Promise<{ items: WriteRecoveryObservation[]; nextAnimalId?: string }> {
    const limit = input.limit ?? 20;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (input.afterAnimalId !== undefined && !isUuid(input.afterAnimalId))
    )
      throw new InvalidArgumentError(
        'Invalid recovery inventory cursor or limit',
      );
    const observations = await this.repository.list(
      input.afterAnimalId,
      limit + 1,
    );
    let previous = input.afterAnimalId ?? '';
    if (observations.length > limit + 1)
      throw new ConflictError('Recovery inventory exceeded its page limit');
    for (const observation of observations) {
      if (
        !observation.control.animalId ||
        observation.control.animalId <= previous
      )
        throw new ConflictError('Recovery inventory cursor did not advance');
      previous = observation.control.animalId;
    }
    const items = observations.slice(0, limit);
    return {
      items,
      ...(observations.length > limit
        ? { nextAnimalId: items[items.length - 1].control.animalId }
        : {}),
    };
  }
}
