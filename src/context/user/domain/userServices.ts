import { ValueObject } from "../../shared/domain/value-object/ValueObject";

export class UserServices extends ValueObject<string[]> {
    constructor(value: string[]) {
        super(value);
        this.ensureValueIsDefined(value);
    }

    equals(other: UserServices): boolean {
        return (
            other.constructor.name === this.constructor.name &&
            this.value.length === other.value.length &&
            this.value.every((val, index) => val === other.value[index])
        );
    }
}
