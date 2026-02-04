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
        // Check if identifier is email
        let user = await this.userRepository.findByEmail(identifier);

        if (!user) {
            // Check if identifier is phone
            user = await this.userRepository.findByCellPhone(identifier);
        }

        // 2. If user not found, return silently (Security: allow user enumeration protection)
        // However, for this MVP we might want to log it.
        if (!user) {
            return;
        }

        // 3. Generate 6-digit OTP
        const plainCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 4. Hash OTP
        const hashedCode = await this.passwordHasher.hash(plainCode);
        user.resetPasswordCode = new UserResetPasswordCode(hashedCode);

        // 5. Set Expiration (15 mins)
        // reusing verification code expiration time or defaulting to 15
        const expirationMinutes = this.configService.getVerificationCodeExpirationTime() || 15;
        const now = Date.now();
        user.resetPasswordExpiration = new Date(now + expirationMinutes * 60 * 1000);

        // 6. Save User
        // We use update method. 
        // IMPORTANT: Ensure update method persists the new fields. (Verified in MongoUserRepository)
        await this.userRepository.update(user);

        // 7. Send OTP
        await this.userResetPasswordSender.run(user, plainCode);
    }
}
