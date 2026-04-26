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

        // 1. Species first (everything depends on them)
        const speciesMap = await this.seedSpecies();

        // 2. Purposes before breeds (bovino breeds need purpose IDs)
        await this.seedPurposesForSpecies(speciesMap);

        // 3. Now breeds (with purposeIds for bovinos)
        await this.seedBreedsForSpecies(speciesMap);

        // 4. Rest of catalogs
        await this.seedTemperamentsForSpecies(speciesMap);
        await this.seedHousingTypesForSpecies(speciesMap);
        await this.seedIdentificationTypesForSpecies(speciesMap);
        await this.seedRegistrationAssociationsForSpecies(speciesMap);

        // 5. Non-species-dependent
        await this.seedAdoptionSources();

        console.log('Catalogs seeded successfully!');
    }

    // =====================================================
    // SPECIES
    // =====================================================
    private async seedSpecies(): Promise<Map<string, string>> {
        const speciesNames = ['Canino', 'Felino', 'Bovino', 'Equino', 'Porcino'];
        const map = new Map<string, string>();

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
    // PURPOSES (per species) — seeded BEFORE breeds
    // =====================================================
    private async seedPurposesForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': ['Compañía', 'Trabajo', 'Reproducción'],
            'Felino': ['Compañía', 'Reproducción'],
            'Bovino': ['Carne', 'Leche', 'Doble propósito', 'Reproducción', 'Lidia'],
            'Equino': ['Competencia', 'Trabajo', 'Recreación', 'Reproducción']
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
    // BREEDS (per species) — Official lists
    // =====================================================
    private async seedBreedsForSpecies(speciesMap: Map<string, string>) {
        // Canino & Felino: simple lists without purposeIds
        const simpleBreeds: Record<string, string[]> = {
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
            'Equino': [
                'Mestizo', 'Andaluz', 'Appaloosa', 'Asno', 'Árabe', 'Criollo Colombiano',
                'Cuarto de Milla', 'Frisón', 'Lusitano', 'Mula', 'Paint Horse',
                'Paso Fino Colombiano', 'Percherón', 'Pura Sangre Inglés (PSI)', 'Warmblood'
            ],
            'Porcino': ['Duroc', 'Landrace', 'Yorkshire', 'Pietrain']
        };

        for (const [speciesName, breeds] of Object.entries(simpleBreeds)) {
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

        // Bovino: breeds with purposeIds (two-level structure)
        await this.seedBovinoBreeds(speciesMap);
    }

    private async seedBovinoBreeds(speciesMap: Map<string, string>) {
        const bovinoId = speciesMap.get('Bovino');
        if (!bovinoId) return;

        // Get purpose IDs
        const carnePurpose = await this.repository.findAnimalPurposeByNameAndSpecies('Carne', bovinoId);
        const lechePurpose = await this.repository.findAnimalPurposeByNameAndSpecies('Leche', bovinoId);
        const doblePurpose = await this.repository.findAnimalPurposeByNameAndSpecies('Doble propósito', bovinoId);

        if (!carnePurpose || !lechePurpose || !doblePurpose) {
            console.error('Cannot seed Bovino breeds: purposes not found');
            return;
        }

        const carne = carnePurpose.id;
        const leche = lechePurpose.id;
        const doble = doblePurpose.id;

        // Breed name -> array of purpose IDs
        const bovinoBreeds: Array<{ name: string; purposes: string[] }> = [
            // Carne only
            { name: 'Brahman', purposes: [carne] },
            { name: 'Nelore', purposes: [carne] },
            { name: 'Indubrasil', purposes: [carne] },
            { name: 'Angus', purposes: [carne] },
            { name: 'Brangus', purposes: [carne] },
            { name: 'Hereford', purposes: [carne] },
            { name: 'Braford', purposes: [carne] },
            { name: 'Charolais', purposes: [carne] },
            { name: 'Limousin', purposes: [carne] },
            { name: 'Senepol', purposes: [carne] },
            { name: 'Bonsmara', purposes: [carne] },
            { name: 'Beefmaster', purposes: [carne] },
            { name: 'Wagyu', purposes: [carne] },
            { name: 'Romosinuano (criollo)', purposes: [carne] },
            { name: 'Blanco Orejinegro BON (criollo)', purposes: [carne] },
            { name: 'Casanareño (criollo)', purposes: [carne] },

            // Leche only
            { name: 'Gyr', purposes: [leche] },
            { name: 'Guzerá', purposes: [leche] },
            { name: 'Girolando', purposes: [leche] },
            { name: 'Holstein', purposes: [leche] },
            { name: 'Jersey', purposes: [leche] },
            { name: 'Pardo Suizo', purposes: [leche] },
            { name: 'Ayrshire', purposes: [leche] },
            { name: 'Hartón del Valle (criollo)', purposes: [leche] },

            // Doble propósito only
            { name: 'Normando', purposes: [doble] },
            { name: 'Simmental', purposes: [doble] },
            { name: 'Sindi', purposes: [doble] },
            { name: 'Sardo Negro', purposes: [doble] },
            { name: 'Costeño con Cuernos (criollo)', purposes: [doble] },
            { name: 'Sanmartinero (criollo)', purposes: [doble] },
            { name: 'Chino Santandereano (criollo)', purposes: [doble] },
            { name: 'Criollo Caqueteño (criollo)', purposes: [doble] },

            // Multi-purpose
            { name: 'Mestizo comercial', purposes: [carne, leche, doble] },
            { name: 'Cebú', purposes: [carne, leche, doble] },
        ];

        for (const breed of bovinoBreeds) {
            const existing = await this.repository.findBreedByNameAndSpecies(breed.name, bovinoId);
            if (!existing) {
                await this.repository.saveBreed(new Breed(uuidv4(), breed.name, bovinoId, breed.purposes));
                console.log(`  Created Breed: ${breed.name} (Bovino) [${breed.purposes.length} purpose(s)]`);
            }
        }
    }

    // =====================================================
    // TEMPERAMENTS (per species) — Official lists
    // =====================================================
    private async seedTemperamentsForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': ['Tranquilo', 'Activo', 'Nervioso', 'Agresivo', 'Apático'],
            'Felino': ['Tranquilo', 'Activo', 'Nervioso', 'Huraño', 'Agresivo'],
            'Bovino': ['Dócil', 'Nervioso', 'Agresivo', 'Apático'],
            'Equino': ['Dócil', 'Nervioso', 'Fogoso', 'Agresivo', 'Apático']
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
    // HOUSING TYPES (per species) — Official lists
    // =====================================================
    private async seedHousingTypesForSpecies(speciesMap: Map<string, string>) {
        const data: Record<string, string[]> = {
            'Canino': ['Interior', 'Exterior', 'Mixto'],
            'Felino': ['Interior', 'Exterior', 'Mixto'],
            'Bovino': ['Pastoreo extensivo', 'Pastoreo semi-intensivo', 'Establo / Confinamiento', 'Mixto'],
            'Equino': ['Potrero / Pastoreo', 'Establo', 'Semipastoreo', 'Pesebrería']
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
            'Felino': ['Microchip', 'Tatuaje'],
            'Bovino': ['Arete visual', 'Arete electrónico (RFID)', 'Bolo intraruminal', 'Marca de fuego', 'Tatuaje'],
            'Equino': ['Microchip', 'Marca de fuego', 'Tatuaje']
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
            ],
            'Bovino': [
                'ASOCEBÚ – Brahman, Gyr, Guzerá, Nelore, Indubrasil, Sindi, Sardo Negro',
                'ASOBRANGUS – Angus puro y Brangus puro',
                'ASOHOLSTEIN – Holstein',
                'ASOSIMMENTAL – Simmental, Simbrah, Simmcebú',
                'ASONORMANDO – Normando',
                'ASOJERSEY – Jersey',
                'ASOHEREFORD – Hereford, Braford',
                'ASOLIMOUSIN – Limousin',
                'ASOSENEPOL – Senepol',
                'ASOPARDO – Pardo Suizo / Braunvieh',
                'ASOCRIOLLO – Razas criollas y colombianas',
                'ASOBEEFMASTER – Beefmaster',
                'WAGYU Colombia',
                'ASOMONTBELIARDE – Montbeliarde',
                'Sin registro'
            ],
            'Equino': [
                'FEDEQUINAS – Federación Colombiana de Asociaciones Equinas',
                'ASDEPASO – Caballo de Paso Fino Colombiano',
                'ASOCRIOLLISTA – Criollo Colombiano',
                'ACCM – Asociación Colombiana Cuarto de Milla (filial AQHA)',
                'AQHA – American Quarter Horse Association',
                'ASOCRIADORES – Criadores de Caballos P.S.I. (Stud Book Colombiano)',
                'ACPSL – Criadores Pura Sangre Lusitano',
                'ASOIBERICO – Caballos Andaluces y Lusitanos',
                'CONFEPASO – Confederación Internacional de Caballos de Paso',
                'FEI – Federación Ecuestre Internacional',
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
    // ADOPTION SOURCES (global)
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
