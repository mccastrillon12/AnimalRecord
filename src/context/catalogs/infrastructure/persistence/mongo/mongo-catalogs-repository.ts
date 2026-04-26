import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CatalogsRepository } from '../../../domain/catalogs-repository';
import { Species, Breed, HousingType, AnimalPurpose, Temperament, AdoptionSource, IdentificationType, RegistrationAssociation } from '../../../domain/catalogs';
import {
    SpeciesDocument, BreedDocument, HousingTypeDocument, AnimalPurposeDocument,
    TemperamentDocument, AdoptionSourceDocument, IdentificationTypeDocument, RegistrationAssociationDocument,
    SpeciesEntity, BreedEntity, HousingTypeEntity, AnimalPurposeEntity,
    TemperamentEntity, AdoptionSourceEntity, IdentificationTypeEntity, RegistrationAssociationEntity
} from './catalogs.schema';

@Injectable()
export class MongoCatalogsRepository implements CatalogsRepository {
    constructor(
        @InjectModel(SpeciesEntity.name) private readonly speciesModel: Model<SpeciesDocument>,
        @InjectModel(BreedEntity.name) private readonly breedModel: Model<BreedDocument>,
        @InjectModel(HousingTypeEntity.name) private readonly housingTypeModel: Model<HousingTypeDocument>,
        @InjectModel(AnimalPurposeEntity.name) private readonly animalPurposeModel: Model<AnimalPurposeDocument>,
        @InjectModel(TemperamentEntity.name) private readonly temperamentModel: Model<TemperamentDocument>,
        @InjectModel(AdoptionSourceEntity.name) private readonly adoptionSourceModel: Model<AdoptionSourceDocument>,
        @InjectModel(IdentificationTypeEntity.name) private readonly identificationTypeModel: Model<IdentificationTypeDocument>,
        @InjectModel(RegistrationAssociationEntity.name) private readonly registrationAssociationModel: Model<RegistrationAssociationDocument>
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
            { $set: { name: breed.name, speciesId: breed.speciesId, purposeIds: breed.purposeIds } },
            { upsert: true }
        ).exec();
    }

    async findBreedByNameAndSpecies(name: string, speciesId: string): Promise<Breed | null> {
        const entity = await this.breedModel.findOne({ name, speciesId }).exec();
        return entity ? new Breed(entity._id, entity.name, entity.speciesId, entity.purposeIds) : null;
    }

    async findBreedsBySpecies(speciesId: string, purposeId?: string): Promise<Breed[]> {
        const filter: any = { speciesId };
        if (purposeId) {
            filter.purposeIds = purposeId;
        }
        const entities = await this.breedModel.find(filter).exec();
        return entities.map(e => new Breed(e._id, e.name, e.speciesId, e.purposeIds));
    }

    // --- HousingType ---
    async saveHousingType(housingType: HousingType): Promise<void> {
        await this.housingTypeModel.updateOne(
            { _id: housingType.id },
            { $set: { name: housingType.name, speciesId: housingType.speciesId } },
            { upsert: true }
        ).exec();
    }

    async findHousingTypeByNameAndSpecies(name: string, speciesId: string): Promise<HousingType | null> {
        const entity = await this.housingTypeModel.findOne({ name, speciesId }).exec();
        return entity ? new HousingType(entity._id, entity.name, entity.speciesId) : null;
    }

    async findAllHousingTypes(speciesId?: string): Promise<HousingType[]> {
        const filter = speciesId ? { speciesId } : {};
        const entities = await this.housingTypeModel.find(filter).exec();
        return entities.map(e => new HousingType(e._id, e.name, e.speciesId));
    }

    // --- AnimalPurpose ---
    async saveAnimalPurpose(purpose: AnimalPurpose): Promise<void> {
        await this.animalPurposeModel.updateOne(
            { _id: purpose.id },
            { $set: { name: purpose.name, speciesId: purpose.speciesId } },
            { upsert: true }
        ).exec();
    }

    async findAnimalPurposeByNameAndSpecies(name: string, speciesId: string): Promise<AnimalPurpose | null> {
        const entity = await this.animalPurposeModel.findOne({ name, speciesId }).exec();
        return entity ? new AnimalPurpose(entity._id, entity.name, entity.speciesId) : null;
    }

    async findAllAnimalPurposes(speciesId?: string): Promise<AnimalPurpose[]> {
        const filter = speciesId ? { speciesId } : {};
        const entities = await this.animalPurposeModel.find(filter).exec();
        return entities.map(e => new AnimalPurpose(e._id, e.name, e.speciesId));
    }

    // --- Temperament ---
    async saveTemperament(temperament: Temperament): Promise<void> {
        await this.temperamentModel.updateOne(
            { _id: temperament.id },
            { $set: { name: temperament.name, speciesId: temperament.speciesId } },
            { upsert: true }
        ).exec();
    }

    async findTemperamentByNameAndSpecies(name: string, speciesId: string): Promise<Temperament | null> {
        const entity = await this.temperamentModel.findOne({ name, speciesId }).exec();
        return entity ? new Temperament(entity._id, entity.name, entity.speciesId) : null;
    }

    async findAllTemperaments(speciesId?: string): Promise<Temperament[]> {
        const filter = speciesId ? { speciesId } : {};
        const entities = await this.temperamentModel.find(filter).exec();
        return entities.map(e => new Temperament(e._id, e.name, e.speciesId));
    }

    // --- AdoptionSource ---
    async saveAdoptionSource(source: AdoptionSource): Promise<void> {
        await this.adoptionSourceModel.updateOne(
            { _id: source.id },
            { $set: { name: source.name } },
            { upsert: true }
        ).exec();
    }

    async findAdoptionSourceByName(name: string): Promise<AdoptionSource | null> {
        const entity = await this.adoptionSourceModel.findOne({ name }).exec();
        return entity ? new AdoptionSource(entity._id, entity.name) : null;
    }

    async findAllAdoptionSources(): Promise<AdoptionSource[]> {
        const entities = await this.adoptionSourceModel.find().exec();
        return entities.map(e => new AdoptionSource(e._id, e.name));
    }

    // --- IdentificationType ---
    async saveIdentificationType(idType: IdentificationType): Promise<void> {
        await this.identificationTypeModel.updateOne(
            { _id: idType.id },
            { $set: { name: idType.name, speciesId: idType.speciesId } },
            { upsert: true }
        ).exec();
    }

    async findIdentificationTypeByNameAndSpecies(name: string, speciesId: string): Promise<IdentificationType | null> {
        const entity = await this.identificationTypeModel.findOne({ name, speciesId }).exec();
        return entity ? new IdentificationType(entity._id, entity.name, entity.speciesId) : null;
    }

    async findAllIdentificationTypes(speciesId?: string): Promise<IdentificationType[]> {
        const filter = speciesId ? { speciesId } : {};
        const entities = await this.identificationTypeModel.find(filter).exec();
        return entities.map(e => new IdentificationType(e._id, e.name, e.speciesId));
    }

    // --- RegistrationAssociation ---
    async saveRegistrationAssociation(assoc: RegistrationAssociation): Promise<void> {
        await this.registrationAssociationModel.updateOne(
            { _id: assoc.id },
            { $set: { name: assoc.name, speciesId: assoc.speciesId } },
            { upsert: true }
        ).exec();
    }

    async findRegistrationAssociationByNameAndSpecies(name: string, speciesId: string): Promise<RegistrationAssociation | null> {
        const entity = await this.registrationAssociationModel.findOne({ name, speciesId }).exec();
        return entity ? new RegistrationAssociation(entity._id, entity.name, entity.speciesId) : null;
    }

    async findAllRegistrationAssociations(speciesId?: string): Promise<RegistrationAssociation[]> {
        const filter = speciesId ? { speciesId } : {};
        const entities = await this.registrationAssociationModel.find(filter).exec();
        return entities.map(e => new RegistrationAssociation(e._id, e.name, e.speciesId));
    }
}
