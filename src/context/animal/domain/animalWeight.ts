import { ValueObject } from "../../shared/domain/value-object/ValueObject";

export class AnimalWeight extends ValueObject<number> {
    constructor(value: number) {
        super(value);
    }
}
