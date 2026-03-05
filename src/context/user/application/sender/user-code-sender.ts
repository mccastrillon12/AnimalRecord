import { Injectable, Inject } from '@nestjs/common';
import { User, UserAuthMethodEnum } from '../../domain/user';
import { IEmailSender } from '../../domain/ports/IEmailSender';
import { ISmsSender } from '../../domain/ports/ISmsSender';

@Injectable()
export class UserCodeSender {
    constructor(
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
        @Inject('ISmsSender') private readonly smsSender: ISmsSender,
    ) { }

    async run(user: User, code: string): Promise<void> {
        if (user.authMethod.value === UserAuthMethodEnum.EMAIL) {
            if (user.email) {
                await this.emailSender.sendVerificationCode(user.email.value, code);
            }
        } else if (user.authMethod.value === UserAuthMethodEnum.PHONE) {
            console.log(`Sending code ${code} to ${user.cellPhone?.value}`);
            if (user.cellPhone) {
                const message = `Tu código de verificación de Animal Record es: ${code}`;
                await this.smsSender.send(user.cellPhone.value, message);
            }
        }
    }
}
