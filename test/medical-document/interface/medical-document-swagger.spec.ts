import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  AnimalMedicalDocumentController,
  MedicalDocumentController,
} from '../../../src/app/medical-document/medical-document.controller';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { MedicalDocumentAnalysisRunner } from '../../../src/context/medical-document/application/medical-document-analysis-runner';
import { MedicalDocumentReviewer } from '../../../src/context/medical-document/application/medical-document-reviewer';
import { MedicalDocumentFinder } from '../../../src/context/medical-document/application/medical-document-finder';
import { MedicalDocumentDownloader } from '../../../src/context/medical-document/application/medical-document-downloader';
import { MedicalDocumentAnalysisRefresher } from '../../../src/context/medical-document/application/medical-document-analysis-refresher';

describe('Medical document Swagger contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MedicalDocumentController, AnimalMedicalDocumentController],
      providers: [
        {
          provide: MedicalDocumentAnalysisRunner,
          useValue: { run: jest.fn() },
        },
        {
          provide: MedicalDocumentAnalysisRefresher,
          useValue: { refresh: jest.fn() },
        },
        {
          provide: MedicalDocumentReviewer,
          useValue: { accept: jest.fn(), reject: jest.fn() },
        },
        {
          provide: MedicalDocumentFinder,
          useValue: { findById: jest.fn(), findByAnimal: jest.fn() },
        },
        { provide: MedicalDocumentDownloader, useValue: { run: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('publishes detailed schemas, examples, and documented responses', () => {
    const openApi = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token')
        .build(),
    );

    const analyze = openApi.paths['/medical-documents/analyze']?.post;
    const review = openApi.paths['/medical-documents/{documentId}/review']?.put;
    const download =
      openApi.paths['/medical-documents/{documentId}/download-url']?.get;
    const responseSchema =
      openApi.components?.schemas?.MedicalDocumentResponseDto;

    expect(Object.keys(analyze?.responses || {})).toEqual(
      expect.arrayContaining(['202', '400', '401', '403', '404', '413', '502']),
    );
    expect(Object.keys(review?.responses || {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
    expect(Object.keys(download?.responses || {})).toEqual(
      expect.arrayContaining(['200', '401', '403', '404', '409', '502']),
    );
    expect(JSON.stringify(review?.requestBody)).toContain('accept');
    expect(JSON.stringify(review?.requestBody)).toContain('reject');
    expect(JSON.stringify(review?.requestBody)).toContain('finalCategory');
    expect(JSON.stringify(analyze?.requestBody)).toContain('requestedCategory');
    expect(JSON.stringify(responseSchema)).toContain(
      'ValidatedMedicalDocumentExtractionDto',
    );
    expect(JSON.stringify(responseSchema)).toEqual(
      expect.stringContaining('requestedCategory'),
    );
    expect(JSON.stringify(responseSchema)).toEqual(
      expect.stringContaining('primaryDetectedCategory'),
    );
    expect(JSON.stringify(responseSchema)).toEqual(
      expect.stringContaining('detectedCategories'),
    );
    expect(JSON.stringify(responseSchema)).toEqual(
      expect.stringContaining('classificationOutcome'),
    );
    expect(JSON.stringify(responseSchema)).toEqual(
      expect.stringContaining('extractionsByCategory'),
    );
    expect(JSON.stringify(responseSchema)).toEqual(
      expect.stringContaining('finalCategory'),
    );
    expect(openApi.components?.schemas).toHaveProperty(
      'ExtractedMedicationDto',
    );
    expect(openApi.components?.schemas).toHaveProperty(
      'ExtractedVaccinationDto',
    );
    expect(openApi.components?.schemas).toHaveProperty(
      'ExtractedMedicalOrderDto',
    );
    expect(openApi.components?.schemas).toHaveProperty(
      'ExtractedClinicalHistoryDto',
    );
    expect(openApi.components?.schemas).toHaveProperty(
      'ExtractedDiagnosticResultDto',
    );
  });
});
