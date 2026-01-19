import { DomainError } from '../DomainError';

export class InvalidArgumentError extends DomainError {
    constructor(message: string) {
        super(message);
    }
}
