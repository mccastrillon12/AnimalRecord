import { AnimalPrimitiveType } from '../../../src/context/animal/domain/animal';
import { ArchiveDefinition } from '../../../src/context/animal-transfer/domain/ownership-archive';

export const archiveDefinition: ArchiveDefinition = {
  id: '123e4567-e89b-42d3-a456-426614174020',
  animalId: '123e4567-e89b-42d3-a456-426614174010',
  ownerId: '123e4567-e89b-42d3-a456-426614174001',
  recipientId: '123e4567-e89b-42d3-a456-426614174002',
  periodId: '123e4567-e89b-42d3-a456-426614174030',
  transferId: '123e4567-e89b-42d3-a456-426614174040',
  ownershipVersion: 1,
};
export const archiveAnimal: AnimalPrimitiveType = {
  id: archiveDefinition.animalId,
  ownerId: archiveDefinition.ownerId,
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
  nameHistory: [{ name: 'Brownie', date: '2026-01-01T00:00:00.000Z' }],
};
