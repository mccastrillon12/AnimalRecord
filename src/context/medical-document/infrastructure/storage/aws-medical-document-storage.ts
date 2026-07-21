import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MedicalDocumentStorage } from '../../domain/medical-document-storage';
import { EnvironmentConfigService } from '../../../shared/infrastructure/config/environment/environment.service';

@Injectable()
export class AwsMedicalDocumentStorage implements MedicalDocumentStorage {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly configService: EnvironmentConfigService) {
    this.bucketName = this.configService.getAwsS3BucketName();
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    this.client = new S3Client({
      region: this.configService.getAwsS3Region(),
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
              sessionToken: process.env.AWS_SESSION_TOKEN,
            }
          : undefined,
    });
  }

  async putObject(
    key: string,
    content: Uint8Array,
    mimeType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: content,
        ContentType: mimeType,
      }),
    );

    return `s3://${this.bucketName}/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }

  async generateDownloadUrl(
    key: string,
    downloadFileName: string,
  ): Promise<string> {
    const safeFileName = downloadFileName.replace(/["\r\n]/g, '_');
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safeFileName}"`,
    });

    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }
}
