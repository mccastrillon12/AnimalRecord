import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../shared/domain/ITokenGenerator';
import { InvalidCredentialsError } from '../../shared/domain/errors/InvalidCredentialsError';
import { UserNotVerifiedError } from '../../shared/domain/errors/UserNotVerifiedError';
import { UserCodeSender } from '../../user/application/sender/user-code-sender';
import { EnvironmentConfigService } from '../../shared/infrastructure/config/environment/environment.service';
import { UserVerificationCode } from '../../user/domain/userVerificationCode';

@Injectable()
export class LoginUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        @Inject('ITokenGenerator') private readonly tokenGenerator: ITokenGenerator,
        private readonly userCodeSender: UserCodeSender,
        private readonly configService: EnvironmentConfigService
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
                throw new InvalidCredentialsError('Invalid credentials (must login with email)');
            }
        } else if (authMethod === 'PHONE') {
            if (user.cellPhone?.value !== identifier) {
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

        // Check Verification Status
        if (!user.isVerified.value) {
            // Generate NEW Verification Code
            const plainCode = Math.floor(10000 + Math.random() * 90000).toString();

            // Hash code
            const hashedCode = await this.passwordHasher.hash(plainCode);
            user.verificationCode = new UserVerificationCode(hashedCode);

            // Set Expiration
            const expirationMinutes = this.configService.getVerificationCodeExpirationTime();
            user.verificationCodeExpiration = new Date(Date.now() + expirationMinutes * 60 * 1000);

            // Save User
            await this.userRepository.update(user);

            // Send Code
            await this.userCodeSender.run(user, plainCode);

            throw new UserNotVerifiedError();
        }

        // Generate tokens
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
