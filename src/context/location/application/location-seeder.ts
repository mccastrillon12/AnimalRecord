import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { LocationRepository } from '../domain/location-repository';
import { Country, Department, City } from '../domain/location';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LocationSeeder implements OnModuleInit {
    constructor(
        @Inject('LocationRepository') private readonly repository: LocationRepository
    ) { }

    async onModuleInit() {
        await this.seed();
    }

    async seed() {
        console.log('Seeding locations...');

        const countriesToSeed = [
            { name: 'Colombia', isoCode: 'CO', dialCode: '+57' },
            { name: 'United States', isoCode: 'US', dialCode: '+1' }
        ];

        for (const countryData of countriesToSeed) {
            let country = await this.repository.findByIsoCode(countryData.isoCode);

            if (!country) {
                // Create new
                country = new Country(uuidv4(), countryData.name, countryData.isoCode, countryData.dialCode);
                await this.repository.saveCountry(country);
                console.log(`Created country: ${country.name}`);
            } else {
                // Update existing
                country = new Country(country.id, countryData.name, countryData.isoCode, countryData.dialCode);
                await this.repository.saveCountry(country);
                console.log(`Updated country: ${country.name}`);
            }

            // Seed Departments/Cities only for Colombia for now (as per original logic)
            if (country.isoCode === 'CO') {
                await this.seedColombiaDepartments(country.id);
            }
        }

        console.log('Locations seeded/updated successfully!');
    }

    private async seedColombiaDepartments(colombiaId: string) {
        // Check if departments exist to avoid duplication (simple check for now)
        // In a full smart seeder, we'd check each dept by name/id too.
        // For now, we reuse the existing check-if-present logic or just add missing.
        // Given the request was about Country Safety, we'll keep department logic simple/safe.

        const existingDepts = await this.repository.findDepartmentsByCountry(colombiaId);
        if (existingDepts.length > 0) return; // Skip if already populated to avoid duplication

        const departments = [
            {
                name: 'Bogotá D.C.',
                cities: ['Bogotá']
            },
            {
                name: 'Antioquia',
                cities: ['Medellín', 'Rionegro', 'Bello', 'Envigado', 'Itagüí']
            },
            {
                name: 'Valle del Cauca',
                cities: ['Cali', 'Palmira', 'Buenaventura']
            },
            {
                name: 'Atlántico',
                cities: ['Barranquilla', 'Soledad']
            },
            {
                name: 'Santander',
                cities: ['Bucaramanga', 'Floridablanca']
            },
            {
                name: 'Bolívar',
                cities: ['Cartagena']
            }
        ];

        for (const deptData of departments) {
            const deptId = uuidv4();
            await this.repository.saveDepartment(new Department(deptId, deptData.name, colombiaId));

            for (const cityName of deptData.cities) {
                const cityId = uuidv4();
                await this.repository.saveCity(new City(cityId, cityName, deptId));
            }
        }
    }
}
