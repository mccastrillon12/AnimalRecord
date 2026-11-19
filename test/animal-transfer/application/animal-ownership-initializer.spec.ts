import { AnimalOwnershipInitializer } from '../../../src/context/animal-transfer/application/animal-ownership-initializer';
import { OwnershipPeriodStartProvenance } from '../../../src/context/animal-transfer/domain/animal-ownership';
import { Animal } from '../../../src/context/animal/domain/animal';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { Logger } from '@nestjs/common';

describe('AnimalOwnershipInitializer', () => {
  let logged: jest.SpyInstance;
  let warned: jest.SpyInstance;
  beforeEach(() => {
    logged = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warned = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
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

  it('reports a conflicting animal and continues every page without suppressing the write guard', async () => {
    const bad = createAnimal(
      '123e4567-e89b-42d3-a456-426614174010',
    ).toPrimitives();
    const good = createAnimal(
      '123e4567-e89b-42d3-a456-426614174011',
    ).toPrimitives();
    const ensureCurrentOwnership = jest
      .fn()
      .mockRejectedValueOnce(
        new ConflictError('The animal ownership period is inconsistent'),
      )
      .mockResolvedValue(undefined);
    const listAnimalsForInitialization = jest
      .fn()
      .mockResolvedValueOnce([bad])
      .mockResolvedValueOnce([good])
      .mockResolvedValueOnce([]);
    const initializer = new AnimalOwnershipInitializer({
      ensureCurrentOwnership,
      listAnimalsForInitialization,
    } as never);
    await expect(initializer.onModuleInit()).resolves.toBeUndefined();
    expect(ensureCurrentOwnership).toHaveBeenCalledTimes(2);
    expect(listAnimalsForInitialization).toHaveBeenNthCalledWith(
      2,
      bad.id,
      200,
    );
    expect(warned).toHaveBeenCalledWith({
      event: 'animal-ownership-initialization-conflict',
      animalId: bad.id,
    });
    expect(logged).toHaveBeenCalledWith({
      event: 'animal-ownership-initialization-completed',
      checked: 2,
      conflicts: 1,
    });
  });

  it('propagates infrastructure failures instead of reporting initialization success', async () => {
    const animal = createAnimal(
      '123e4567-e89b-42d3-a456-426614174010',
    ).toPrimitives();
    const failure = new Error('Synthetic database unavailable');
    const initializer = new AnimalOwnershipInitializer({
      listAnimalsForInitialization: jest.fn().mockResolvedValue([animal]),
      ensureCurrentOwnership: jest.fn().mockRejectedValue(failure),
    } as never);
    await expect(initializer.onModuleInit()).rejects.toBe(failure);
    expect(logged).not.toHaveBeenCalled();
  });
});
