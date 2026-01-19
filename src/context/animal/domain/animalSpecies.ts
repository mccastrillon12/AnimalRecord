import { StringValueObject } from "../../shared/domain/value-object/StringValueObject";

export enum AnimalSpeciesEnum {
    DOG = 'PERRO',
    CAT = 'GATO',
    BOVINE = 'BOVINO'
}

export class AnimalSpecies extends StringValueObject {
    constructor(value: string) {
        super(value);
        this.ensureIsValidSpecies(value);
    }

    private ensureIsValidSpecies(value: string): void {
        const validSpecies = Object.values(AnimalSpeciesEnum);
        if (!validSpecies.includes(value as AnimalSpeciesEnum)) {
            throw new Error(`Invalid species: ${value}. Allowed values: ${validSpecies.join(', ')}`);
        }
    }
}
