import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User, UserPrimitiveType } from '../../domain/user';
import { IPasswordHasher } from '../../../shared/domain/IPasswordHasher';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';
import { IEmailSender } from '../../domain/ports/IEmailSender';
import { ISmsSender } from '../../domain/ports/ISmsSender';

@Injectable()
export class UserCreator {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
        @Inject('ISmsSender') private readonly smsSender: ISmsSender,
        private readonly configService: EnvironmentConfigService
    ) { }

    async run(data: Omit<UserPrimitiveType, 'isVerified' | 'verificationCode' | 'verificationCodeExpiration'>): Promise<User> {
        if (data.email) {
            const userWithEmail = await this.userRepository.findByEmail(data.email);
            if (userWithEmail) {
                throw new ConflictError(`User with email ${data.email} already exists`);
            }
        }

        if (data.cellPhone) {
            const userWithPhone = await this.userRepository.findByCellPhone(data.cellPhone);
            if (userWithPhone) {
                throw new ConflictError(`User with cell phone ${data.cellPhone} already exists`);
            }
        }

        if (data.password) {
            data.password = await this.passwordHasher.hash(data.password);
        }

        // Generate Verification Code (5 digits: 10000 - 99999)
        const verificationCode = Math.floor(10000 + Math.random() * 90000).toString();

        const expirationMinutes = this.configService.getVerificationCodeExpirationTime();
        const verificationCodeExpiration = new Date(Date.now() + expirationMinutes * 60 * 1000);

        // Hash code for security
        const hashedCode = await this.passwordHasher.hash(verificationCode);

        const userDataWithVerification: UserPrimitiveType = {
            ...data,
            isVerified: false,
            verificationCode: hashedCode,
            verificationCodeExpiration: verificationCodeExpiration
        };

        const user = User.fromPrimitives(userDataWithVerification);
        const savedUser = await this.userRepository.insert(user);

        if (data.email) {
            try {
                // Send PLAIN code to user via Email
                await this.emailSender.sendVerificationCode(data.email, verificationCode);
            } catch (error) {
                console.error('Error sending email:', error);
            }
        }

        if (data.cellPhone) {
            try {
                // Send SMS
                await this.smsSender.send(data.cellPhone, `Verification Code: ${verificationCode}`);
            } catch (error) {
                console.error('Error sending SMS:', error);
            }
        }

        return savedUser;
    }
}
