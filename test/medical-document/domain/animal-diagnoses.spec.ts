import { Animal } from '../../../src/context/animal/domain/animal';

describe('Animal diagnoses from medical documents', () => {
  it('adds accepted diagnoses without duplicating existing values', () => {
    const animal = Animal.fromPrimitives({
      id: '123e4567-e89b-42d3-a456-426614174000',
      name: 'Buddy',
      species: 'PERRO',
      breed: 'Golden Retriever',
      code: 'AR-C001',
      sex: 'MALE',
      reproductiveStatus: 'NEUTERED',
      hasChip: true,
      isAssociationMember: false,
      temperament: ['Friendly'],
      diagnosis: ['Healthy'],
      ownerId: '123e4567-e89b-42d3-a456-426614174001',
    });

    animal.addDiagnoses(['Healthy', 'Dermatitis', 'dermatitis']);

    expect(animal.diagnosis.value).toEqual(['Healthy', 'Dermatitis']);
  });
});
