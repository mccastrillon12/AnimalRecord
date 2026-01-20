import { Injectable } from '@nestjs/common';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { ISmsSender } from '../../domain/ports/ISmsSender';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';

@Injectable()
export class AwsSnsSmsSender implements ISmsSender {
    private client: SNSClient;

    constructor(private readonly configService: EnvironmentConfigService) {
        this.client = new SNSClient({
            region: this.configService.getAwsRegion(),
            credentials: {
                accessKeyId: this.configService.getAwsAccessKeyId(),
                secretAccessKey: this.configService.getAwsSecretAccessKey(),
            },
        });
    }

    async send(phoneNumber: string, message: string): Promise<void> {
        try {
            const command = new PublishCommand({
                PhoneNumber: phoneNumber,
                Message: message,
            });
            await this.client.send(command);
        } catch (error) {
            console.error('Error sending SMS via AWS SNS:', error);
            // We log but don't throw to avoid blocking the main flow if SMS fails
        }
    }
}
