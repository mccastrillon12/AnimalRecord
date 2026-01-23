import { Controller, Get, Param, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LocationFinder } from '../../context/location/application/location-finder';
import { CountryResponseDto, DepartmentResponseDto, CityResponseDto } from './location-response.dto';

@ApiTags('locations')
@Controller('locations')
export class LocationController {
    constructor(private readonly locationFinder: LocationFinder) { }

    @Get('countries')
    @ApiOperation({ summary: 'Get all countries' })
    @ApiResponse({ status: 200, description: 'List of countries', type: [CountryResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getCountries(): Promise<CountryResponseDto[]> {
        const countries = await this.locationFinder.findAllCountries();
        return countries.map(c => ({ id: c.id, name: c.name, isoCode: c.isoCode, dialCode: c.dialCode }));
    }

    @Get('countries/:id/departments')
    @ApiOperation({ summary: 'Get departments by country' })
    @ApiResponse({ status: 200, description: 'List of departments', type: [DepartmentResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getDepartments(@Param('id') countryId: string): Promise<DepartmentResponseDto[]> {
        const departments = await this.locationFinder.findDepartmentsByCountry(countryId);
        return departments.map(d => ({ id: d.id, name: d.name, countryId: d.countryId }));
    }

    @Get('departments/:id/cities')
    @ApiOperation({ summary: 'Get cities by department' })
    @ApiResponse({ status: 200, description: 'List of cities', type: [CityResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getCities(@Param('id') departmentId: string): Promise<CityResponseDto[]> {
        const cities = await this.locationFinder.findCitiesByDepartment(departmentId);
        return cities.map(c => ({ id: c.id, name: c.name, departmentId: c.departmentId }));
    }
}

