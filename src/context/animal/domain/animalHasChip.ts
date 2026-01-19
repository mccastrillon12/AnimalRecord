import { ValueObject } from "../../shared/domain/value-object/ValueObject";

export class AnimalHasChip extends ValueObject<boolean> {
    constructor(value: boolean) {
        super(value);
    }
}
