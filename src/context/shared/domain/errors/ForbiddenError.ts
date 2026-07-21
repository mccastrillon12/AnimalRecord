import { DomainError } from '../DomainError';

export class ForbiddenError extends DomainError {
    constructor(message: string) {
        super(message);
    }
}
