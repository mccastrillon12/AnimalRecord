import { ValueObject } from "../../shared/domain/value-object/ValueObject";

export class AnimalIsAssociationMember extends ValueObject<boolean> {
    constructor(value: boolean) {
        super(value);
    }
}
