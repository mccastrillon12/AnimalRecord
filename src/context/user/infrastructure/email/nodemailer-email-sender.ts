import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { IEmailSender } from '../../domain/ports/IEmailSender';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';

@Injectable()
export class NodemailerEmailSender implements IEmailSender {
    private transporter: nodemailer.Transporter;

    constructor(private readonly configService: EnvironmentConfigService) {
        // We will need to add these configs to EnvironmentConfigService later
        // For now, I'll assume they are added or use placeholders/env vars directly safely
        // But cleaner to add to config service. I'll add them to config service next step.
        // Or I can use process.env here if I strictly follow the plan to just use env vars?
        // Plan said "Add MAIL_HOST...".
        // I will use configService, assuming I'll update it.
        this.transporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST,
            port: Number(process.env.MAIL_PORT),
            secure: process.env.MAIL_SECURE === 'true', // true for 465, false for other ports
            auth: {
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PASSWORD,
            },
        });
    }

    async sendVerificationCode(email: string, code: string): Promise<void> {
        const mailOptions = {
            from: process.env.MAIL_FROM || '"Animal Record" <noreply@animalrecord.com>',
            to: email,
            subject: 'Verify your email - Animal Record',
            text: `Your verification code is: ${code}. It expires in 15 minutes.`,
            html: `<b>Your verification code is: ${code}</b><br>It expires in 15 minutes.`,
        };

        await this.transporter.sendMail(mailOptions);
    }
}
