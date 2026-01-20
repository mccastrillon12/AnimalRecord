import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EnvironmentConfigService {
  constructor(private configService: ConfigService) { }

  getAppEnv(): string | undefined {
    return this.configService.get<string>('APP_ENV');
  }

  getDatabaseHost(): string | undefined {
    return this.configService.get<string>('DATABASE_HOST');
  }

  getDatabasePort(): number | undefined {
    return this.configService.get<number>('DATABASE_PORT');
  }

  getDatabaseUser(): string | undefined {
    return this.configService.get<string>('DATABASE_USER');
  }

  getDatabasePassword(): string | undefined {
    return this.configService.get<string>('DATABASE_PASSWORD');
  }

  getDatabaseName(): string | undefined {
    return this.configService.get<string>('DATABASE_NAME');
  }

  getDatabaseSchema(): string | undefined {
    return this.configService.get<string>('DATABASE_SCHEMA');
  }

  getDatabaseSync(): boolean | undefined {
    return this.configService.get<boolean>('DATABASE_SYNCHRONIZE');
  }

  getMongoUri(): string {
    return this.configService.get<string>('MONGO_URI')!;
  }

  getMongoDbName(): string {
    return this.configService.get<string>('MONGO_DB_NAME')!;
  }

  getJwtSecret(): string {
    return this.configService.get<string>('JWT_SECRET')!;
  }

  getJwtExpirationTime(): string {
    return this.configService.get<string>('JWT_EXPIRATION_TIME')!;
  }

  getJwtRefreshSecret(): string {
    return this.configService.get<string>('JWT_REFRESH_SECRET')!;
  }

  getJwtRefreshExpirationTime(): string {
    return this.configService.get<string>('JWT_REFRESH_EXPIRATION_TIME')!;
  }

  getVerificationCodeExpirationTime(): number {
    return Number(this.configService.get<number>('VERIFICATION_CODE_EXPIRATION_MINUTES') || 15);
  }

  getAwsAccessKeyId(): string {
    return this.configService.get<string>('AWS_ACCESS_KEY_ID')!;
  }

  getAwsSecretAccessKey(): string {
    return this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!;
  }

  getAwsRegion(): string {
    return this.configService.get<string>('AWS_REGION')!;
  }
}
