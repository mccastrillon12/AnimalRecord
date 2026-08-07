import { Injectable } from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
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

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const copySource = [this.bucketName, ...sourceKey.split('/')]
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucketName,
        CopySource: copySource,
        Key: destinationKey,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }

  objectUri(key: string): string {
    return `s3://${this.bucketName}/${key}`;
  }

  async listJsonObjects(
    s3Uri: string,
  ): Promise<Array<{ key: string; content: string }>> {
    const { bucket, prefix } = this.parseS3Uri(s3Uri);
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      keys.push(
        ...(response.Contents || [])
          .map((object) => object.Key)
          .filter((key): key is string => Boolean(key?.endsWith('.json'))),
      );
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return Promise.all(
      keys.map(async (key) => {
        const response = await this.client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        return {
          key,
          content: (await response.Body?.transformToString()) || '',
        };
      }),
    );
  }

  async deletePrefix(s3Uri: string): Promise<void> {
    const { bucket, prefix } = this.parseS3Uri(s3Uri);

    while (true) {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
        }),
      );
      const objects = (response.Contents || [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key))
        .map((Key) => ({ Key }));
      if (objects.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
      }
      if (!response.IsTruncated || objects.length === 0) break;
    }
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

  private parseS3Uri(s3Uri: string): { bucket: string; prefix: string } {
    const match = /^s3:\/\/([^/]+)\/(.*)$/.exec(s3Uri);
    if (!match || match[1] !== this.bucketName) {
      throw new Error(
        'The S3 output URI does not belong to the configured bucket',
      );
    }
    return { bucket: match[1], prefix: match[2] };
  }
}
