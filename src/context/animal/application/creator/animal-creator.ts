import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal, AnimalPrimitiveType } from '../../domain/animal';

@Injectable()
export class AnimalCreator {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository
    ) { }

    async run(data: AnimalPrimitiveType): Promise<Animal> {
        const animal = Animal.fromPrimitives(data);
        return await this.animalRepository.insert(animal);
    }
}
