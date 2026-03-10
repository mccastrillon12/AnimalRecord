import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { IPasswordHasher } from '../../../shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../../shared/domain/ITokenGenerator';
import { ResourceNotFoundError } from '../../../shared/domain/errors/ResourceNotFoundError';
import { InvalidCredentialsError } from '../../../shared/domain/errors/InvalidCredentialsError';
import { UserIsVerified } from '../../domain/userIsVerified';

@Injectable()
export class VerifyUserUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        @Inject('ITokenGenerator') private readonly tokenGenerator: ITokenGenerator
    ) { }

    async run(identifier: string, code: string): Promise<{ accessToken: string; refreshToken: string }> {
        // Try to find user by email first
        let user = await this.userRepository.findByEmail(identifier);

        // If not found by email, try by phone
        if (!user) {
            user = await this.userRepository.findByCellPhone(identifier);
        }

        if (!user) {
            throw new ResourceNotFoundError(`User with identifier ${identifier} not found`);
        }

        if (user.isVerified.value) {
            throw new BadRequestException('User already verified');
        }

        if (!user.verificationCode || !user.verificationCodeExpiration) {
            throw new BadRequestException('No verification code found');
        }

        if (user.verificationCodeExpiration < new Date()) {
            throw new BadRequestException('Verification code expired');
        }

        const isCodeValid = await this.passwordHasher.compare(code, user.verificationCode.value);
        if (!isCodeValid) {
            throw new InvalidCredentialsError('Invalid verification code');
        }

        // Verify user
        user.isVerified = new UserIsVerified(true);
        user.verificationCode = undefined;
        user.verificationCodeExpiration = undefined;

        // Generate tokens using either email or cell phone as available
        const payload = { sub: user.id.value, email: user.email?.value };
        const accessToken = this.tokenGenerator.generate(payload);
        const refreshToken = this.tokenGenerator.generateRefresh(payload);

        const hashedRefreshToken = await this.passwordHasher.hash(refreshToken);
        user.refreshToken = hashedRefreshToken;

        await this.userRepository.update(user);

        return { accessToken, refreshToken };
    }
}
