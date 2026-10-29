export type VerificationCodeContext = {
  purpose: 'ANIMAL_TRANSFER';
  expiresInMinutes: number;
};
export interface IEmailSender {
  sendVerificationCode(
    email: string,
    code: string,
    context?: VerificationCodeContext,
  ): Promise<void>;
  sendPasswordResetLink(email: string, link: string): Promise<void>;
  sendPinResetLink(email: string, link: string): Promise<void>;
}
