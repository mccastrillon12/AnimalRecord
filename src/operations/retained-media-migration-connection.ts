import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { checkInitialTransferS3Media } from '../app/animal-transfer/initial-transfer-acceptance-s3';
import { AnimalMediaModule } from '../app/animal-media/animal-media.module';
import { LegacyAnimalMediaMigration } from '../context/animal-media/application/legacy-animal-media-migration';
import { EnvironmentConfigService } from '../context/shared/infrastructure/config/environment/environment.service';
import { ConflictError } from '../context/shared/domain/errors/ConflictError';
import type {
  RetainedMigrationConnection,
  RetainedMigrationTarget,
} from './retained-media-migration.cli';

export async function openRetainedMediaMigration(
  target: RetainedMigrationTarget,
): Promise<RetainedMigrationConnection> {
  const { MONGO_URI, MONGO_DB_NAME, AWS_S3_BUCKET_NAME } = process.env;
  if (
    !MONGO_URI ||
    MONGO_DB_NAME !== target.database ||
    AWS_S3_BUCKET_NAME !== target.bucket
  )
    throw new ConflictError(
      'The database and bucket must match the backend container environment',
    );

  @Module({
    imports: [
      MongooseModule.forRoot(MONGO_URI, {
        dbName: target.database,
        autoCreate: false,
        autoIndex: false,
        retryAttempts: 1,
        serverSelectionTimeoutMS: 5_000,
      }),
      AnimalMediaModule,
    ],
  })
  class RetainedMediaMigrationModule {}

  const app = await NestFactory.createApplicationContext(
    RetainedMediaMigrationModule,
    {
      logger: false,
      abortOnError: false,
    },
  );
  try {
    const migration = app.get(LegacyAnimalMediaMigration);
    const config = app.get(EnvironmentConfigService);
    const db = app.get<Connection>(getConnectionToken()).db;
    if (
      !db ||
      db.databaseName !== target.database ||
      config.getAwsS3BucketName() !== target.bucket
    )
      throw new ConflictError(
        'The resolved database or bucket differs from the requested target',
      );
    return {
      migration,
      async verifyIndexes() {
        for (const [collection, fields] of [
          ['animal_media_migrations', ['id']],
          ['animal_media_uploads', ['id', 'finalKey', 'stagingKey']],
        ] as const) {
          const indexes = (await db
            .collection(collection)
            .listIndexes({
              readPreference: 'primary',
              maxTimeMS: 5_000,
              timeoutMS: 5_000,
            })
            .toArray()) as Array<{
            key?: Record<string, unknown>;
            unique?: boolean;
            sparse?: boolean;
            partialFilterExpression?: unknown;
            buildUUID?: unknown;
          }>;
          for (const field of fields) {
            if (
              !indexes.some(
                (index) =>
                  index.unique === true &&
                  index.sparse !== true &&
                  !index.partialFilterExpression &&
                  !index.buildUUID &&
                  index.key?.[field] === 1 &&
                  Object.keys(index.key).length === 1,
              )
            )
              throw new ConflictError(
                `Missing unique index on ${collection}.${field}`,
              );
          }
        }
      },
      async verifyBucket(expectedBucketOwner) {
        const report = await checkInitialTransferS3Media({
          bucket: target.bucket,
          expectedBucketOwner,
          region: config.getAwsS3Region(),
          timeoutMs: 5_000,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
            sessionToken: process.env.AWS_SESSION_TOKEN,
          },
        });
        if (!report.versioningEnabled || !report.objectLockEnabled)
          throw new ConflictError(
            'S3 Versioning and Object Lock must both be enabled',
          );
      },
      close: () => app.close(),
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
