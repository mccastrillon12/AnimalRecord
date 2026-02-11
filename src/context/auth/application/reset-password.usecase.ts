import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { InvalidCredentialsError } from '../../shared/domain/errors/InvalidCredentialsError';

@Injectable()
export class ResetPasswordUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher
    ) { }

    async run(identifier: string, code: string, newPassword: string): Promise<void> {
        // 1. Find User
        let user = await this.userRepository.findByEmail(identifier);
        if (!user) {
            user = await this.userRepository.findByCellPhone(identifier);
        }

        if (!user) {
            // Ambiguous error for security
            throw new InvalidCredentialsError('Invalid request');
        }

        // 2. Check if resetPasswordCode exists
        if (!user.resetPasswordCode || !user.resetPasswordExpiration) {
            throw new InvalidCredentialsError('Invalid request'); // No reset requested
        }

        // 3. Check expiration
        const now = new Date();
        if (user.resetPasswordExpiration < now) {
            throw new BadRequestException('Reset code expired');
        }

        // 4. Verify Code
        const isCodeValid = await this.passwordHasher.compare(code, user.resetPasswordCode.value);
        if (!isCodeValid) {
            throw new InvalidCredentialsError('Invalid code');
        }

        // 5. Hash New Password
        const hashedPassword = await this.passwordHasher.hash(newPassword);
        user.password = hashedPassword;

        // 6. Clear Reset Fields
        user.resetPasswordCode = undefined;
        user.resetPasswordExpiration = undefined;

        // 7. Save
        await this.userRepository.update(user);
    }
}
