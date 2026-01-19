import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal } from '../../domain/animal';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class AnimalFinder {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository
    ) { }

    async run(id: string): Promise<Animal> {
        const animal = await this.animalRepository.findById(new Uuid(id));
        if (!animal) {
            throw new ResourceNotFoundError(`Animal with id ${id} not found`);
        }
        return animal;
    }
}
