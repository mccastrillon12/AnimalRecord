import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ISocialAuthProvider, SocialProfile } from '../../domain/ISocialAuthProvider';

@Injectable()
export class MicrosoftAuthProvider implements ISocialAuthProvider {
    async verify(token: string): Promise<SocialProfile> {
        try {
            const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to verify token with Microsoft Graph');
            }

            const payload = await response.json();

            if (!payload.id || (!payload.mail && !payload.userPrincipalName)) {
                throw new UnauthorizedException('Invalid Microsoft Token payload');
            }

            return {
                id: payload.id,
                email: payload.mail || payload.userPrincipalName, // prefer mail, fallback to upn
                firstName: payload.givenName,
                lastName: payload.surname
            };
        } catch (error) {
            console.error('Microsoft Token Verification Failed:', error);
            throw new UnauthorizedException('Invalid Microsoft Token');
        }
    }
}
