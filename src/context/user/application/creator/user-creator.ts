import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '../../domain/userRepository';
import { User, UserPrimitiveType } from '../../domain/user';
import { IPasswordHasher } from '../../../shared/domain/IPasswordHasher';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';


@Injectable()
export class UserCreator {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
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

        const userDataWithVerification: UserPrimitiveType = {
            ...data,
            isVerified: false,
            verificationCode: undefined,
            verificationCodeExpiration: undefined
        };

        const user = User.fromPrimitives(userDataWithVerification);
        const savedUser = await this.userRepository.insert(user);

        if (data.email) {
            // Logic moved to delayed verification flow (Login)
        }

        return savedUser;
    }
}
