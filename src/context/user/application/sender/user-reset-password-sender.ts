import { Injectable, Inject } from '@nestjs/common';
import { User, UserAuthMethodEnum } from '../../domain/user';
import { IEmailSender } from '../../domain/ports/IEmailSender';
import { ISmsSender } from '../../domain/ports/ISmsSender';

@Injectable()
export class UserResetPasswordSender {
    constructor(
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
        @Inject('ISmsSender') private readonly smsSender: ISmsSender,
    ) { }

    async run(user: User, link: string): Promise<void> {
        if (user.email) {
            await this.emailSender.sendPasswordResetLink(user.email.value, link);
        } else if (user.cellPhone) {
            console.log(`Sending reset link ${link} to ${user.cellPhone.value}`);
            const message = `Recupera tu contraseña de Animal Record ingresando a este enlace: ${link}`;
            await this.smsSender.send(user.cellPhone.value, message);
        }
    }
}
