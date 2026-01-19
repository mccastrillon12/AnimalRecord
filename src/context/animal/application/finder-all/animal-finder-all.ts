import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal } from '../../domain/animal';

@Injectable()
export class AnimalFinderAll {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository
    ) { }

    async run(): Promise<Animal[]> {
        return await this.animalRepository.findAll();
    }
}
