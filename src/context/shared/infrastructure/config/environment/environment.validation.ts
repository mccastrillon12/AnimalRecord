import { plainToClass } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Local = 'local',
  Test = 'test',
}

class EnvironmentVariables {
  @IsOptional()
  @IsEnum(Environment)
  APP_ENV: Environment;

  @IsOptional()
  @IsString()
  DATABASE_HOST: string;
  @IsOptional()
  @IsNumber()
  DATABASE_PORT: number;
  @IsOptional()
  @IsString()
  DATABASE_USER: string;
  @IsOptional()
  @IsString()
  DATABASE_PASSWORD: string;
  @IsOptional()
  @IsString()
  DATABASE_NAME: string;
  @IsOptional()
  @IsString()
  DATABASE_SCHEMA: string;
  @IsOptional()
  @IsBoolean()
  DATABASE_SYNCHRONIZE: boolean;

  @IsString()
  MONGO_URI: string;

  @IsString()
  MONGO_DB_NAME: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
