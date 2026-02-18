import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { InvalidCredentialsError } from '../../shared/domain/errors/InvalidCredentialsError';

@Injectable()
export class ResetPinUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher
    ) { }

    async run(identifier: string, token: string, newPin: string): Promise<void> {
        // 1. Find User
        let user = await this.userRepository.findByEmail(identifier);
        if (!user) {
            user = await this.userRepository.findByCellPhone(identifier);
        }

        if (!user) {
            throw new InvalidCredentialsError('Invalid request');
        }

        // 2. Check if resetPinCode exists
        if (!user.resetPinCode || !user.resetPinExpiration) {
            throw new InvalidCredentialsError('Invalid request');
        }

        // 3. Check expiration
        const now = new Date();
        if (user.resetPinExpiration < now) {
            throw new BadRequestException('Reset link expired');
        }

        // 4. Verify Token
        const isTokenValid = await this.passwordHasher.compare(token, user.resetPinCode);
        if (!isTokenValid) {
            throw new InvalidCredentialsError('Invalid link/token');
        }

        // 5. Hash New PIN
        const hashedPin = await this.passwordHasher.hash(newPin);
        user.pin = hashedPin;

        // 6. Clear Reset Fields
        user.resetPinCode = undefined;
        user.resetPinExpiration = undefined;

        // 7. Save
        await this.userRepository.update(user);
    }
}
