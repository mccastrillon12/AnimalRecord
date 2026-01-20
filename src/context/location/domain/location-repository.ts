import { Country, Department, City } from './location';

export interface LocationRepository {
    findAllCountries(): Promise<Country[]>;
    findDepartmentsByCountry(countryId: string): Promise<Department[]>;
    findCitiesByDepartment(departmentId: string): Promise<City[]>;

    // For seeding
    saveCountry(country: Country): Promise<void>;
    saveDepartment(department: Department): Promise<void>;
    saveCity(city: City): Promise<void>;
    countCountries(): Promise<number>;
}
