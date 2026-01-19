import { Injectable } from '@nestjs/common';
import { MongoCounterRepository } from '../../../shared/infrastructure/persistence/mongo/mongo-counter-repository';
import { AnimalSpeciesEnum } from '../../domain/animalSpecies';

@Injectable()
export class AnimalCodeGenerator {
    constructor(
        private readonly counterRepository: MongoCounterRepository
    ) { }

    async generate(species: string): Promise<string> {
        let prefix = 'X';
        switch (species) {
            case AnimalSpeciesEnum.DOG:
                prefix = 'C';
                break;
            case AnimalSpeciesEnum.CAT:
                prefix = 'F';
                break;
            case AnimalSpeciesEnum.BOVINE:
                prefix = 'B';
                break;
            default:
                throw new Error(`Unsupported species for code generation: ${species}`);
        }

        const seq = await this.counterRepository.getNextSequence(`animal_code_${prefix}`);
        const formattedSeq = seq.toString().padStart(3, '0');
        return `AR-${prefix}${formattedSeq}`;
    }
}
