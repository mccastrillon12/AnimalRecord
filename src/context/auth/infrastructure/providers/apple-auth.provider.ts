import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as appleSignin from 'apple-signin-auth';
import { ISocialAuthProvider, SocialProfile } from '../../domain/ISocialAuthProvider';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';

@Injectable()
export class AppleAuthProvider implements ISocialAuthProvider {
    constructor(private readonly configService: EnvironmentConfigService) { }

    async verify(token: string): Promise<SocialProfile> {
        try {
            const audience = this.configService.getAppleClientId();

            // Verify token. If audience is configured, we validate it matches.
            const verifyOptions = audience ? { audience } : {};

            const payload = await appleSignin.verifyIdToken(token, verifyOptions);

            if (!payload || !payload.email) {
                throw new UnauthorizedException('Invalid Apple Token payload or missing email');
            }

            return {
                id: payload.sub,
                email: payload.email,
                // Note: Apple only returns the user's name on the first login via a separate JSON, NOT in the JWT payload.
                // Mobile app will send names separately during SocialRegister if needed.
            };
        } catch (error) {
            console.error('Apple Token Verification Failed:', error);
            throw new UnauthorizedException('Invalid Apple Token');
        }
    }
}
