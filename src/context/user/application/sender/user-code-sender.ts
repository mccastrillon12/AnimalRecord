import { Injectable, Inject } from '@nestjs/common';
import { User } from '../../domain/user';
import {
  IEmailSender,
  VerificationCodeContext,
} from '../../domain/ports/IEmailSender';
import { ISmsSender } from '../../domain/ports/ISmsSender';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';
import { ConflictError } from '../../../shared/domain/errors/ConflictError';

/** Transfer authorization uses registered contacts independently of login provider. */
export function transferOtpDestination(user: User): {
  channel: 'EMAIL' | 'PHONE';
  destination: string;
} {
  if (user.authMethod.value === 'PHONE' && user.cellPhone?.value)
    return { channel: 'PHONE', destination: user.cellPhone.value };
  if (user.email?.value)
    return { channel: 'EMAIL', destination: user.email.value };
  if (user.cellPhone?.value)
    return { channel: 'PHONE', destination: user.cellPhone.value };
  throw new ConflictError(
    'The account has no registered email or phone for transfer verification',
  );
}

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
    const channel = context
      ? transferOtpDestination(user).channel
      : user.authMethod.value;
    if (channel === 'EMAIL') {
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
    } else if (channel === 'PHONE') {
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
