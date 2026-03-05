import { Injectable } from '@nestjs/common';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { ISmsSender } from '../../domain/ports/ISmsSender';

@Injectable()
export class AwsSnsSmsSender implements ISmsSender {
    private snsClient: SNSClient;
    private senderId: string;

    constructor() {
        this.snsClient = new SNSClient({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
            }
        });
        this.senderId = process.env.AWS_SNS_SENDER_ID || 'AnimalRec';
    }

    async send(phoneNumber: string, message: string): Promise<void> {
        try {
            const command = new PublishCommand({
                Message: message,
                PhoneNumber: phoneNumber,
                MessageAttributes: {
                    'AWS.SNS.SMS.SenderID': {
                        DataType: 'String',
                        StringValue: this.senderId
                    },
                    'AWS.SNS.SMS.SMSType': {
                        DataType: 'String',
                        StringValue: 'Transactional' // Or 'Promotional', Transactional is better for OTPs
                    }
                }
            });

            const response = await this.snsClient.send(command);
            console.log(`SMS sent successfully to ${phoneNumber}. MessageId: ${response.MessageId}`);
        } catch (error) {
            console.error(`Failed to send SMS to ${phoneNumber}:`, error);
            // We might not want to throw an error depending on business logic, 
            // but logging it is essential. For now we will allow it to fail silently 
            // from the user's perspective, or throw to block the flow.
            throw new Error(`Error sending SMS: ${(error as any).message}`);
        }
    }
}
