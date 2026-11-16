import { AnimalAccessPolicy } from '../../../src/context/animal/application/animal-access-policy';
import { Animal } from '../../../src/context/animal/domain/animal';
import { AnimalRepository } from '../../../src/context/animal/domain/animalRepository';
import { AnimalOwnershipRepository } from '../../../src/context/animal-transfer/domain/animal-ownership';

describe('Animal ownership write policy', () => {
  const animalId = '123e4567-e89b-42d3-a456-426614174010';
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const animal = Animal.fromPrimitives({
    id: animalId,
    ownerId,
    name: 'Brownie',
    species: 'DOG',
    breed: 'Labrador',
    code: 'AR-C001',
    sex: 'MALE',
    reproductiveStatus: 'NEUTERED',
    hasChip: false,
    isAssociationMember: false,
    temperament: [],
    diagnosis: [],
  });

  const setup = () => {
    const findControl = jest.fn().mockResolvedValue(null);
    const ensureCurrentOwnership = jest.fn().mockResolvedValue(undefined);
    const policy = new AnimalAccessPolicy(
      {
        findById: jest.fn().mockResolvedValue(animal),
      } as unknown as AnimalRepository,
      {
        findControl,
        ensureCurrentOwnership,
      } as unknown as AnimalOwnershipRepository,
    );
    return { policy, findControl, ensureCurrentOwnership };
  };

  it('repairs missing auxiliary state before permitting a write', async () => {
    const { policy, findControl, ensureCurrentOwnership } = setup();
    findControl.mockResolvedValueOnce({
      animalId,
      ownerId,
      ownershipVersion: 1,
    });
    await expect(policy.findWritableAnimal(animalId, ownerId)).resolves.toBe(
      animal,
    );
    expect(ensureCurrentOwnership).toHaveBeenCalledTimes(1);
  });

  it('fails closed if initialization did not create the ownership control', async () => {
    const { policy } = setup();
    await expect(policy.findWritableAnimal(animalId, ownerId)).rejects.toThrow(
      'ownership control is inconsistent',
    );
  });

  it('fails closed for mismatched owner', async () => {
    const { policy, findControl } = setup();
    findControl.mockResolvedValue({
      animalId,
      ownerId: 'another-owner',
      ownershipVersion: 1,
    });
    await expect(policy.findWritableAnimal(animalId, ownerId)).rejects.toThrow(
      'ownership control is inconsistent',
    );
  });

  it('keeps current-owner reads available during a lock', async () => {
    const { policy, findControl } = setup();
    findControl.mockResolvedValue({
      animalId,
      ownerId,
      ownershipVersion: 1,
      transferLock: {
        transferId: 'transfer-id',
        lockedAt: '2026-10-25T12:00:00.000Z',
      },
    });
    await expect(policy.findOwnedAnimal(animalId, ownerId)).resolves.toBe(
      animal,
    );
    await expect(policy.findWritableAnimal(animalId, ownerId)).rejects.toThrow(
      'temporarily locked',
    );
  });
});
