import { DomainError } from '../DomainError';

export class UserNotVerifiedError extends DomainError {
    constructor() {
        super('User not verified');
    }
}
