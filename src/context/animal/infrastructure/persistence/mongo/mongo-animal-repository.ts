import { AnimalSpecies } from '../../../domain/animalSpecies';
import { AnimalCode } from '../../../domain/animalCode';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AnimalRepository } from '../../../domain/animalRepository';
import { Animal } from '../../../domain/animal';
import { AnimalEntity, AnimalDocument } from './animal.schema';
import { Nullable } from '../../../../shared/domain/Nullable';
import { Uuid } from '../../../../shared/domain/value-object/Uuid';
import { AnimalId } from '../../../domain/animalId';
import { AnimalName } from '../../../domain/animalName';
import { AnimalBreed } from '../../../domain/animalBreed';
import { AnimalSex } from '../../../domain/animalSex';
import { AnimalReproductiveStatus } from '../../../domain/animalReproductiveStatus';
import { AnimalBirthDate } from '../../../domain/animalBirthDate';
import { AnimalHasChip } from '../../../domain/animalHasChip';
import { AnimalIsAssociationMember } from '../../../domain/animalIsAssociationMember';
import { AnimalTemperament } from '../../../domain/animalTemperament';
import { AnimalDiagnosis } from '../../../domain/animalDiagnosis';
import { AnimalWeight } from '../../../domain/animalWeight';
import { AnimalColorAndMarkings } from '../../../domain/animalColorAndMarkings';
import { AnimalAllergies } from '../../../domain/animalAllergies';
import { UserId } from '../../../../user/domain/userId';

@Injectable()
export class MongoAnimalRepository implements AnimalRepository {
    constructor(
        @InjectModel(AnimalEntity.name) private animalModel: Model<AnimalDocument>
    ) { }

    async insert(animal: Animal): Promise<Animal> {
        const primitives = animal.toPrimitives();
        const createdAnimal = new this.animalModel(primitives);
        await createdAnimal.save();
        return animal;
    }

    async findById(id: Uuid): Promise<Nullable<Animal>> {
        const animal = await this.animalModel.findOne({ id: id.value }).exec();
        if (!animal) return null;

        return new Animal(
            new AnimalId(animal.id),
            new AnimalName(animal.name),
            new AnimalSpecies(animal.species),
            new AnimalBreed(animal.breed),
            new AnimalCode(animal.code),
            new AnimalSex(animal.sex),
            new AnimalReproductiveStatus(animal.reproductiveStatus),
            new AnimalBirthDate(animal.birthDate),
            new AnimalHasChip(animal.hasChip),
            new AnimalIsAssociationMember(animal.isAssociationMember),
            new AnimalTemperament(animal.temperament),
            new AnimalDiagnosis(animal.diagnosis),
            new UserId(animal.ownerId),
            animal.weight ? new AnimalWeight(animal.weight) : undefined,
            animal.colorAndMarkings ? new AnimalColorAndMarkings(animal.colorAndMarkings) : undefined,
            animal.allergies ? new AnimalAllergies(animal.allergies) : undefined
        );
    }

    async findAll(): Promise<Animal[]> {
        const animals = await this.animalModel.find().exec();
        return animals.map(animal => new Animal(
            new AnimalId(animal.id),
            new AnimalName(animal.name),
            new AnimalSpecies(animal.species),
            new AnimalBreed(animal.breed),
            new AnimalCode(animal.code),
            new AnimalSex(animal.sex),
            new AnimalReproductiveStatus(animal.reproductiveStatus),
            new AnimalBirthDate(animal.birthDate),
            new AnimalHasChip(animal.hasChip),
            new AnimalIsAssociationMember(animal.isAssociationMember),
            new AnimalTemperament(animal.temperament),
            new AnimalDiagnosis(animal.diagnosis),
            new UserId(animal.ownerId),
            animal.weight ? new AnimalWeight(animal.weight) : undefined,
            animal.colorAndMarkings ? new AnimalColorAndMarkings(animal.colorAndMarkings) : undefined,
            animal.allergies ? new AnimalAllergies(animal.allergies) : undefined
        ));
    }

    async update(animal: Animal): Promise<boolean> {
        const primitiveData = animal.toPrimitives();
        const result = await this.animalModel.updateOne({ id: primitiveData.id }, primitiveData).exec();
        return result.modifiedCount > 0;
    }
}
