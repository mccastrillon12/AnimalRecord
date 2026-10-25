import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvironmentConfigService } from '../config/environment/environment.service';
import { IStorageService } from '../../../user/domain/ports/IStorageService';
import { InvalidArgumentError } from '../../domain/errors/InvalidArgumentError';

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
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async generatePreSignedUploadUrl(
    fileName: string,
    mimeType: string,
    maxSizeLimit: number,
  ): Promise<{ uploadUrl: string; finalUrl: string }> {
    if (!Number.isSafeInteger(maxSizeLimit) || maxSizeLimit < 1) {
      throw new InvalidArgumentError('File size must be a positive integer');
    }
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
      ContentType: mimeType,
    });

    // URL expires in 5 minutes (300 seconds)
    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 300,
    });

    const finalUrl = `https://${this.bucketName}.s3.${this.configService.getAwsS3Region()}.amazonaws.com/${fileName}`;

    return { uploadUrl, finalUrl };
  }

  async deleteFile(fileUrl: string): Promise<void> {
    if (!fileUrl) return;

    try {
      const key = this.getFileKey(fileUrl);
      if (!key) return;

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error) {
      console.error(`Failed to delete S3 file: ${fileUrl}`, error);
      // We ignore the error so it doesn't break the user's flow
    }
  }

  getFileKey(fileUrl: string): string | undefined {
    try {
      const url = new URL(fileUrl);
      const expectedHost = `${this.bucketName}.s3.${this.configService.getAwsS3Region()}.amazonaws.com`;
      if (
        url.protocol !== 'https:' ||
        url.host !== expectedHost ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return undefined;
      const key = decodeURIComponent(url.pathname.slice(1));
      if (
        !key ||
        key.includes('\\') ||
        key.split('/').some((part) => !part || part === '.' || part === '..')
      )
        return undefined;
      return key;
    } catch {
      return undefined;
    }
  }
}
