import { Species, Breed, HousingType, AnimalPurpose, Temperament, AdoptionSource, IdentificationType, RegistrationAssociation } from './catalogs';

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
    findHousingTypeByNameAndSpecies(name: string, speciesId: string): Promise<HousingType | null>;
    findAllHousingTypes(speciesId?: string): Promise<HousingType[]>;

    // AnimalPurpose
    saveAnimalPurpose(purpose: AnimalPurpose): Promise<void>;
    findAnimalPurposeByNameAndSpecies(name: string, speciesId: string): Promise<AnimalPurpose | null>;
    findAllAnimalPurposes(speciesId?: string): Promise<AnimalPurpose[]>;

    // Temperament
    saveTemperament(temperament: Temperament): Promise<void>;
    findTemperamentByNameAndSpecies(name: string, speciesId: string): Promise<Temperament | null>;
    findAllTemperaments(speciesId?: string): Promise<Temperament[]>;

    // AdoptionSource
    saveAdoptionSource(source: AdoptionSource): Promise<void>;
    findAdoptionSourceByName(name: string): Promise<AdoptionSource | null>;
    findAllAdoptionSources(): Promise<AdoptionSource[]>;

    // IdentificationType
    saveIdentificationType(idType: IdentificationType): Promise<void>;
    findIdentificationTypeByNameAndSpecies(name: string, speciesId: string): Promise<IdentificationType | null>;
    findAllIdentificationTypes(speciesId?: string): Promise<IdentificationType[]>;

    // RegistrationAssociation
    saveRegistrationAssociation(assoc: RegistrationAssociation): Promise<void>;
    findRegistrationAssociationByNameAndSpecies(name: string, speciesId: string): Promise<RegistrationAssociation | null>;
    findAllRegistrationAssociations(speciesId?: string): Promise<RegistrationAssociation[]>;
}
