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
        const count = await this.repository.countCountries();
        if (count > 0) {
            console.log('Locations already seeded.');
            return;
        }

        console.log('Seeding locations...');

        const colombiaId = uuidv4();
        await this.repository.saveCountry(new Country(colombiaId, 'Colombia', 'CO'));

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

        console.log('Locations seeded successfully!');
    }
}
