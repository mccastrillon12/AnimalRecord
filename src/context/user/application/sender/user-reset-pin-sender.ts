import { Injectable, Inject } from '@nestjs/common';
import { User, UserAuthMethodEnum } from '../../domain/user';
import { IEmailSender } from '../../domain/ports/IEmailSender';

@Injectable()
export class UserResetPinSender {
    constructor(
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
    ) { }

    async run(user: User, link: string): Promise<void> {
        if (user.email) {
            await this.emailSender.sendPinResetLink(user.email.value, link);
        } else if (user.cellPhone) {
            console.log(`Pin reset requested for phone user: ${user.cellPhone.value}, but PIN is meant for social login. No SMS sent.`);
        }
    }
}
