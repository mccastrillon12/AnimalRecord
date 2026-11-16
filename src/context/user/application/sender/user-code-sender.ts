import { Injectable, Inject } from '@nestjs/common';
import { User } from '../../domain/user';
import {
  IEmailSender,
  VerificationCodeContext,
} from '../../domain/ports/IEmailSender';
import { ISmsSender } from '../../domain/ports/ISmsSender';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';

@Injectable()
export class UserCodeSender {
  constructor(
    @Inject('IEmailSender') private readonly emailSender: IEmailSender,
    @Inject('ISmsSender') private readonly smsSender: ISmsSender,
    private readonly configService: EnvironmentConfigService,
  ) {}

  async run(
    user: User,
    code: string,
    context?: VerificationCodeContext,
  ): Promise<void> {
    if (user.authMethod.value === 'EMAIL') {
      if (user.email) {
        if (context)
          await this.emailSender.sendVerificationCode(
            user.email.value,
            code,
            context,
          );
        else
          await this.emailSender.sendVerificationCode(user.email.value, code);
      }
    } else if (user.authMethod.value === 'PHONE') {
      if (user.cellPhone) {
        let message = context
          ? `Tu código para autorizar una transferencia de animales en Animal Record es: ${code}`
          : `Tu código de verificación de Animal Record es: ${code}`;

        const appHash = this.configService.getAndroidAppHash();
        if (appHash && appHash.length === 11) {
          message += `\n\n[${appHash}]`;
        }

        await this.smsSender.send(user.cellPhone.value, message);
      }
    }
  }
}
