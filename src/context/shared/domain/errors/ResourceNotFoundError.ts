import { DomainError } from '../DomainError';

export class ResourceNotFoundError extends DomainError {
    constructor(message: string) {
        super(message);
    }
}
