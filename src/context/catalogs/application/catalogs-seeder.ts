import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { CatalogsRepository } from '../domain/catalogs-repository';
import { Species, Breed, HousingType, AnimalPurpose, Temperament, AdoptionSource, IdentificationType, RegistrationAssociation } from '../domain/catalogs';
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
        console.log('Seeding catalogs...');

        // First create species since everything depends on them
        const speciesMap = await this.seedSpecies();

        // Then seed everything per species
        await this.seedBreedsForSpecies(speciesMap);
        await this.seedTemperamentsForSpecies(speciesMap);
        await this.seedPurposesForSpecies(speciesMap);
        await this.seedHousingTypesForSpecies(speciesMap);
        await this.seedIdentificationTypesForSpecies(speciesMap);
        await this.seedRegistrationAssociationsForSpecies(speciesMap);

        // Non-species-dependent catalogs
        await this.seedAdoptionSources();

        console.log('Catalogs seeded successfully!');
    }

    // =====================================================
    // SPECIES
    // =====================================================
    private async seedSpecies(): Promise<Map<string, string>> {
        const speciesNames = ['Canino', 'Felino', 'Bovino', 'Equino', 'Porcino'];
        const map = new Map<string, string>(); // name -> id

        for (const name of speciesNames) {
            let species = await this.repository.findSpeciesByName(name);
            if (!species) {
                species = new Species(uuidv4(), name);
                await this.repository.saveSpecies(species);
                console.log(`Created Species: ${name}`);
            }
            map.set(name, species.id);
        }

        return map;
    }

    // =====================================================
    // BREEDS (per species) — Official lists
    // =====================================================
    private async seedBreedsForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': [
                'Mestizo / Criollo', 'Basset Hound', 'Beagle', 'Bichón Frisé', 'Border Collie',
                'Boxer', 'Bulldog Francés', 'Chihuahua', 'Cocker Spaniel', 'Dálmata',
                'Dachshund', 'Dobermann', 'Golden Retriever', 'Gran Danés', 'Husky Siberiano',
                'Labrador Retriever', 'Lhasa Apso', 'Maltés', 'Pastor Alemán', 'Pinscher Miniatura',
                'Pitbull', 'Pomerania', 'Poodle', 'Pug', 'Rottweiler',
                'Schnauzer', 'Shih Tzu', 'Yorkshire Terrier'
            ],
            'Felino': [
                'Mestizo / Criollo', 'Abisinio', 'Angora', 'Azul Ruso', 'Bengalí',
                'Birmano', 'British Shorthair', 'Exotic Shorthair', 'Himalayo', 'Maine Coon',
                'Persa', 'Ragdoll', 'Scottish Fold', 'Siamés', 'Siberiano', 'Sphynx'
            ],
            'Bovino': ['Holstein', 'Brahman', 'Angus', 'Jersey', 'Gyr', 'Normando'],
            'Equino': ['Árabe', 'Cuarto de Milla', 'Pura Sangre', 'Paso Fino', 'Criollo Colombiano'],
            'Porcino': ['Duroc', 'Landrace', 'Yorkshire', 'Pietrain']
        };

        for (const [speciesName, breeds] of Object.entries(data)) {
            const speciesId = speciesMap.get(speciesName);
            if (!speciesId) continue;

            for (const breedName of breeds) {
                const existing = await this.repository.findBreedByNameAndSpecies(breedName, speciesId);
                if (!existing) {
                    await this.repository.saveBreed(new Breed(uuidv4(), breedName, speciesId));
                    console.log(`  Created Breed: ${breedName} (${speciesName})`);
                }
            }
        }
    }

    // =====================================================
    // TEMPERAMENTS (per species) — Official lists
    // =====================================================
    private async seedTemperamentsForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': ['Tranquilo', 'Activo', 'Nervioso', 'Agresivo', 'Apático'],
            'Felino': ['Tranquilo', 'Activo', 'Nervioso', 'Huraño', 'Agresivo']
        };

        for (const [speciesName, temps] of Object.entries(data)) {
            const speciesId = speciesMap.get(speciesName);
            if (!speciesId) continue;

            for (const name of temps) {
                const existing = await this.repository.findTemperamentByNameAndSpecies(name, speciesId);
                if (!existing) {
                    await this.repository.saveTemperament(new Temperament(uuidv4(), name, speciesId));
                    console.log(`  Created Temperament: ${name} (${speciesName})`);
                }
            }
        }
    }

    // =====================================================
    // PURPOSES (per species) — Official lists
    // =====================================================
    private async seedPurposesForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': ['Compañía', 'Trabajo', 'Reproducción'],
            'Felino': ['Compañía', 'Reproducción']
        };

        for (const [speciesName, purposes] of Object.entries(data)) {
            const speciesId = speciesMap.get(speciesName);
            if (!speciesId) continue;

            for (const name of purposes) {
                const existing = await this.repository.findAnimalPurposeByNameAndSpecies(name, speciesId);
                if (!existing) {
                    await this.repository.saveAnimalPurpose(new AnimalPurpose(uuidv4(), name, speciesId));
                    console.log(`  Created Purpose: ${name} (${speciesName})`);
                }
            }
        }
    }

    // =====================================================
    // HOUSING TYPES (per species) — Official lists
    // =====================================================
    private async seedHousingTypesForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': ['Interior', 'Exterior', 'Mixto'],
            'Felino': ['Interior', 'Exterior', 'Mixto']
        };

        for (const [speciesName, types] of Object.entries(data)) {
            const speciesId = speciesMap.get(speciesName);
            if (!speciesId) continue;

            for (const name of types) {
                const existing = await this.repository.findHousingTypeByNameAndSpecies(name, speciesId);
                if (!existing) {
                    await this.repository.saveHousingType(new HousingType(uuidv4(), name, speciesId));
                    console.log(`  Created HousingType: ${name} (${speciesName})`);
                }
            }
        }
    }

    // =====================================================
    // IDENTIFICATION TYPES (per species) — Official lists
    // =====================================================
    private async seedIdentificationTypesForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': ['Microchip', 'Placa / Collar', 'Tatuaje'],
            'Felino': ['Microchip', 'Tatuaje']
        };

        for (const [speciesName, types] of Object.entries(data)) {
            const speciesId = speciesMap.get(speciesName);
            if (!speciesId) continue;

            for (const name of types) {
                const existing = await this.repository.findIdentificationTypeByNameAndSpecies(name, speciesId);
                if (!existing) {
                    await this.repository.saveIdentificationType(new IdentificationType(uuidv4(), name, speciesId));
                    console.log(`  Created IdentificationType: ${name} (${speciesName})`);
                }
            }
        }
    }

    // =====================================================
    // REGISTRATION ASSOCIATIONS (per species) — Official lists
    // =====================================================
    private async seedRegistrationAssociationsForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': [
                'ACCC – Asociación Club Canino Colombiano',
                'FCI – Federación Cinológica Internacional',
                'AKC – American Kennel Club',
                'Sin registro'
            ],
            'Felino': [
                'ACFEC – Asociación Club Felino Colombiano',
                'FIFé – Fédération Internationale Féline',
                'TICA – The International Cat Association',
                'CFA – Cat Fanciers\' Association',
                'WCF – World Cat Federation',
                'Sin registro'
            ]
        };

        for (const [speciesName, assocs] of Object.entries(data)) {
            const speciesId = speciesMap.get(speciesName);
            if (!speciesId) continue;

            for (const name of assocs) {
                const existing = await this.repository.findRegistrationAssociationByNameAndSpecies(name, speciesId);
                if (!existing) {
                    await this.repository.saveRegistrationAssociation(new RegistrationAssociation(uuidv4(), name, speciesId));
                    console.log(`  Created RegistrationAssociation: ${name} (${speciesName})`);
                }
            }
        }
    }

    // =====================================================
    // ADOPTION SOURCES (global, not species-dependent)
    // =====================================================
    private async seedAdoptionSources() {
        const defaultSources = ['Hogar de Paso', 'Fundación'];

        for (const sourceName of defaultSources) {
            const existing = await this.repository.findAdoptionSourceByName(sourceName);
            if (!existing) {
                await this.repository.saveAdoptionSource(new AdoptionSource(uuidv4(), sourceName));
                console.log(`Created AdoptionSource: ${sourceName}`);
            }
        }
    }
}
