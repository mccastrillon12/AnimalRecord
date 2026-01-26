import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { ISocialAuthProvider, SocialProfile } from '../../domain/ISocialAuthProvider';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';

@Injectable()
export class GoogleAuthProvider implements ISocialAuthProvider {
    private client: OAuth2Client;

    constructor(private readonly configService: EnvironmentConfigService) {
        // Initialize with Client ID if available, or just empty for now and pass it during verify
        // Ideally, we pass the Client ID to the constructor or verify method
        this.client = new OAuth2Client(this.configService.getGoogleClientId());
    }

    async verify(token: string): Promise<SocialProfile> {
        try {
            const ticket = await this.client.verifyIdToken({
                idToken: token,
                audience: this.configService.getGoogleClientId(),
            });

            const payload = ticket.getPayload();

            if (!payload || !payload.email) {
                throw new UnauthorizedException('Invalid Google Token payload');
            }

            return {
                id: payload.sub,
                email: payload.email,
                firstName: payload.given_name,
                lastName: payload.family_name
            };
        } catch (error) {
            console.error('Google Token Verification Failed:', error);
            throw new UnauthorizedException('Invalid Google Token');
        }
    }
}
