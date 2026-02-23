import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { UserResetPasswordSender } from '../../user/application/sender/user-reset-password-sender';
import { EnvironmentConfigService } from '../../shared/infrastructure/config/environment/environment.service';
import { UserResetPasswordCode } from '../../user/domain/userResetPasswordCode';

@Injectable()
export class RequestPasswordResetUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        private readonly userResetPasswordSender: UserResetPasswordSender,
        private readonly configService: EnvironmentConfigService
    ) { }

    async run(identifier: string): Promise<void> {
        // 1. Find user by Email or Phone (identifier)
        let user = await this.userRepository.findByEmail(identifier);

        if (!user) {
            user = await this.userRepository.findByCellPhone(identifier);
        }

        // 2. If user not found, return silently
        if (!user) {
            return;
        }

        // 3. Generate Token (UUID) instead of 6-digit OTP
        // Assuming Uuid.random().value gives a string UUID
        const plainToken = Buffer.from(Math.random().toString(36).substring(2) + Date.now().toString(36)).toString('base64').replace(/[^a-zA-Z0-9]/g, '');

        // 4. Hash Token
        const hashedToken = await this.passwordHasher.hash(plainToken);
        user.resetPasswordCode = new UserResetPasswordCode(hashedToken);

        // 5. Set Expiration (15 mins)
        const expirationMinutes = this.configService.getVerificationCodeExpirationTime() || 15;
        const now = Date.now();
        user.resetPasswordExpiration = new Date(now + expirationMinutes * 60 * 1000);

        // 6. Save User
        await this.userRepository.update(user);

        // 7. Construct Link
        // Using FRONTEND_URL from env or defaulting to example
        const frontendUrl = process.env.FRONTEND_URL || 'https://animalrecord.com';
        const link = `${frontendUrl}/reset-password?token=${plainToken}&identifier=${identifier}&type=password`;

        // 8. Send Link
        await this.userResetPasswordSender.run(user, link);
    }
}
