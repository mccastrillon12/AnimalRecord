import { Injectable, Inject } from '@nestjs/common';
import { User, UserAuthMethodEnum } from '../../domain/user';
import { IEmailSender } from '../../domain/ports/IEmailSender';

@Injectable()
export class UserCodeSender {
    constructor(
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
        // Later inject SMS sender here
    ) { }

    async run(user: User, code: string): Promise<void> {
        if (user.authMethod.value === UserAuthMethodEnum.EMAIL) {
            if (user.email) {
                await this.emailSender.sendVerificationCode(user.email.value, code);
            }
        } else if (user.authMethod.value === UserAuthMethodEnum.PHONE) {
            // Placeholder for SMS Logic
            // if (user.cellPhone) { await this.smsSender.send(user.cellPhone.value, code); }
            console.log(`[Mock SMS] Sending code ${code} to ${user.cellPhone?.value}`);
        }
    }
}
