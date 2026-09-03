import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AnimalModule } from '../animal/animal.module';
import { EnvironmentConfigModule } from '../../context/shared/infrastructure/config/environment/environment.module';
import {
  MedicalDocumentEntity,
  MedicalDocumentSchema,
} from '../../context/medical-document/infrastructure/persistence/mongo/medical-document.schema';
import { MongoMedicalDocumentRepository } from '../../context/medical-document/infrastructure/persistence/mongo/mongo-medical-document-repository';
import { AwsMedicalDocumentStorage } from '../../context/medical-document/infrastructure/storage/aws-medical-document-storage';
import { AwsBedrockMedicalDocumentAnalyzer } from '../../context/medical-document/infrastructure/ai/aws-bedrock-medical-document-analyzer';
import { MedicalDocumentExtractionMapper } from '../../context/medical-document/infrastructure/ai/medical-document-extraction-mapper';
import { MedicalDocumentAnimalAccess } from '../../context/medical-document/application/medical-document-animal-access';
import { MedicalDocumentAnalysisRunner } from '../../context/medical-document/application/medical-document-analysis-runner';
import { MedicalDocumentReviewer } from '../../context/medical-document/application/medical-document-reviewer';
import { MedicalDocumentFinder } from '../../context/medical-document/application/medical-document-finder';
import { MedicalDocumentDownloader } from '../../context/medical-document/application/medical-document-downloader';
import { MedicalDocumentAnalysisRefresher } from '../../context/medical-document/application/medical-document-analysis-refresher';
import { MedicalDocumentCodeGenerator } from '../../context/medical-document/application/medical-document-code-generator';
import {
  CounterEntity,
  CounterSchema,
} from '../../context/shared/infrastructure/persistence/mongo/counter.schema';
import { MongoCounterRepository } from '../../context/shared/infrastructure/persistence/mongo/mongo-counter-repository';
import {
  MedicalDocumentFeedbackEntity,
  MedicalDocumentFeedbackSchema,
} from '../../context/medical-document/infrastructure/persistence/mongo/medical-document-feedback.schema';
import { MongoMedicalDocumentFeedbackRepository } from '../../context/medical-document/infrastructure/persistence/mongo/mongo-medical-document-feedback-repository';
import { MedicalDocumentFeedbackService } from '../../context/medical-document/application/medical-document-feedback-service';
import { PdfJsMedicalDocumentPdfRasterizer } from '../../context/medical-document/infrastructure/pdf/pdfjs-medical-document-pdf-rasterizer';
import {
  AnimalMedicalDocumentController,
  MedicalDocumentController,
} from './medical-document.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MedicalDocumentEntity.name, schema: MedicalDocumentSchema },
      { name: CounterEntity.name, schema: CounterSchema },
      {
        name: MedicalDocumentFeedbackEntity.name,
        schema: MedicalDocumentFeedbackSchema,
      },
    ]),
    AuthModule,
    AnimalModule,
    EnvironmentConfigModule,
  ],
  controllers: [MedicalDocumentController, AnimalMedicalDocumentController],
  providers: [
    {
      provide: 'MedicalDocumentRepository',
      useClass: MongoMedicalDocumentRepository,
    },
    {
      provide: 'MedicalDocumentStorage',
      useClass: AwsMedicalDocumentStorage,
    },
    {
      provide: 'MedicalDocumentAnalyzer',
      useClass: AwsBedrockMedicalDocumentAnalyzer,
    },
    {
      provide: 'MedicalDocumentPdfRasterizer',
      useClass: PdfJsMedicalDocumentPdfRasterizer,
    },
    {
      provide: 'MedicalDocumentFeedbackRepository',
      useClass: MongoMedicalDocumentFeedbackRepository,
    },
    MedicalDocumentExtractionMapper,
    MedicalDocumentAnimalAccess,
    MedicalDocumentAnalysisRunner,
    MedicalDocumentAnalysisRefresher,
    MongoCounterRepository,
    MedicalDocumentCodeGenerator,
    MedicalDocumentFeedbackService,
    MedicalDocumentReviewer,
    MedicalDocumentFinder,
    MedicalDocumentDownloader,
  ],
})
export class MedicalDocumentModule {}
