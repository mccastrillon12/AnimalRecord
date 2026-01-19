import { Animal } from '../../../src/context/animal/domain/animal';
import { AnimalId } from '../../../src/context/animal/domain/animalId';

describe('Animal Entity', () => {
    const plainAnimal = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Buddy',
        species: 'PERRO',
        breed: 'Golden Retriever',
        code: 'AR-C001',
        sex: 'MALE',
        reproductiveStatus: 'NEUTERED',
        birthDate: '2020-01-01',
        hasChip: true,
        isAssociationMember: false,
        temperament: ['Friendly', 'Playful'],
        diagnosis: ['Healthy'],
        ownerId: '123e4567-e89b-12d3-a456-426614174001',
        weight: 30.5,
        colorAndMarkings: 'Gold',
        allergies: 'None'
    };

    it('should create an Animal instance from primitives', () => {
        const animal = Animal.fromPrimitives(plainAnimal);

        expect(animal).toBeInstanceOf(Animal);
        expect(animal.id).toBeInstanceOf(AnimalId);
        expect(animal.name.value).toBe(plainAnimal.name);
        expect(animal.species.value).toBe(plainAnimal.species);
        expect(animal.breed.value).toBe(plainAnimal.breed);
        expect(animal.code.value).toBe(plainAnimal.code);
        expect(animal.sex.value).toBe(plainAnimal.sex);
        expect(animal.reproductiveStatus.value).toBe(plainAnimal.reproductiveStatus);
        expect(animal.birthDate.value).toBe(plainAnimal.birthDate);
        expect(animal.hasChip.value).toBe(plainAnimal.hasChip);
        expect(animal.isAssociationMember.value).toBe(plainAnimal.isAssociationMember);
        expect(animal.temperament.value).toEqual(plainAnimal.temperament);
        expect(animal.diagnosis.value).toEqual(plainAnimal.diagnosis);
        expect(animal.ownerId.value).toBe(plainAnimal.ownerId);
        expect(animal.weight?.value).toBe(plainAnimal.weight);
        expect(animal.colorAndMarkings?.value).toBe(plainAnimal.colorAndMarkings);
        expect(animal.allergies?.value).toBe(plainAnimal.allergies);
    });

    it('should create an Animal instance with only mandatory fields', () => {
        const mandatoryAnimal = {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Buddy',
            species: 'PERRO',
            breed: 'Golden Retriever',
            code: 'AR-C001',
            sex: 'MALE',
            reproductiveStatus: 'NEUTERED',
            birthDate: '2020-01-01',
            hasChip: true,
            isAssociationMember: false,
            temperament: ['Friendly'],
            diagnosis: ['Healthy'],
            ownerId: '123e4567-e89b-12d3-a456-426614174001'
        };

        const animal = Animal.fromPrimitives(mandatoryAnimal);

        expect(animal).toBeInstanceOf(Animal);
        expect(animal.name.value).toBe(mandatoryAnimal.name);
        expect(animal.weight).toBeUndefined();
        expect(animal.colorAndMarkings).toBeUndefined();
        expect(animal.allergies).toBeUndefined();
    });

    it('should convert Animal instance to primitives', () => {
        const animal = Animal.fromPrimitives(plainAnimal);
        const primitives = animal.toPrimitives();

        expect(primitives).toEqual(plainAnimal);
    });
});
