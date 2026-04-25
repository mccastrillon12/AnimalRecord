import { Species, Breed, HousingType, AnimalPurpose, Temperament, AdoptionSource } from './catalogs';

export interface CatalogsRepository {
    // Species
    saveSpecies(species: Species): Promise<void>;
    findSpeciesByName(name: string): Promise<Species | null>;
    findAllSpecies(): Promise<Species[]>;

    // Breed
    saveBreed(breed: Breed): Promise<void>;
    findBreedByNameAndSpecies(name: string, speciesId: string): Promise<Breed | null>;
    findBreedsBySpecies(speciesId: string): Promise<Breed[]>;

    // HousingType
    saveHousingType(housingType: HousingType): Promise<void>;
    findHousingTypeByName(name: string): Promise<HousingType | null>;
    findAllHousingTypes(): Promise<HousingType[]>;

    // AnimalPurpose
    saveAnimalPurpose(purpose: AnimalPurpose): Promise<void>;
    findAnimalPurposeByName(name: string): Promise<AnimalPurpose | null>;
    findAllAnimalPurposes(): Promise<AnimalPurpose[]>;

    // Temperament
    saveTemperament(temperament: Temperament): Promise<void>;
    findTemperamentByName(name: string): Promise<Temperament | null>;
    findAllTemperaments(): Promise<Temperament[]>;

    // AdoptionSource
    saveAdoptionSource(source: AdoptionSource): Promise<void>;
    findAdoptionSourceByName(name: string): Promise<AdoptionSource | null>;
    findAllAdoptionSources(): Promise<AdoptionSource[]>;
}
