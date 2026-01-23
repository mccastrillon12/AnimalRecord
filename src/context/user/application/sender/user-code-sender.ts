import { Injectable, Inject } from '@nestjs/common';
import { User, UserAuthMethodEnum } from '../../domain/user';
import { IEmailSender } from '../../domain/ports/IEmailSender';

@Injectable()
export class UserCodeSender {
    constructor(
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
    ) { }

    async run(user: User, code: string): Promise<void> {
        if (user.authMethod.value === UserAuthMethodEnum.EMAIL) {
            if (user.email) {
                await this.emailSender.sendVerificationCode(user.email.value, code);
            }
        } else if (user.authMethod.value === UserAuthMethodEnum.PHONE) {
            console.log(`Sending code ${code} to ${user.cellPhone?.value}`);
        }
    }
}
