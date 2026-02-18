export interface IEmailSender {
    sendVerificationCode(email: string, code: string): Promise<void>;
    sendPasswordResetLink(email: string, link: string): Promise<void>;
    sendPinResetLink(email: string, link: string): Promise<void>;
}
