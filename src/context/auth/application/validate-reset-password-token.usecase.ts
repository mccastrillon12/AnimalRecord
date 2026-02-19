import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { InvalidCredentialsError } from '../../shared/domain/errors/InvalidCredentialsError';

@Injectable()
export class ValidateResetPasswordTokenUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher
    ) { }

    async run(identifier: string, token: string): Promise<boolean> {
        // 1. Find User
        let user = await this.userRepository.findByEmail(identifier);
        if (!user) {
            user = await this.userRepository.findByCellPhone(identifier);
        }

        if (!user) {
            throw new InvalidCredentialsError('Invalid request');
        }

        // 2. Check if resetPasswordCode exists
        if (!user.resetPasswordCode || !user.resetPasswordExpiration) {
            throw new InvalidCredentialsError('Invalid request'); // No reset requested
        }

        // 3. Check expiration
        const now = new Date();
        if (user.resetPasswordExpiration < now) {
            throw new BadRequestException('Reset token expired');
        }

        // 4. Verify Token
        const isCodeValid = await this.passwordHasher.compare(token, user.resetPasswordCode.value);
        if (!isCodeValid) {
            throw new InvalidCredentialsError('Invalid token');
        }

        return true;
    }
}
