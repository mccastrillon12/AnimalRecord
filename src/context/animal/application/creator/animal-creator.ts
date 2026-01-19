import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal, AnimalPrimitiveType } from '../../domain/animal';
import { AnimalCodeGenerator } from '../generators/animal-code-generator';

@Injectable()
export class AnimalCreator {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository,
        private readonly codeGenerator: AnimalCodeGenerator
    ) { }

    async run(data: Omit<AnimalPrimitiveType, 'code'>): Promise<Animal> {
        const code = await this.codeGenerator.generate(data.species);
        const animalData: AnimalPrimitiveType = {
            ...data,
            code: code
        };
        const animal = Animal.fromPrimitives(animalData);
        return await this.animalRepository.insert(animal);
    }
}
