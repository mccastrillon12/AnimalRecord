import { MedicalDocumentAnalysisRefresher } from '../../../src/context/medical-document/application/medical-document-analysis-refresher';
import {
  MedicalDocument,
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
