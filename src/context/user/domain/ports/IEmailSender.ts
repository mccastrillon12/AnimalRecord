export interface IEmailSender {
    sendVerificationCode(email: string, code: string): Promise<void>;
}
