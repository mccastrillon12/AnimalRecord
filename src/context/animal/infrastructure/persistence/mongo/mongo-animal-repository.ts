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
import { AnimalHousingType } from '../../../domain/animalHousingType';
import { AnimalPurpose } from '../../../domain/animalPurpose';
import { AnimalFeedingType } from '../../../domain/animalFeedingType';
import { AnimalBirthType } from '../../../domain/animalBirthType';
import { AnimalBirthCondition } from '../../../domain/animalBirthCondition';

@Injectable()
export class MongoAnimalRepository implements AnimalRepository {
    constructor(
        @InjectModel(AnimalEntity.name) private animalModel: Model<AnimalDocument>
    ) { }

    async insert(animal: Animal): Promise<Animal> {
        const primitives = animal.toPrimitives();
        console.log('DEBUG insert primitives:', JSON.stringify({ createdAt: primitives.createdAt, updatedAt: primitives.updatedAt }));
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
            new AnimalHasChip(animal.hasChip),
            new AnimalIsAssociationMember(animal.isAssociationMember),
            new AnimalTemperament(animal.temperament),
            new AnimalDiagnosis(animal.diagnosis),
            new UserId(animal.ownerId),
            animal.birthDate ? new AnimalBirthDate(animal.birthDate) : undefined,
            animal.weight ? new AnimalWeight(animal.weight) : undefined,
            animal.colorAndMarkings ? new AnimalColorAndMarkings(animal.colorAndMarkings) : undefined,
            animal.allergies ? new AnimalAllergies(animal.allergies) : undefined,
            animal.housingType ? new AnimalHousingType(animal.housingType) : undefined,
            animal.purpose ? new AnimalPurpose(animal.purpose) : undefined,
            animal.feedingType ? new AnimalFeedingType(animal.feedingType) : undefined,
            animal.birthType ? new AnimalBirthType(animal.birthType) : undefined,
            animal.birthCondition ? new AnimalBirthCondition(animal.birthCondition) : undefined,
            animal.profilePictureUrl,
            animal.createdAt,
            animal.updatedAt
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
            new AnimalHasChip(animal.hasChip),
            new AnimalIsAssociationMember(animal.isAssociationMember),
            new AnimalTemperament(animal.temperament),
            new AnimalDiagnosis(animal.diagnosis),
            new UserId(animal.ownerId),
            animal.birthDate ? new AnimalBirthDate(animal.birthDate) : undefined,
            animal.weight ? new AnimalWeight(animal.weight) : undefined,
            animal.colorAndMarkings ? new AnimalColorAndMarkings(animal.colorAndMarkings) : undefined,
            animal.allergies ? new AnimalAllergies(animal.allergies) : undefined,
            animal.housingType ? new AnimalHousingType(animal.housingType) : undefined,
            animal.purpose ? new AnimalPurpose(animal.purpose) : undefined,
            animal.feedingType ? new AnimalFeedingType(animal.feedingType) : undefined,
            animal.birthType ? new AnimalBirthType(animal.birthType) : undefined,
            animal.birthCondition ? new AnimalBirthCondition(animal.birthCondition) : undefined,
            animal.profilePictureUrl,
            animal.createdAt,
            animal.updatedAt
        ));
    }

    async findByOwner(ownerId: Uuid): Promise<Animal[]> {
        const animals = await this.animalModel.find({ ownerId: ownerId.value }).exec();
        return animals.map(animal => new Animal(
            new AnimalId(animal.id),
            new AnimalName(animal.name),
            new AnimalSpecies(animal.species),
            new AnimalBreed(animal.breed),
            new AnimalCode(animal.code),
            new AnimalSex(animal.sex),
            new AnimalReproductiveStatus(animal.reproductiveStatus),
            new AnimalHasChip(animal.hasChip),
            new AnimalIsAssociationMember(animal.isAssociationMember),
            new AnimalTemperament(animal.temperament),
            new AnimalDiagnosis(animal.diagnosis),
            new UserId(animal.ownerId),
            animal.birthDate ? new AnimalBirthDate(animal.birthDate) : undefined,
            animal.weight ? new AnimalWeight(animal.weight) : undefined,
            animal.colorAndMarkings ? new AnimalColorAndMarkings(animal.colorAndMarkings) : undefined,
            animal.allergies ? new AnimalAllergies(animal.allergies) : undefined,
            animal.housingType ? new AnimalHousingType(animal.housingType) : undefined,
            animal.purpose ? new AnimalPurpose(animal.purpose) : undefined,
            animal.feedingType ? new AnimalFeedingType(animal.feedingType) : undefined,
            animal.birthType ? new AnimalBirthType(animal.birthType) : undefined,
            animal.birthCondition ? new AnimalBirthCondition(animal.birthCondition) : undefined,
            animal.profilePictureUrl,
            animal.createdAt,
            animal.updatedAt
        ));
    }

    async update(animal: Animal): Promise<boolean> {
        const primitiveData = animal.toPrimitives();
        const result = await this.animalModel.updateOne({ id: primitiveData.id }, primitiveData).exec();
        return result.modifiedCount > 0;
    }
}
