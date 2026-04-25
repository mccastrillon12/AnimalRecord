import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { CatalogsRepository } from '../domain/catalogs-repository';
import { Species, Breed, HousingType, AnimalPurpose, Temperament, AdoptionSource } from '../domain/catalogs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CatalogsSeeder implements OnModuleInit {
    constructor(
        @Inject('CatalogsRepository') private readonly repository: CatalogsRepository
    ) { }

    async onModuleInit() {
        await this.seed();
    }

    async seed() {
        console.log('Seeding catalogs (Species, Breeds, Housing Types, Animal Purposes, Temperaments, Adoption Sources)...');

        await this.seedHousingTypes();
        await this.seedAnimalPurposes();
        await this.seedTemperaments();
        await this.seedAdoptionSources();
        await this.seedSpeciesAndBreeds();

        console.log('Catalogs seeded successfully!');
    }

    private async seedHousingTypes() {
        const defaultHousingTypes = [
            'Finca',
            'Lote',
            'Establo / Pesebre',
            'Apartamento',
            'Casa',
            'Galpón'
        ];

        for (const typeName of defaultHousingTypes) {
            const existing = await this.repository.findHousingTypeByName(typeName);
            if (!existing) {
                await this.repository.saveHousingType(new HousingType(uuidv4(), typeName));
                console.log(`Created HousingType: ${typeName}`);
            }
        }
    }

    private async seedAnimalPurposes() {
        const defaultPurposes = [
            'Producción de Leche',
            'Producción de Carne',
            'Doble Propósito',
            'Compañía / Mascota',
            'Trabajo',
            'Reproducción',
            'Exposición'
        ];

        for (const purposeName of defaultPurposes) {
            const existing = await this.repository.findAnimalPurposeByName(purposeName);
            if (!existing) {
                await this.repository.saveAnimalPurpose(new AnimalPurpose(uuidv4(), purposeName));
                console.log(`Created AnimalPurpose: ${purposeName}`);
            }
        }
    }

    private async seedTemperaments() {
        const defaultTemperaments = [
            'Dócil / Manso',
            'Nervioso',
            'Agresivo / Bravo',
            'Amigable / Juguetón',
            'Protector',
            'Tímido / Asustadizo',
            'Dominante'
        ];

        for (const tempName of defaultTemperaments) {
            const existing = await this.repository.findTemperamentByName(tempName);
            if (!existing) {
                await this.repository.saveTemperament(new Temperament(uuidv4(), tempName));
                console.log(`Created Temperament: ${tempName}`);
            }
        }
    }

    private async seedAdoptionSources() {
        const defaultSources = [
            'Hogar de Paso',
            'Fundación'
        ];

        for (const sourceName of defaultSources) {
            const existing = await this.repository.findAdoptionSourceByName(sourceName);
            if (!existing) {
                await this.repository.saveAdoptionSource(new AdoptionSource(uuidv4(), sourceName));
                console.log(`Created AdoptionSource: ${sourceName}`);
            }
        }
    }

    private async seedSpeciesAndBreeds() {
        const speciesWithBreeds = [
            {
                species: 'Bovino',
                breeds: ['Holstein', 'Brahman', 'Angus', 'Jersey', 'Gyr', 'Normando']
            },
            {
                species: 'Canino',
                breeds: ['Labrador Retriever', 'Pastor Alemán', 'Bulldog', 'Poodle', 'Golden Retriever', 'Criollo']
            },
            {
                species: 'Felino',
                breeds: ['Persa', 'Siamés', 'Maine Coon', 'Criollo']
            },
            {
                species: 'Equino',
                breeds: ['Árabe', 'Cuarto de Milla', 'Pura Sangre', 'Paso Fino', 'Criollo Colombiano']
            },
            {
                species: 'Porcino',
                breeds: ['Duroc', 'Landrace', 'Yorkshire', 'Pietrain']
            }
        ];

        for (const element of speciesWithBreeds) {
            let species = await this.repository.findSpeciesByName(element.species);
            
            if (!species) {
                species = new Species(uuidv4(), element.species);
                await this.repository.saveSpecies(species);
                console.log(`Created Species: ${species.name}`);
            }

            for (const breedName of element.breeds) {
                const existingBreed = await this.repository.findBreedByNameAndSpecies(breedName, species.id);
                
                if (!existingBreed) {
                    await this.repository.saveBreed(new Breed(uuidv4(), breedName, species.id));
                    console.log(`  - Created Breed: ${breedName} (Species: ${species.name})`);
                }
            }
        }
    }
}
