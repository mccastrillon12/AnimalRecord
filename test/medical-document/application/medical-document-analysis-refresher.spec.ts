import { MedicalDocumentAnalysisRefresher } from '../../../src/context/medical-document/application/medical-document-analysis-refresher';
import {
  MedicalDocument,
  MedicalDocumentClassificationOutcome,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';
import {
  MedicalDocumentAnalysisJobStatus,
  MedicalDocumentAnalyzer,
} from '../../../src/context/medical-document/domain/medical-document-analyzer';
import { MedicalDocumentRepository } from '../../../src/context/medical-document/domain/medical-document-repository';
import { MedicalDocumentStorage } from '../../../src/context/medical-document/domain/medical-document-storage';

describe('MedicalDocumentAnalysisRefresher', () => {
  let repository: jest.Mocked<MedicalDocumentRepository>;
  let storage: jest.Mocked<MedicalDocumentStorage>;
  let analyzer: jest.Mocked<MedicalDocumentAnalyzer>;
  let document: MedicalDocument;

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      findById: jest.fn(),
      findAcceptedByAnimalId: jest.fn(),
      update: jest.fn().mockResolvedValue(true),
    };
    storage = {
      putObject: jest.fn(),
      copyObject: jest.fn(),
      deleteObject: jest.fn(),
      objectUri: jest.fn((key) => `s3://bucket/${key}`),
      listJsonObjects: jest.fn(),
      deletePrefix: jest.fn(),
      generateDownloadUrl: jest.fn(),
    };
    analyzer = {
      start: jest.fn(),
      getResult: jest.fn(),
    };
    document = MedicalDocument.create(
      'owner-id',
      ['animal-id'],
      'document.pdf',
      'application/pdf',
      100,
      'users/owner-id/medical-document-intake/document-id/source.pdf',
      'document-id',
    );
    document.markAnalyzing();
    document.registerAnalysisJob(
      'arn:aws:bedrock:job/123',
      's3://bucket/output/',
    );
  });

  it('keeps the document analyzing while the AWS job is in progress', async () => {
    analyzer.getResult.mockResolvedValue({
      status: MedicalDocumentAnalysisJobStatus.InProgress,
    });
    const refresher = new MedicalDocumentAnalysisRefresher(
      repository,
      storage,
      analyzer,
    );

    const result = await refresher.refresh(document);

    expect(result.status).toBe(MedicalDocumentStatus.Analyzing);
    expect(repository.update.mock.calls).toHaveLength(0);
  });

  it('completes the analysis with every category returned by AWS', async () => {
    analyzer.getResult.mockResolvedValue({
      status: MedicalDocumentAnalysisJobStatus.Succeeded,
      analysis: {
        primaryDetectedCategory: MedicalDocumentType.Prescription,
        detectedCategories: [
          { category: MedicalDocumentType.Prescription, confidence: 0.95 },
          { category: MedicalDocumentType.Referral, confidence: 0.8 },
        ],
        extractionsByCategory: {
          [MedicalDocumentType.Prescription]: emptyExtraction(
            MedicalDocumentType.Prescription,
          ),
          [MedicalDocumentType.Referral]: emptyExtraction(
            MedicalDocumentType.Referral,
          ),
        },
        providerMetadata: { provider: 'TEST', segmentCount: 2 },
      },
    });
    const refresher = new MedicalDocumentAnalysisRefresher(
      repository,
      storage,
      analyzer,
    );

    const result = await refresher.refresh(document);

    expect(result.status).toBe(MedicalDocumentStatus.ReviewPending);
    expect(result.detectedCategories).toHaveLength(2);
    expect(repository.update.mock.calls).toContainEqual([document]);
  });

  it('keeps an unmatched menu unclassified when PRESCRIPTION was requested', async () => {
    document = MedicalDocument.create(
      'owner-id',
      ['animal-id'],
      'restaurant-menu.pdf',
      'application/pdf',
      100,
      'users/owner-id/medical-document-intake/menu-id/source.pdf',
      'menu-id',
      MedicalDocumentType.Prescription,
    );
    document.markAnalyzing();
    document.registerAnalysisJob(
      'arn:aws:bedrock:job/menu',
      's3://bucket/menu-output/',
    );
    analyzer.getResult.mockResolvedValue({
      status: MedicalDocumentAnalysisJobStatus.Succeeded,
      analysis: {
        primaryDetectedCategory: undefined,
        detectedCategories: [],
        extractionsByCategory: {
          [MedicalDocumentType.Other]: emptyExtraction(
            MedicalDocumentType.Other,
          ),
        },
        providerMetadata: { provider: 'TEST', segmentCount: 1 },
      },
    });
    const refresher = new MedicalDocumentAnalysisRefresher(
      repository,
      storage,
      analyzer,
    );

    const result = await refresher.refresh(document);

    expect(result.requestedCategory).toBe(MedicalDocumentType.Prescription);
    expect(result.primaryDetectedCategory).toBeUndefined();
    expect(result.detectedCategories).toEqual([]);
    expect(result.classificationOutcome).toBe(
      MedicalDocumentClassificationOutcome.Unclassified,
    );
    expect(
      result.extractionsByCategory[MedicalDocumentType.Other]?.documentType,
    ).toBe(MedicalDocumentType.Other);
  });

  it('recovers an interrupted JPEG analysis with the original IMAGE input', async () => {
    document = MedicalDocument.create(
      'owner-id',
      ['animal-id'],
      'radiografia.jpeg',
      'image/jpeg',
      100,
      'users/owner-id/medical-document-intake/image-id/source.jpg',
      'image-id',
      MedicalDocumentType.DiagnosticImage,
    );
    document.markAnalyzing();
    analyzer.start.mockResolvedValue('arn:aws:bedrock:job/image');
    analyzer.getResult.mockResolvedValue({
      status: MedicalDocumentAnalysisJobStatus.InProgress,
    });
    const refresher = new MedicalDocumentAnalysisRefresher(
      repository,
      storage,
      analyzer,
    );

    await refresher.refresh(document);

    expect(analyzer.start.mock.calls).toContainEqual([
      's3://bucket/users/owner-id/medical-document-intake/image-id/source.jpg',
      's3://bucket/users/owner-id/medical-document-intake/image-id/analysis-output/image/',
      'image-id',
    ]);
  });

  it('completes a raster when the IMAGE blueprint detects DIAGNOSTIC_IMAGE', async () => {
    document = analyzingRasterDocument();
    analyzer.getResult.mockResolvedValue({
      status: MedicalDocumentAnalysisJobStatus.Succeeded,
      analysis: {
        primaryDetectedCategory: MedicalDocumentType.DiagnosticImage,
        detectedCategories: [
          {
            category: MedicalDocumentType.DiagnosticImage,
            confidence: 0.98,
          },
        ],
        extractionsByCategory: {
          [MedicalDocumentType.DiagnosticImage]: emptyExtraction(
            MedicalDocumentType.DiagnosticImage,
          ),
        },
        providerMetadata: { provider: 'TEST' },
      },
    });
    const refresher = new MedicalDocumentAnalysisRefresher(
      repository,
      storage,
      analyzer,
    );

    const result = await refresher.refresh(document);

    expect(result.status).toBe(MedicalDocumentStatus.ReviewPending);
    expect(result.primaryDetectedCategory).toBe(
      MedicalDocumentType.DiagnosticImage,
    );
    expect(analyzer.start.mock.calls).toHaveLength(0);
  });

  it('sends a non-diagnostic raster to the DOCUMENT blueprints', async () => {
    document = analyzingRasterDocument();
    analyzer.getResult.mockResolvedValue({
      status: MedicalDocumentAnalysisJobStatus.Succeeded,
      analysis: {
        primaryDetectedCategory: undefined,
        detectedCategories: [],
        extractionsByCategory: {
          [MedicalDocumentType.Other]: emptyExtraction(
            MedicalDocumentType.Other,
          ),
        },
        providerMetadata: { provider: 'TEST' },
      },
    });
    analyzer.start.mockResolvedValue('arn:aws:bedrock:job/document-fallback');
    const refresher = new MedicalDocumentAnalysisRefresher(
      repository,
      storage,
      analyzer,
    );

    const result = await refresher.refresh(document);

    expect(result.status).toBe(MedicalDocumentStatus.Analyzing);
    expect(analyzer.start.mock.calls).toContainEqual([
      's3://bucket/users/owner-id/medical-document-intake/image-id/analysis-input.pdf',
      's3://bucket/users/owner-id/medical-document-intake/image-id/analysis-output/document/',
      'image-id-document-fallback',
    ]);
    expect(result.analysisInvocationArn).toBe(
      'arn:aws:bedrock:job/document-fallback',
    );

    analyzer.getResult.mockResolvedValue({
      status: MedicalDocumentAnalysisJobStatus.Succeeded,
      analysis: {
        primaryDetectedCategory: MedicalDocumentType.Prescription,
        detectedCategories: [
          { category: MedicalDocumentType.Prescription, confidence: 0.92 },
        ],
        extractionsByCategory: {
          [MedicalDocumentType.Prescription]: emptyExtraction(
            MedicalDocumentType.Prescription,
          ),
        },
        providerMetadata: { provider: 'TEST' },
      },
    });

    await refresher.refresh(document);

    expect(document.status).toBe(MedicalDocumentStatus.ReviewPending);
    expect(document.primaryDetectedCategory).toBe(
      MedicalDocumentType.Prescription,
    );
    expect(analyzer.start.mock.calls).toHaveLength(1);
  });

  it('uses the DOCUMENT fallback when the IMAGE analysis fails', async () => {
    document = analyzingRasterDocument();
    analyzer.getResult.mockResolvedValue({
      status: MedicalDocumentAnalysisJobStatus.Failed,
      failureReason: 'IMAGE processing failed',
    });
    analyzer.start.mockResolvedValue('arn:aws:bedrock:job/document-fallback');
    const refresher = new MedicalDocumentAnalysisRefresher(
      repository,
      storage,
      analyzer,
    );

    const result = await refresher.refresh(document);

    expect(result.status).toBe(MedicalDocumentStatus.Analyzing);
    expect(result.failureReason).toBeUndefined();
    expect(analyzer.start.mock.calls).toHaveLength(1);
  });

  function analyzingRasterDocument(): MedicalDocument {
    const raster = MedicalDocument.create(
      'owner-id',
      ['animal-id'],
      'radiografia.jpeg',
      'image/jpeg',
      100,
      'users/owner-id/medical-document-intake/image-id/source.jpg',
      'image-id',
    );
    raster.markAnalyzing();
    raster.registerAnalysisJob(
      'arn:aws:bedrock:job/image',
      's3://bucket/users/owner-id/medical-document-intake/image-id/analysis-output/image/',
    );
    return raster;
  }
});

function emptyExtraction(documentType: MedicalDocumentType) {
  return {
    documentType,
    patientHints: [],
    diagnoses: [],
    medications: [],
    vaccinations: [],
    medicalOrders: [],
    additionalFields: {},
    warnings: [],
  };
}
