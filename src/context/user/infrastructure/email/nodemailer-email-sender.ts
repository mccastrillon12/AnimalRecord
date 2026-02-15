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

    // Kept for backward compatibility or future use
    async sendPasswordResetCode(email: string, code: string): Promise<void> {
        // ... existing implementation or deprecate
    }

    async sendPasswordResetLink(email: string, link: string): Promise<void> {
        const mailOptions = {
            from: process.env.MAIL_FROM || '"Animal Record" <noreply@animalrecord.com>',
            to: email,
            subject: 'Restablece tu contraseña en AR',
            text: `Hola,\nRecibimos una solicitud para restablecer tu contraseña. Para continuar, haz clic en el siguiente enlace:\n${link}\n\nEste enlace caducará en unos minutos.\nSi no solicitaste este cambio, ignora este correo.\nGracias,\nEl equipo de Animal Record`,
            html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Hola,</h2>
                <p>Recibimos una solicitud para restablecer tu contraseña. Para continuar, haz clic en el siguiente enlace:</p>
                <p><a href="${link}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px;">Restablecer Contraseña</a></p>
                <p>O copia y pega este enlace en tu navegador: <br> ${link}</p>
                <p>Este enlace te llevará directamente a la página donde podrás crear una nueva contraseña.<br>Por seguridad, el enlace expirará en unos minutos.</p>
                <p>Si tú no solicitaste este cambio, puedes ignorar este correo; tu cuenta seguirá funcionando normalmente.</p>
                <p>Gracias,<br>El equipo de Animal Record</p>
            </div>
            `,
        };

        await this.transporter.sendMail(mailOptions);
    }

    async sendPinResetLink(email: string, link: string): Promise<void> {
        const mailOptions = {
            from: process.env.MAIL_FROM || '"Animal Record" <noreply@animalrecord.com>',
            to: email,
            subject: 'Restablece tu PIN en AR',
            text: `Hola,\nRecibimos una solicitud para restablecer tu PIN. Para continuar, haz clic en el siguiente enlace:\n${link}\n\nEste enlace caducará en unos minutos.\nSi no solicitaste este cambio, ignora este correo.\nGracias,\nEl equipo de Animal Record`,
            html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Hola,</h2>
                <p>Recibimos una solicitud para restablecer tu PIN. Para continuar, haz clic en el siguiente enlace:</p>
                <p><a href="${link}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: #ffffff; text-decoration: none; border-radius: 5px;">Restablecer PIN</a></p>
                <p>O copia y pega este enlace en tu navegador: <br> ${link}</p>
                <p>Este enlace te llevará directamente a la página donde podrás crear uno nuevo.<br>Por seguridad, el enlace expirará en unos minutos.</p>
                <p>Si tú no solicitaste este cambio, puedes ignorar este correo; tu cuenta seguirá funcionando normalmente.</p>
                <p>Gracias,<br>El equipo de Animal Record</p>
            </div>
            `,
        };

        await this.transporter.sendMail(mailOptions);
    }
}
