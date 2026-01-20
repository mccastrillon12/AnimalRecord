import { Injectable, Inject } from '@nestjs/common';
import { LocationRepository } from '../domain/location-repository';
import { Country, Department, City } from '../domain/location';

@Injectable()
export class LocationFinder {
    constructor(
        @Inject('LocationRepository') private readonly repository: LocationRepository
    ) { }

    async findAllCountries(): Promise<Country[]> {
        return this.repository.findAllCountries();
    }

    async findDepartmentsByCountry(countryId: string): Promise<Department[]> {
        return this.repository.findDepartmentsByCountry(countryId);
    }

    async findCitiesByDepartment(departmentId: string): Promise<City[]> {
        return this.repository.findCitiesByDepartment(departmentId);
    }
}
