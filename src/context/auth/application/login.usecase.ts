import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../shared/domain/ITokenGenerator';
import { InvalidCredentialsError } from '../../shared/domain/errors/InvalidCredentialsError';

@Injectable()
export class LoginUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        @Inject('ITokenGenerator') private readonly tokenGenerator: ITokenGenerator
    ) { }

    async run(identifier: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
        // Try to find by email
        let user = await this.userRepository.findByEmail(identifier);

        // If not found, try to find by cell phone
        if (!user) {
            user = await this.userRepository.findByCellPhone(identifier);
        }

        // If still not found, throw error
        if (!user) {
            throw new InvalidCredentialsError('Invalid credentials');
        }

        // START: Enforce Auth Method Restriction
        const authMethod = user.authMethod.value;
        if (authMethod === 'EMAIL') {
            if (user.email?.value !== identifier) {
                // User found by phone, but auth method is EMAIL -> Deny
                throw new InvalidCredentialsError('Invalid credentials (must login with email)');
            }
        } else if (authMethod === 'PHONE') {
            if (user.cellPhone?.value !== identifier) {
                // User found by email, but auth method is PHONE -> Deny
                throw new InvalidCredentialsError('Invalid credentials (must login with phone)');
            }
        }
        // END: Enforce Auth Method Restriction

        // Validate password
        if (!user.password) {
            throw new InvalidCredentialsError('Invalid credentials');
        }

        const isPasswordValid = await this.passwordHasher.compare(password, user.password);
        if (!isPasswordValid) {
            throw new InvalidCredentialsError('Invalid credentials');
        }

        // Generate tokens
        // Payload should probably include the role? Added simplified payload.
        const payload = { sub: user.id.value, email: user.email?.value };
        const accessToken = this.tokenGenerator.generate(payload);
        const refreshToken = this.tokenGenerator.generateRefresh(payload);

        // Hash refresh token and save
        const hashedRefreshToken = await this.passwordHasher.hash(refreshToken);
        user.refreshToken = hashedRefreshToken;
        await this.userRepository.update(user);

        return { accessToken, refreshToken };
    }
}
