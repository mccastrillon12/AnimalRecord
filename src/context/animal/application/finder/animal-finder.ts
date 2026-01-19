import { Injectable, Inject } from '@nestjs/common';
import { AnimalRepository } from '../../domain/animalRepository';
import { Animal } from '../../domain/animal';
import { Uuid } from '../../../shared/domain/value-object/Uuid';
import { Nullable } from '../../../shared/domain/Nullable';

@Injectable()
export class AnimalFinder {
    constructor(
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository
    ) { }

    async run(id: string): Promise<Nullable<Animal>> {
        return await this.animalRepository.findById(new Uuid(id));
    }
}
