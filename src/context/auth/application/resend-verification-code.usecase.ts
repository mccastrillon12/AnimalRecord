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

        const authMethod = user.authMethod.value;
        if (authMethod === 'EMAIL') {
            if (user.email?.value !== identifier) {
                throw new InvalidArgumentError('Invalid identifier for this user (expected email)');
            }
        } else if (authMethod === 'PHONE') {
            if (user.cellPhone?.value !== identifier) {
                throw new InvalidArgumentError('Invalid identifier for this user (expected phone)');
            }
        }

        if (user.isVerified.value) {
            throw new InvalidArgumentError('User is already verified');
        }

        const plainCode = Math.floor(10000 + Math.random() * 90000).toString();

        const hashedCode = await this.passwordHasher.hash(plainCode);
        user.verificationCode = new UserVerificationCode(hashedCode);

        const expirationMinutes = this.configService.getVerificationCodeExpirationTime();
        const now = Date.now();
        user.verificationCodeExpiration = new Date(now + expirationMinutes * 60 * 1000);

        await this.userRepository.update(user);

        await this.userCodeSender.run(user, plainCode);
    }
}
