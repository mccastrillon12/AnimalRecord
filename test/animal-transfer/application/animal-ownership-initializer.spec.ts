import { AnimalOwnershipInitializer } from '../../../src/context/animal-transfer/application/animal-ownership-initializer';
import { OwnershipPeriodStartProvenance } from '../../../src/context/animal-transfer/domain/animal-ownership';
import { Animal } from '../../../src/context/animal/domain/animal';

describe('AnimalOwnershipInitializer', () => {
  const createAnimal = (id: string, createdAt?: string) =>
    Animal.fromPrimitives({
      id,
      ownerId: '123e4567-e89b-42d3-a456-426614174001',
      name: 'Brownie',
      species: 'DOG',
      breed: 'Labrador',
      code: `AR-${id.slice(-4)}`,
      sex: 'MALE',
      reproductiveStatus: 'NEUTERED',
      hasChip: false,
      isAssociationMember: false,
      temperament: [],
      diagnosis: [],
      createdAt,
      nameHistory: [{ name: 'Brownie', date: '2020-01-01T00:00:00.000Z' }],
    });

  it('backfills current ownership from ownerId without treating nameHistory as ownership', async () => {
    const withKnownStart = createAnimal(
      '123e4567-e89b-42d3-a456-426614174010',
      '2026-01-02T03:04:05.000Z',
    );
    const withUnknownStart = createAnimal(
      '123e4567-e89b-42d3-a456-426614174011',
    );
    const ensureCurrentOwnership = jest.fn().mockResolvedValue(undefined);
    const listAnimalsForInitialization = jest
      .fn()
      .mockResolvedValueOnce([withKnownStart.toPrimitives()])
      .mockResolvedValueOnce([withUnknownStart.toPrimitives()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        withKnownStart.toPrimitives(),
        withUnknownStart.toPrimitives(),
      ])
      .mockResolvedValueOnce([]);
    const initializer = new AnimalOwnershipInitializer({
      listAnimalsForInitialization,
      ensureCurrentOwnership,
    } as never);

    await initializer.onModuleInit();
    await initializer.onModuleInit();

    expect(ensureCurrentOwnership).toHaveBeenCalledTimes(4);
    expect(listAnimalsForInitialization).toHaveBeenNthCalledWith(
      1,
      undefined,
      200,
    );
    expect(listAnimalsForInitialization).toHaveBeenNthCalledWith(
      2,
      withKnownStart.id.value,
      200,
    );
    expect(listAnimalsForInitialization).toHaveBeenNthCalledWith(
      3,
      withUnknownStart.id.value,
      200,
    );
    expect(ensureCurrentOwnership).toHaveBeenNthCalledWith(1, {
      animalId: withKnownStart.id.value,
      ownerId: withKnownStart.ownerId.value,
      startedAt: withKnownStart.createdAt,
      startProvenance:
        OwnershipPeriodStartProvenance.InferredFromAnimalCreation,
    });
    expect(ensureCurrentOwnership).toHaveBeenNthCalledWith(2, {
      animalId: withUnknownStart.id.value,
      ownerId: withUnknownStart.ownerId.value,
      startedAt: undefined,
      startProvenance: OwnershipPeriodStartProvenance.Unknown,
    });
  });
});
