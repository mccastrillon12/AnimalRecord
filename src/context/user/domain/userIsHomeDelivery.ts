import { ValueObject } from "../../shared/domain/value-object/ValueObject";


export class UserIsHomeDelivery extends ValueObject<boolean> {
    constructor(value: boolean) {
        super(value);
    }
}
