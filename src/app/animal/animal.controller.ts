import { Controller, Post, Body, Get, Param, Put, UseGuards, Patch, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiBody } from '@nestjs/swagger';
import { AnimalCreator } from '../../context/animal/application/creator/animal-creator';
import { AnimalFinder } from '../../context/animal/application/finder/animal-finder';
import { AnimalFinderAll } from '../../context/animal/application/finder-all/animal-finder-all';
import { AnimalFinderByOwner } from '../../context/animal/application/finder-by-owner/animal-finder-by-owner';
import { AnimalUpdater } from '../../context/animal/application/updater/animal-updater';
import { AnimalFinderWithFilters } from '../../context/animal/application/finder-with-filters/animal-finder-with-filters';
import { CreateAnimalDto } from './create-animal.dto';
import { UpdateAnimalDto } from './update-animal.dto';
import { JwtAuthGuard } from '../../app/auth/jwt-auth.guard';
import { HttpErrorDto } from '../shared/dto/http-error.dto';
import { AnimalResponseDto } from './animal-response.dto';
import { GenerateAnimalProfilePictureUploadUrlUseCase } from '../../context/animal/application/profile-picture/generate-animal-profile-picture-upload-url.usecase';
import { UpdateAnimalProfilePictureUseCase } from '../../context/animal/application/profile-picture/update-animal-profile-picture.usecase';

@ApiTags('animals')
@Controller('animals')
export class AnimalController {
    constructor(
        private readonly animalCreator: AnimalCreator,
        private readonly animalFinder: AnimalFinder,
        private readonly animalFinderAll: AnimalFinderAll,
        private readonly animalFinderByOwner: AnimalFinderByOwner,
        private readonly animalUpdater: AnimalUpdater,
        private readonly animalFinderWithFilters: AnimalFinderWithFilters,
        private readonly generateAnimalProfilePictureUploadUrlUseCase: GenerateAnimalProfilePictureUploadUrlUseCase,
        private readonly updateAnimalProfilePictureUseCase: UpdateAnimalProfilePictureUseCase
    ) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Create animal' })
    @ApiResponse({ status: 201, description: 'The animal has been successfully created.', type: AnimalResponseDto })
    @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async create(@Body() createAnimalDto: CreateAnimalDto) {
        const animal = await this.animalCreator.run(createAnimalDto);
        return animal.toPrimitives();
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Get all animals' })
    @ApiResponse({ status: 200, description: 'Return all animals.', type: [AnimalResponseDto] })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async findAll() {
        const animals = await this.animalFinderAll.run();
        return animals.map(animal => animal.toPrimitives());
    }

    @Get('search')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Search animals with combined filters (species, sex, age range, date range, owner)' })
    @ApiQuery({ name: 'species', required: false, example: 'Canino', description: 'Filter by species' })
    @ApiQuery({ name: 'sex', required: false, example: 'Hembra', description: 'Filter by sex' })
    @ApiQuery({ name: 'minAgeMonths', required: false, type: Number, description: 'Minimum age in months' })
    @ApiQuery({ name: 'maxAgeMonths', required: false, type: Number, description: 'Maximum age in months' })
    @ApiQuery({ name: 'dateFrom', required: false, example: '2026-01-01T00:00:00.000Z', description: 'Filter by creation date from (ISO)' })
    @ApiQuery({ name: 'dateTo', required: false, example: '2026-12-31T23:59:59.999Z', description: 'Filter by creation date to (ISO)' })
    @ApiQuery({ name: 'ownerId', required: false, description: 'Filter by owner UUID' })
    @ApiResponse({ status: 200, description: 'Return filtered animals.', type: [AnimalResponseDto] })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async search(
        @Query('species') species?: string,
        @Query('sex') sex?: string,
        @Query('minAgeMonths') minAgeMonths?: string,
        @Query('maxAgeMonths') maxAgeMonths?: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
        @Query('ownerId') ownerId?: string
    ) {
        const filters: any = { species, sex, dateFrom, dateTo, ownerId };
        if (minAgeMonths) filters.minAgeMonths = parseInt(minAgeMonths, 10);
        if (maxAgeMonths) filters.maxAgeMonths = parseInt(maxAgeMonths, 10);

        const animals = await this.animalFinderWithFilters.run(filters);
        return animals.map(animal => animal.toPrimitives());
    }

    @Get('owner/:id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Find animals by owner id' })
    @ApiResponse({ status: 200, description: 'Return animals belonging to owner.', type: [AnimalResponseDto] })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'Owner or animals not found.', type: HttpErrorDto })
    async findByOwner(@Param('id') id: string) {
        const animals = await this.animalFinderByOwner.run(id);
        return animals.map(animal => animal.toPrimitives());
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Find animal by id' })
    @ApiResponse({ status: 200, description: 'Return the animal.', type: AnimalResponseDto })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'Animal not found.', type: HttpErrorDto })
    async findOne(@Param('id') id: string) {
        const animal = await this.animalFinder.run(id);
        return animal.toPrimitives();
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Update animal' })
    @ApiResponse({ status: 200, description: 'The animal has been successfully updated.', type: AnimalResponseDto })
    @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'Animal not found.', type: HttpErrorDto })
    async update(@Param('id') id: string, @Body() updateAnimalDto: UpdateAnimalDto) {
        return this.animalUpdater.run(id, updateAnimalDto);
    }

    @Get(':id/profile-picture/upload-url')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Get a pre-signed URL to upload animal profile picture directly to S3' })
    @ApiQuery({ name: 'mimeType', required: true, example: 'image/jpeg' })
    @ApiQuery({ name: 'fileSize', required: true, example: 150000 })
    @ApiResponse({ status: 200, description: 'Return the upload URL and final URL.' })
    @ApiResponse({ status: 400, description: 'File type or size invalid.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'Animal not found.', type: HttpErrorDto })
    async getProfilePictureUploadUrl(
        @Param('id') animalId: string,
        @Query('mimeType') mimeType: string,
        @Query('fileSize') fileSize: string
    ) {
        return this.generateAnimalProfilePictureUploadUrlUseCase.run(animalId, mimeType, Number(fileSize));
    }

    @Patch(':id/profile-picture')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Confirm animal profile picture upload and update URL' })
    @ApiBody({ schema: { type: 'object', properties: { finalUrl: { type: 'string' } } } })
    @ApiResponse({ status: 200, description: 'Profile picture updated successfully.' })
    @ApiResponse({ status: 404, description: 'Animal not found.', type: HttpErrorDto })
    async confirmProfilePictureUpload(
        @Param('id') animalId: string,
        @Body('finalUrl') finalUrl: string
    ) {
        await this.updateAnimalProfilePictureUseCase.run(animalId, finalUrl);
        return { success: true, profilePictureUrl: finalUrl };
    }
}
