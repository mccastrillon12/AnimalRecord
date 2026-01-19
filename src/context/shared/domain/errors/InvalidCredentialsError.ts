import { DomainError } from '../DomainError';

export class InvalidCredentialsError extends DomainError {
    constructor(message: string) {
        super(message);
    }
}
