import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CatalogsRepository } from '../../../domain/catalogs-repository';
import { Species, Breed, HousingType, AnimalPurpose } from '../../../domain/catalogs';
import {
    SpeciesDocument,
    BreedDocument,
    HousingTypeDocument,
    AnimalPurposeDocument,
    SpeciesEntity,
    BreedEntity,
    HousingTypeEntity,
    AnimalPurposeEntity
} from './catalogs.schema';

@Injectable()
export class MongoCatalogsRepository implements CatalogsRepository {
    constructor(
        @InjectModel(SpeciesEntity.name) private readonly speciesModel: Model<SpeciesDocument>,
        @InjectModel(BreedEntity.name) private readonly breedModel: Model<BreedDocument>,
        @InjectModel(HousingTypeEntity.name) private readonly housingTypeModel: Model<HousingTypeDocument>,
        @InjectModel(AnimalPurposeEntity.name) private readonly animalPurposeModel: Model<AnimalPurposeDocument>
    ) { }

    // --- Species ---
    async saveSpecies(species: Species): Promise<void> {
        await this.speciesModel.updateOne(
            { _id: species.id },
            { $set: { name: species.name } },
            { upsert: true }
        ).exec();
    }

    async findSpeciesByName(name: string): Promise<Species | null> {
        const entity = await this.speciesModel.findOne({ name }).exec();
        return entity ? new Species(entity._id, entity.name) : null;
    }

    async findAllSpecies(): Promise<Species[]> {
        const entities = await this.speciesModel.find().exec();
        return entities.map(e => new Species(e._id, e.name));
    }

    // --- Breed ---
    async saveBreed(breed: Breed): Promise<void> {
        await this.breedModel.updateOne(
            { _id: breed.id },
            { $set: { name: breed.name, speciesId: breed.speciesId } },
            { upsert: true }
        ).exec();
    }

    async findBreedByNameAndSpecies(name: string, speciesId: string): Promise<Breed | null> {
        const entity = await this.breedModel.findOne({ name, speciesId }).exec();
        return entity ? new Breed(entity._id, entity.name, entity.speciesId) : null;
    }

    async findBreedsBySpecies(speciesId: string): Promise<Breed[]> {
        const entities = await this.breedModel.find({ speciesId }).exec();
        return entities.map(e => new Breed(e._id, e.name, e.speciesId));
    }

    // --- HousingType ---
    async saveHousingType(housingType: HousingType): Promise<void> {
        await this.housingTypeModel.updateOne(
            { _id: housingType.id },
            { $set: { name: housingType.name } },
            { upsert: true }
        ).exec();
    }

    async findHousingTypeByName(name: string): Promise<HousingType | null> {
        const entity = await this.housingTypeModel.findOne({ name }).exec();
        return entity ? new HousingType(entity._id, entity.name) : null;
    }

    async findAllHousingTypes(): Promise<HousingType[]> {
        const entities = await this.housingTypeModel.find().exec();
        return entities.map(e => new HousingType(e._id, e.name));
    }

    // --- AnimalPurpose ---
    async saveAnimalPurpose(purpose: AnimalPurpose): Promise<void> {
        await this.animalPurposeModel.updateOne(
            { _id: purpose.id },
            { $set: { name: purpose.name } },
            { upsert: true }
        ).exec();
    }

    async findAnimalPurposeByName(name: string): Promise<AnimalPurpose | null> {
        const entity = await this.animalPurposeModel.findOne({ name }).exec();
        return entity ? new AnimalPurpose(entity._id, entity.name) : null;
    }

    async findAllAnimalPurposes(): Promise<AnimalPurpose[]> {
        const entities = await this.animalPurposeModel.find().exec();
        return entities.map(e => new AnimalPurpose(e._id, e.name));
    }
}
