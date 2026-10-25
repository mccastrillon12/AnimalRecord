import { Logger } from '@nestjs/common';
import { AnimalCreator } from '../../../src/context/animal/application/creator/animal-creator';
import { AnimalCodeGenerator } from '../../../src/context/animal/application/generators/animal-code-generator';
import { AnimalRepository } from '../../../src/context/animal/domain/animalRepository';
import {
  AnimalOwnershipRepository,
  OwnershipPeriodStartProvenance,
} from '../../../src/context/animal-transfer/domain/animal-ownership';

describe('Animal creation with ownership initialization', () => {
  const data = {
    id: '123e4567-e89b-42d3-a456-426614174010',
    ownerId: '123e4567-e89b-42d3-a456-426614174001',
    name: 'Brownie',
    species: 'DOG',
    breed: 'Labrador',
    sex: 'MALE',
    reproductiveStatus: 'NEUTERED',
    hasChip: false,
    isAssociationMember: false,
    temperament: [],
    diagnosis: [],
  };

  it.each([false, true])(
    'returns the committed animal when auxiliary initialization fails: %s',
    async (fails) => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        const ensureCurrentOwnership = fails
          ? jest
              .fn()
              .mockRejectedValue(new Error('temporary persistence failure'))
          : jest.fn().mockResolvedValue(undefined);
        const creator = new AnimalCreator(
          {
            insert: jest
              .fn()
              .mockImplementation((animal: unknown) => Promise.resolve(animal)),
          } as unknown as AnimalRepository,
          {
            generate: jest.fn().mockResolvedValue('AR-C001'),
          } as unknown as AnimalCodeGenerator,
          { ensureCurrentOwnership } as unknown as AnimalOwnershipRepository,
        );

        const created = await creator.run(data);
        expect(created.toPrimitives()).toMatchObject({
          ...data,
          code: 'AR-C001',
        });
        expect(ensureCurrentOwnership).toHaveBeenCalledWith({
          animalId: data.id,
          ownerId: data.ownerId,
          startedAt: created.createdAt,
          startProvenance: OwnershipPeriodStartProvenance.Created,
        });
        expect(warn).toHaveBeenCalledTimes(fails ? 1 : 0);
      } finally {
        warn.mockRestore();
      }
    },
  );
});
