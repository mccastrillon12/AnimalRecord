export interface SocialProfile {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
}

export interface ISocialAuthProvider {
    verify(token: string): Promise<SocialProfile>;
}
