import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal } from '../../domain/animal';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class AnimalUpdater {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository
    ) { }

    async run(id: string, data: Partial<any>): Promise<boolean> {
        const animal = await this.animalRepository.findById(new Uuid(id));
        if (!animal) {
            throw new ResourceNotFoundError(`Animal with id ${id} not found`);
        }

        // Merge logic or creating new animal from merged primitives
        // For simplicity creating a merged primitive object
        const currentPrimitives = animal.toPrimitives();
        const updatedPrimitives = { ...currentPrimitives, ...data, id: id };

        const updatedAnimal = Animal.fromPrimitives(updatedPrimitives);
        return await this.animalRepository.update(updatedAnimal);
    }
}
