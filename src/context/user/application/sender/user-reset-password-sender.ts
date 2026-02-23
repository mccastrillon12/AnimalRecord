import { Injectable, Inject } from '@nestjs/common';
import { User, UserAuthMethodEnum } from '../../domain/user';
import { IEmailSender } from '../../domain/ports/IEmailSender';

@Injectable()
export class UserResetPasswordSender {
    constructor(
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
    ) { }

    async run(user: User, link: string): Promise<void> {
        if (user.email) {
            await this.emailSender.sendPasswordResetLink(user.email.value, link);
        } else if (user.cellPhone) {
            console.log(`Sending reset link ${link} to ${user.cellPhone.value}`);
            // TODO: Implement SMS sender logic here when SMS provider is ready
        }
    }
}
