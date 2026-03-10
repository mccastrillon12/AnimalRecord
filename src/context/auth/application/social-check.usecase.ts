import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from '../../user/domain/userRepository';
import { IPasswordHasher } from '../../shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../shared/domain/ITokenGenerator';
import { User, UserPrimitiveType } from '../../user/domain/user';
import { UserAuthMethodEnum } from '../../user/domain/userAuthMethod';
import { GoogleAuthProvider } from '../infrastructure/providers/google-auth.provider';
import { MicrosoftAuthProvider } from '../infrastructure/providers/microsoft-auth.provider';
import { AppleAuthProvider } from '../infrastructure/providers/apple-auth.provider';

@Injectable()
export class SocialCheckUseCase {
    constructor(
        @Inject('UserRepository') private readonly userRepository: UserRepository,
        @Inject('ITokenGenerator') private readonly tokenGenerator: ITokenGenerator,
        @Inject('IPasswordHasher') private readonly passwordHasher: IPasswordHasher,
        private readonly googleAuthProvider: GoogleAuthProvider,
        private readonly microsoftAuthProvider: MicrosoftAuthProvider,
        private readonly appleAuthProvider: AppleAuthProvider
    ) { }

    async run(provider: string, token: string): Promise<any> {
        let profile;

        // 1. Verify Token with Provider
        if (provider === UserAuthMethodEnum.GOOGLE) {
            profile = await this.googleAuthProvider.verify(token);
        } else if (provider === UserAuthMethodEnum.MICROSOFT) {
            profile = await this.microsoftAuthProvider.verify(token);
        } else if (provider === UserAuthMethodEnum.APPLE) {
            profile = await this.appleAuthProvider.verify(token);
        } else {
            throw new UnauthorizedException(`Provider ${provider} not supported`);
        }

        // 2. Find User by Email
        let user = await this.userRepository.findByEmail(profile.email);

        if (user) {
            // 3. User exists: Link Account if needed
            let updated = false;

            if (provider === UserAuthMethodEnum.GOOGLE && !user.googleId) {
                user.googleId = profile.id;
                updated = true;
            } else if (provider === UserAuthMethodEnum.MICROSOFT && !user.microsoftId) {
                user.microsoftId = profile.id;
                updated = true;
            } else if (provider === UserAuthMethodEnum.APPLE && !user.appleId) {
                user.appleId = profile.id;
                updated = true;
            }

            if (updated) {
                await this.userRepository.update(user);
            }

            // 4. Login (Generate Tokens)
            const payload = { sub: user.id.value, email: user.email?.value };
            const accessToken = this.tokenGenerator.generate(payload);
            const refreshToken = this.tokenGenerator.generateRefresh(payload);

            // Save Refresh Token
            const hashedRefreshToken = await this.passwordHasher.hash(refreshToken);
            user.refreshToken = hashedRefreshToken;
            await this.userRepository.update(user);

            return {
                status: 'LOGIN_SUCCESS',
                accessToken,
                refreshToken,
                user: user.toPrimitives()
            };
        } else {
            // 5. User does not exist: Return Pre-Auth Token
            const preAuthPayload = {
                email: profile.email,
                firstName: profile.firstName,
                lastName: profile.lastName,
                googleId: provider === UserAuthMethodEnum.GOOGLE ? profile.id : undefined,
                microsoftId: provider === UserAuthMethodEnum.MICROSOFT ? profile.id : undefined,
                appleId: provider === UserAuthMethodEnum.APPLE ? profile.id : undefined,
                authMethod: provider
            };

            const preAuthToken = this.tokenGenerator.generatePreAuth(preAuthPayload);

            return {
                status: 'NEED_REGISTER',
                preAuthToken,
                profile: {
                    email: profile.email,
                    firstName: profile.firstName,
                    lastName: profile.lastName
                }
            };
        }
    }
}
