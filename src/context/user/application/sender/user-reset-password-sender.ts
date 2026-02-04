import { Injectable, Inject } from '@nestjs/common';
import { User, UserAuthMethodEnum } from '../../domain/user';
import { IEmailSender } from '../../domain/ports/IEmailSender';

@Injectable()
export class UserResetPasswordSender {
    constructor(
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
    ) { }

    async run(user: User, code: string): Promise<void> {
        if (user.authMethod.value === UserAuthMethodEnum.EMAIL) {
            if (user.email) {
                await this.emailSender.sendPasswordResetCode(user.email.value, code);
            }
        } else if (user.authMethod.value === UserAuthMethodEnum.PHONE) {
            console.log(`Sending reset code ${code} to ${user.cellPhone?.value}`);
            // TODO: Implement SMS sender logic here when SMS provider is ready
        }
    }
}
