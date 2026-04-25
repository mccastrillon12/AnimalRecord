import { Controller, Get, Param, Header, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CatalogsFinder } from '../../context/catalogs/application/catalogs-finder';
import {
    SpeciesResponseDto,
    BreedResponseDto,
    HousingTypeResponseDto,
    AnimalPurposeResponseDto,
    TemperamentResponseDto,
    AdoptionSourceResponseDto,
    IdentificationTypeResponseDto,
    RegistrationAssociationResponseDto
} from './catalogs-response.dto';

@ApiTags('catalogs')
@Controller('catalogs')
export class CatalogsController {
    constructor(private readonly catalogsFinder: CatalogsFinder) { }

    @Get('species')
    @ApiOperation({ summary: 'Get all species' })
    @ApiResponse({ status: 200, description: 'List of species', type: [SpeciesResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getSpecies(): Promise<SpeciesResponseDto[]> {
        const species = await this.catalogsFinder.findAllSpecies();
        return species.map(s => ({ id: s.id, name: s.name }));
    }

    @Get('species/:speciesId/breeds')
    @ApiOperation({ summary: 'Get breeds by species. Optionally filter by purpose.' })
    @ApiQuery({ name: 'purposeId', required: false, description: 'Filter breeds by purpose ID (for bovinos)' })
    @ApiResponse({ status: 200, description: 'List of breeds', type: [BreedResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getBreeds(
        @Param('speciesId') speciesId: string,
        @Query('purposeId') purposeId?: string
    ): Promise<BreedResponseDto[]> {
        const breeds = await this.catalogsFinder.findBreedsBySpecies(speciesId, purposeId);
        return breeds.map(b => ({ id: b.id, name: b.name, speciesId: b.speciesId, purposeIds: b.purposeIds }));
    }

    @Get('housing-types')
    @ApiOperation({ summary: 'Get housing types. Optionally filter by species.' })
    @ApiQuery({ name: 'speciesId', required: false, description: 'Filter by species ID' })
    @ApiResponse({ status: 200, description: 'List of housing types', type: [HousingTypeResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getHousingTypes(@Query('speciesId') speciesId?: string): Promise<HousingTypeResponseDto[]> {
        const housingTypes = await this.catalogsFinder.findAllHousingTypes(speciesId);
        return housingTypes.map(h => ({ id: h.id, name: h.name, speciesId: h.speciesId }));
    }

    @Get('animal-purposes')
    @ApiOperation({ summary: 'Get animal purposes. Optionally filter by species.' })
    @ApiQuery({ name: 'speciesId', required: false, description: 'Filter by species ID' })
    @ApiResponse({ status: 200, description: 'List of animal purposes', type: [AnimalPurposeResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getAnimalPurposes(@Query('speciesId') speciesId?: string): Promise<AnimalPurposeResponseDto[]> {
        const purposes = await this.catalogsFinder.findAllAnimalPurposes(speciesId);
        return purposes.map(p => ({ id: p.id, name: p.name, speciesId: p.speciesId }));
    }

    @Get('temperaments')
    @ApiOperation({ summary: 'Get temperaments. Optionally filter by species.' })
    @ApiQuery({ name: 'speciesId', required: false, description: 'Filter by species ID' })
    @ApiResponse({ status: 200, description: 'List of temperaments', type: [TemperamentResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getTemperaments(@Query('speciesId') speciesId?: string): Promise<TemperamentResponseDto[]> {
        const temperaments = await this.catalogsFinder.findAllTemperaments(speciesId);
        return temperaments.map(t => ({ id: t.id, name: t.name, speciesId: t.speciesId }));
    }

    @Get('adoption-sources')
    @ApiOperation({ summary: 'Get all adoption sources' })
    @ApiResponse({ status: 200, description: 'List of adoption sources', type: [AdoptionSourceResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getAdoptionSources(): Promise<AdoptionSourceResponseDto[]> {
        const sources = await this.catalogsFinder.findAllAdoptionSources();
        return sources.map(s => ({ id: s.id, name: s.name }));
    }

    @Get('identification-types')
    @ApiOperation({ summary: 'Get identification types. Optionally filter by species.' })
    @ApiQuery({ name: 'speciesId', required: false, description: 'Filter by species ID' })
    @ApiResponse({ status: 200, description: 'List of identification types', type: [IdentificationTypeResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getIdentificationTypes(@Query('speciesId') speciesId?: string): Promise<IdentificationTypeResponseDto[]> {
        const types = await this.catalogsFinder.findAllIdentificationTypes(speciesId);
        return types.map(t => ({ id: t.id, name: t.name, speciesId: t.speciesId }));
    }

    @Get('registration-associations')
    @ApiOperation({ summary: 'Get registration associations. Optionally filter by species.' })
    @ApiQuery({ name: 'speciesId', required: false, description: 'Filter by species ID' })
    @ApiResponse({ status: 200, description: 'List of registration associations', type: [RegistrationAssociationResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getRegistrationAssociations(@Query('speciesId') speciesId?: string): Promise<RegistrationAssociationResponseDto[]> {
        const assocs = await this.catalogsFinder.findAllRegistrationAssociations(speciesId);
        return assocs.map(a => ({ id: a.id, name: a.name, speciesId: a.speciesId }));
    }
}
