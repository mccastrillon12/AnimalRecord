import { StringValueObject } from "../../shared/domain/value-object/StringValueObject";
import { InvalidArgumentError } from "../../shared/domain/errors/InvalidArgumentError";

export enum UserAuthMethodEnum {
    EMAIL = 'EMAIL',
    PHONE = 'PHONE'
}

export class UserAuthMethod extends StringValueObject {
    constructor(value: string) {
        super(value);
        this.ensureIsValidAuthMethod(value);
    }

    private ensureIsValidAuthMethod(value: string): void {
        if (!Object.values(UserAuthMethodEnum).includes(value as UserAuthMethodEnum)) {
            throw new InvalidArgumentError(`<${value}> is not a valid auth method`);
        }
    }
}
