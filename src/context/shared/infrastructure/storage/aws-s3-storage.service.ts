import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvironmentConfigService } from '../config/environment/environment.service';
import { IStorageService } from '../../../user/domain/ports/IStorageService';
import { InvalidArgumentError } from '../../domain/errors/InvalidArgumentError';
import { ANIMAL_UPLOAD_URL_EXPIRATION_SECONDS } from '../../domain/animal-upload-policy';
import type { AnimalMediaDownloadStorage } from '../../../animal-media/domain/animal-media-download-storage';
import { ExternalServiceError } from '../../domain/errors/ExternalServiceError';

export function regionalS3ObjectKey(
  fileUrl: string,
  bucket: string,
  region: string,
): string | undefined {
  try {
    const url = new URL(fileUrl);
    if (
      url.protocol !== 'https:' ||
      url.host !== `${bucket}.s3.${region}.amazonaws.com` ||
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

@Injectable()
export class AwsS3StorageService
  implements IStorageService, AnimalMediaDownloadStorage
{
  private s3Client: S3Client;
  private bucketName: string;

  constructor(private readonly configService: EnvironmentConfigService) {
    this.bucketName = this.configService.getAwsS3BucketName();
    this.s3Client = new S3Client({
      region: this.configService.getAwsS3Region(),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        sessionToken: process.env.AWS_SESSION_TOKEN,
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
      expiresIn: ANIMAL_UPLOAD_URL_EXPIRATION_SECONDS,
    });

    const finalUrl = `https://${this.bucketName}.s3.${this.configService.getAwsS3Region()}.amazonaws.com/${fileName}`;

    return { uploadUrl, finalUrl };
  }

  async signAnimalMediaDownload(key: string) {
    const expiresIn = 300;
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ResponseCacheControl: 'private, no-store',
    });
    try {
      const downloadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn,
      });
      return { downloadUrl, expiresIn };
    } catch {
      throw new ExternalServiceError(
        'The animal media download could not be signed',
      );
    }
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
    return regionalS3ObjectKey(
      fileUrl,
      this.bucketName,
      this.configService.getAwsS3Region(),
    );
  }
}
