import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal } from '../../domain/animal';
import { Uuid } from '../../../shared/domain/value-object/Uuid';

@Injectable()
export class AnimalFinderByOwner {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository
    ) { }

    async run(ownerId: string): Promise<Animal[]> {
        return await this.animalRepository.findByOwner(new Uuid(ownerId));
    }
}
