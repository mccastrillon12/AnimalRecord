import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvironmentConfigService } from '../config/environment/environment.service';
import { IStorageService } from '../../../user/domain/ports/IStorageService';

@Injectable()
export class AwsS3StorageService implements IStorageService {
    private s3Client: S3Client;
    private bucketName: string;

    constructor(private readonly configService: EnvironmentConfigService) {
        this.bucketName = this.configService.getAwsS3BucketName();
        this.s3Client = new S3Client({
            region: this.configService.getAwsS3Region(),
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
            }
        });
    }

    async generatePreSignedUploadUrl(fileName: string, mimeType: string, maxSizeLimit: number): Promise<{ uploadUrl: string, finalUrl: string }> {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: fileName,
            ContentType: mimeType,
        });

        // URL expires in 5 minutes (300 seconds)
        const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 300 });

        const finalUrl = `https://${this.bucketName}.s3.${this.configService.getAwsS3Region()}.amazonaws.com/${fileName}`;

        return { uploadUrl, finalUrl };
    }

    async deleteFile(fileUrl: string): Promise<void> {
        if (!fileUrl) return;

        try {
            // Extact Key from the URL by removing the bucket name and domain
            const urlParts = fileUrl.split('.amazonaws.com/');
            if (urlParts.length !== 2) return;

            const key = urlParts[1];

            const command = new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: key
            });

            await this.s3Client.send(command);
        } catch (error) {
            console.error(`Failed to delete S3 file: ${fileUrl}`, error);
            // We ignore the error so it doesn't break the user's flow
        }
    }
}
