import { Controller, Get, Param, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CatalogsFinder } from '../../context/catalogs/application/catalogs-finder';
import { 
    SpeciesResponseDto, 
    BreedResponseDto, 
    HousingTypeResponseDto, 
    AnimalPurposeResponseDto,
    TemperamentResponseDto,
    AdoptionSourceResponseDto
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
    @ApiOperation({ summary: 'Get breeds by species' })
    @ApiResponse({ status: 200, description: 'List of breeds', type: [BreedResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getBreeds(@Param('speciesId') speciesId: string): Promise<BreedResponseDto[]> {
        const breeds = await this.catalogsFinder.findBreedsBySpecies(speciesId);
        return breeds.map(b => ({ id: b.id, name: b.name, speciesId: b.speciesId }));
    }

    @Get('housing-types')
    @ApiOperation({ summary: 'Get all housing types' })
    @ApiResponse({ status: 200, description: 'List of housing types', type: [HousingTypeResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getHousingTypes(): Promise<HousingTypeResponseDto[]> {
        const housingTypes = await this.catalogsFinder.findAllHousingTypes();
        return housingTypes.map(h => ({ id: h.id, name: h.name }));
    }

    @Get('animal-purposes')
    @ApiOperation({ summary: 'Get all animal purposes' })
    @ApiResponse({ status: 200, description: 'List of animal purposes', type: [AnimalPurposeResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getAnimalPurposes(): Promise<AnimalPurposeResponseDto[]> {
        const purposes = await this.catalogsFinder.findAllAnimalPurposes();
        return purposes.map(p => ({ id: p.id, name: p.name }));
    }

    @Get('temperaments')
    @ApiOperation({ summary: 'Get all temperaments' })
    @ApiResponse({ status: 200, description: 'List of temperaments', type: [TemperamentResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getTemperaments(): Promise<TemperamentResponseDto[]> {
        const temperaments = await this.catalogsFinder.findAllTemperaments();
        return temperaments.map(t => ({ id: t.id, name: t.name }));
    }

    @Get('adoption-sources')
    @ApiOperation({ summary: 'Get all adoption sources' })
    @ApiResponse({ status: 200, description: 'List of adoption sources', type: [AdoptionSourceResponseDto] })
    @Header('Cache-Control', 'public, max-age=604800')
    async getAdoptionSources(): Promise<AdoptionSourceResponseDto[]> {
        const sources = await this.catalogsFinder.findAllAdoptionSources();
        return sources.map(s => ({ id: s.id, name: s.name }));
    }
}
