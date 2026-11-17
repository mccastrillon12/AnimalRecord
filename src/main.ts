import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  DynamicModule,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './app/shared/filters/http-exception.filter';

export function configureAnimalRecordHttp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('AnimalRecord API')
    .setDescription(
      'The AnimalRecord API documentation. \n\nThis API follows RESTful principles and uses Hexagonal Architecture. \n\n**Authentication**: Most endpoints require a Bearer Token. Use `/auth/login` to obtain one.',
    )
    .setVersion('1.0')
    .setContact(
      'AnimalRecord Support',
      'https://animalrecord.com',
      'support@animalrecord.com',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'access-token', // This name here is important for matching @ApiBearerAuth()
    )
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management endpoints')
    .addTag('animals', 'Animal management endpoints')
    .addTag('medical-documents', 'AI-assisted veterinary document processing')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}

export async function bootstrap(transferRuntime?: DynamicModule) {
  const root = transferRuntime
    ? AppModule.withTransferAcceptance(transferRuntime)
    : AppModule;
  const app = await NestFactory.create(root);
  configureAnimalRecordHttp(app);
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  return app;
}
if (require.main === module) void bootstrap();
