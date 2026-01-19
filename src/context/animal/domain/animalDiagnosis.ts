import { ValueObject } from "../../shared/domain/value-object/ValueObject";

export class AnimalDiagnosis extends ValueObject<string[]> {
    constructor(value: string[]) {
        super(value);
    }
}
