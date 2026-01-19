import { StringValueObject } from "../../shared/domain/value-object/StringValueObject";

export class AnimalCode extends StringValueObject {
    constructor(value: string) {
        super(value);
    }
}
