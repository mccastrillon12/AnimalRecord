import { Injectable, Inject } from '@nestjs/common';
import { User, UserAuthMethodEnum } from '../../domain/user';
import { IEmailSender } from '../../domain/ports/IEmailSender';
import { ISmsSender } from '../../domain/ports/ISmsSender';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';

@Injectable()
export class UserCodeSender {
    constructor(
        @Inject('IEmailSender') private readonly emailSender: IEmailSender,
        @Inject('ISmsSender') private readonly smsSender: ISmsSender,
        private readonly configService: EnvironmentConfigService
    ) { }

    async run(user: User, code: string): Promise<void> {
        if (user.authMethod.value === UserAuthMethodEnum.EMAIL) {
            if (user.email) {
                await this.emailSender.sendVerificationCode(user.email.value, code);
            }
        } else if (user.authMethod.value === UserAuthMethodEnum.PHONE) {
            console.log(`Sending code ${code} to ${user.cellPhone?.value}`);
            if (user.cellPhone) {
                let message = `Tu código de verificación de Animal Record es: ${code}`;

                const appHash = this.configService.getAndroidAppHash();
                if (appHash && appHash.length === 11) {
                    message += `\n\n[${appHash}]`;
                }

                await this.smsSender.send(user.cellPhone.value, message);
            }
        }
    }
}
