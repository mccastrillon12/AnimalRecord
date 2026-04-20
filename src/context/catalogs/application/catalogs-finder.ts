import { Injectable, Inject } from '@nestjs/common';
import { CatalogsRepository } from '../domain/catalogs-repository';
import { Species, Breed, HousingType, AnimalPurpose } from '../domain/catalogs';

@Injectable()
export class CatalogsFinder {
    constructor(
        @Inject('CatalogsRepository') private readonly repository: CatalogsRepository
    ) { }

    async findAllSpecies(): Promise<Species[]> {
        return this.repository.findAllSpecies();
    }

    async findBreedsBySpecies(speciesId: string): Promise<Breed[]> {
        return this.repository.findBreedsBySpecies(speciesId);
    }

    async findAllHousingTypes(): Promise<HousingType[]> {
        return this.repository.findAllHousingTypes();
    }

    async findAllAnimalPurposes(): Promise<AnimalPurpose[]> {
        return this.repository.findAllAnimalPurposes();
    }
}
