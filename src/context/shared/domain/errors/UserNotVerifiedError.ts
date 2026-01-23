import { DomainError } from '../DomainError';

export class UserNotVerifiedError extends DomainError {
    constructor(public readonly timeRemaining?: number) {
        super('User not verified');
    }
}
