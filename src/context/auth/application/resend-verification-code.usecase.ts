import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { UserCodeSender } from '../../user/application/sender/user-code-sender';
import { EnvironmentConfigService } from '../../shared/infrastructure/config/environment/environment.service';
import { UserVerificationCode } from '../../user/domain/userVerificationCode';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';

@Injectable()
export class ResendVerificationCodeUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        private readonly userCodeSender: UserCodeSender,
        private readonly configService: EnvironmentConfigService
    ) { }

    async run(identifier: string): Promise<void> {
        // Try to find by email
        let user = await this.userRepository.findByEmail(identifier);

        if (!user) {
            user = await this.userRepository.findByCellPhone(identifier);
        }

        if (!user) {
            // Avoid leaking user existence? For now, standard 404 behavior as per plan
            throw new ResourceNotFoundError('User not found');
        }

        // START: Enforce Auth Method Restriction
        const authMethod = user.authMethod.value;
        if (authMethod === 'EMAIL') {
            if (user.email?.value !== identifier) {
                // User found, but auth method is EMAIL, so identifier must match email
                // This handles edge case where user is found by phone but auth method is EMAIL (shouldn't happen with unique check but good for safety)
                // Actually, more likely: user passed phone, found by phone, but auth method is EMAIL.
                throw new InvalidArgumentError('Invalid identifier for this user (expected email)');
            }
        } else if (authMethod === 'PHONE') {
            if (user.cellPhone?.value !== identifier) {
                throw new InvalidArgumentError('Invalid identifier for this user (expected phone)');
            }
        }
        // END: Enforce Auth Method Restriction

        if (user.isVerified.value) {
            throw new InvalidArgumentError('User is already verified');
        }

        // FORCE Generate NEW Verification Code
        const plainCode = Math.floor(10000 + Math.random() * 90000).toString();

        // Hash code
        const hashedCode = await this.passwordHasher.hash(plainCode);
        user.verificationCode = new UserVerificationCode(hashedCode);

        // Set Expiration
        const expirationMinutes = this.configService.getVerificationCodeExpirationTime();
        const now = Date.now();
        user.verificationCodeExpiration = new Date(now + expirationMinutes * 60 * 1000);

        // Save User
        await this.userRepository.update(user);

        // Send Code
        await this.userCodeSender.run(user, plainCode);
    }
}
