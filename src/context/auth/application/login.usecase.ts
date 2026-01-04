import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../shared/domain/ITokenGenerator';

@Injectable()
export class LoginUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        @Inject('ITokenGenerator') private readonly tokenGenerator: ITokenGenerator
    ) { }

    async run(identifier: string, password: string): Promise<{ accessToken: string }> {
        // Try to find by email
        let user = await this.userRepository.findByEmail(identifier);

        // If not found, try to find by cell phone
        if (!user) {
            user = await this.userRepository.findByCellPhone(identifier);
        }

        // If still not found, throw error
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Validate password
        if (!user.password) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await this.passwordHasher.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Generate token
        const payload = { sub: user.id.value, email: user.email.value };
        const accessToken = this.tokenGenerator.generate(payload);

        return { accessToken };
    }
}
