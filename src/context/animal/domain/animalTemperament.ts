import { ValueObject } from "../../shared/domain/value-object/ValueObject";

export class AnimalTemperament extends ValueObject<string[]> {
    constructor(value: string[]) {
        super(value);
    }
}
