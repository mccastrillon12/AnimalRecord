import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal } from '../../domain/animal';
import { AnimalFilters } from '../../domain/animalFilters';

@Injectable()
export class AnimalFinderWithFilters {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository
    ) { }

    async run(filters: AnimalFilters): Promise<Animal[]> {
        return await this.animalRepository.findWithFilters(filters);
    }
}
