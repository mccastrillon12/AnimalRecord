import { StringValueObject } from '../../shared/domain/value-object/StringValueObject';

export class UserVerificationCode extends StringValueObject {
    constructor(value: string) {
        super(value);
    }
}
