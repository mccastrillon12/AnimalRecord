import { Injectable, Inject } from '@nestjs/common';
import { CatalogsRepository } from '../domain/catalogs-repository';
import { Species, Breed, HousingType, AnimalPurpose, Temperament, AdoptionSource, IdentificationType, RegistrationAssociation } from '../domain/catalogs';

@Injectable()
export class CatalogsFinder {
    constructor(
        @Inject('CatalogsRepository') private readonly repository: CatalogsRepository
    ) { }

    async findAllSpecies(): Promise<Species[]> {
        return this.repository.findAllSpecies();
    }

    async findBreedsBySpecies(speciesId: string, purposeId?: string): Promise<Breed[]> {
        return this.repository.findBreedsBySpecies(speciesId, purposeId);
    }

    async findAllHousingTypes(speciesId?: string): Promise<HousingType[]> {
        return this.repository.findAllHousingTypes(speciesId);
    }

    async findAllAnimalPurposes(speciesId?: string): Promise<AnimalPurpose[]> {
        return this.repository.findAllAnimalPurposes(speciesId);
    }

    async findAllTemperaments(speciesId?: string): Promise<Temperament[]> {
        return this.repository.findAllTemperaments(speciesId);
    }

    async findAllAdoptionSources(): Promise<AdoptionSource[]> {
        return this.repository.findAllAdoptionSources();
    }

    async findAllIdentificationTypes(speciesId?: string): Promise<IdentificationType[]> {
        return this.repository.findAllIdentificationTypes(speciesId);
    }

    async findAllRegistrationAssociations(speciesId?: string): Promise<RegistrationAssociation[]> {
        return this.repository.findAllRegistrationAssociations(speciesId);
    }
}
