import { Controller, Post, Body, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AnimalCreator } from '../../context/animal/application/creator/animal-creator';
import { AnimalFinder } from '../../context/animal/application/finder/animal-finder';
import { AnimalFinderAll } from '../../context/animal/application/finder-all/animal-finder-all';
import { AnimalFinderByOwner } from '../../context/animal/application/finder-by-owner/animal-finder-by-owner';
import { AnimalUpdater } from '../../context/animal/application/updater/animal-updater';
import { CreateAnimalDto } from './create-animal.dto';
import { UpdateAnimalDto } from './update-animal.dto';
import { JwtAuthGuard } from '../../app/auth/jwt-auth.guard';
import { HttpErrorDto } from '../shared/dto/http-error.dto';

@ApiTags('animals')
@Controller('animals')
export class AnimalController {
    constructor(
        private readonly animalCreator: AnimalCreator,
        private readonly animalFinder: AnimalFinder,
        private readonly animalFinderAll: AnimalFinderAll,
        private readonly animalFinderByOwner: AnimalFinderByOwner,
        private readonly animalUpdater: AnimalUpdater
    ) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create animal' })
    @ApiResponse({ status: 201, description: 'The animal has been successfully created.' })
    @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async create(@Body() createAnimalDto: CreateAnimalDto) {
        const animal = await this.animalCreator.run(createAnimalDto);
        return animal.toPrimitives();
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get all animals' })
    @ApiResponse({ status: 200, description: 'Return all animals.' })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async findAll() {
        const animals = await this.animalFinderAll.run();
        return animals.map(animal => animal.toPrimitives());
    }

    @Get('owner/:id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Find animals by owner id' })
    @ApiResponse({ status: 200, description: 'Return animals belonging to owner.' })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'Owner or animals not found.', type: HttpErrorDto })
    async findByOwner(@Param('id') id: string) {
        const animals = await this.animalFinderByOwner.run(id);
        return animals.map(animal => animal.toPrimitives());
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Find animal by id' })
    @ApiResponse({ status: 200, description: 'Return the animal.' })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'Animal not found.', type: HttpErrorDto })
    async findOne(@Param('id') id: string) {
        const animal = await this.animalFinder.run(id);
        return animal.toPrimitives();
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update animal' })
    @ApiResponse({ status: 200, description: 'The animal has been successfully updated.' })
    @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'Animal not found.', type: HttpErrorDto })
    async update(@Param('id') id: string, @Body() updateAnimalDto: UpdateAnimalDto) {
        return this.animalUpdater.run(id, updateAnimalDto);
    }
}

