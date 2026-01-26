import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../shared/domain/ITokenGenerator';
import { User, UserPrimitiveType } from '../../user/domain/user';
import { UserAuthMethodEnum } from '../../user/domain/userAuthMethod';
import { GoogleAuthProvider } from '../infrastructure/providers/google-auth.provider';
import { Uuid } from '../../shared/domain/value-object/Uuid';

@Injectable()
export class SocialLoginUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('ITokenGenerator') private readonly tokenGenerator: ITokenGenerator,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        private readonly googleAuthProvider: GoogleAuthProvider
    ) { }

    async run(provider: string, token: string): Promise<{ accessToken: string; refreshToken: string; user: UserPrimitiveType }> {
        let profile;

        // 1. Verify Token with Provider
        if (provider === UserAuthMethodEnum.GOOGLE) {
            profile = await this.googleAuthProvider.verify(token);
        } else {
            throw new UnauthorizedException(`Provider ${provider} not supported`);
        }

        // 2. Find User by Email
        let user = await this.userRepository.findByEmail(profile.email);

        if (!user) {
            // 3. Register New User
            user = User.fromPrimitives({
                id: Uuid.random().value,
                name: `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'User',
                email: profile.email,
                authMethod: provider,
                isVerified: true,
                roles: ['USER'],
                // Defaults for required fields that social login doesn't provide
                identificationType: 'CC',
                identificationNumber: `SOCIAL_${profile.id.substring(0, 8)}`, // Temporary placeholder to satisfy Unique constraint
                country: 'Colombia',
                city: 'Bogotá',
                professionalCard: '',
                animalTypes: [],
                services: [],
                isHomeDelivery: false,
                googleId: provider === UserAuthMethodEnum.GOOGLE ? profile.id : undefined,
                appleId: undefined, // Type narrowing makes provider===APPLE impossible here
            });

            await this.userRepository.insert(user);
        } else {
            // 4. Link Account
            let updated = false;
            if (provider === UserAuthMethodEnum.GOOGLE && !user.googleId) {
                user.googleId = profile.id;
                updated = true;
            }
            if (updated) {
                await this.userRepository.update(user);
            }
        }

        // 5. Generate Tokens
        const payload = { sub: user.id.value, email: user.email?.value };
        const accessToken = this.tokenGenerator.generate(payload);
        const refreshToken = this.tokenGenerator.generateRefresh(payload);

        // 6. Save Refresh Token
        const hashedRefreshToken = await this.passwordHasher.hash(refreshToken);
        user.refreshToken = hashedRefreshToken;
        await this.userRepository.update(user);

        return { accessToken, refreshToken, user: user.toPrimitives() };
    }
}
