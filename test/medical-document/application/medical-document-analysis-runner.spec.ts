import { MedicalDocumentAnalysisRunner } from '../../../src/context/medical-document/application/medical-document-analysis-runner';
import { MedicalDocumentAnimalAccess } from '../../../src/context/medical-document/application/medical-document-animal-access';
import { MedicalDocumentAnalyzer } from '../../../src/context/medical-document/domain/medical-document-analyzer';
import { MedicalDocumentRepository } from '../../../src/context/medical-document/domain/medical-document-repository';
import { MedicalDocumentStorage } from '../../../src/context/medical-document/domain/medical-document-storage';
import {
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';

describe('MedicalDocumentAnalysisRunner', () => {
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const animalId = '123e4567-e89b-42d3-a456-426614174000';
  let repository: jest.Mocked<MedicalDocumentRepository>;
  let storage: jest.Mocked<MedicalDocumentStorage>;
  let analyzer: jest.Mocked<MedicalDocumentAnalyzer>;
  let animalAccess: jest.Mocked<MedicalDocumentAnimalAccess>;

  beforeEach(() => {
    repository = {
      save: jest
        .fn()
        .mockImplementation((document) => Promise.resolve(document)),
      findById: jest.fn(),
      findAcceptedByAnimalId: jest.fn(),
      update: jest.fn().mockResolvedValue(true),
    };
    storage = {
      putObject: jest.fn().mockResolvedValue('s3://bucket/document.pdf'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      generateDownloadUrl: jest.fn(),
    };
    analyzer = {
      analyze: jest.fn().mockResolvedValue({
        extraction: {
          documentType: MedicalDocumentType.Prescription,
          patientHints: [],
          diagnoses: [],
          medications: [],
          vaccinations: [],
          medicalOrders: [],
          additionalFields: {},
          warnings: [],
        },
        providerMetadata: { provider: 'TEST' },
      }),
    };
    animalAccess = {
      findOwnedAnimals: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>;
  });

  it('stores and analyzes a valid PDF synchronously', async () => {
    const runner = new MedicalDocumentAnalysisRunner(
      repository,
      storage,
      analyzer,
      animalAccess,
    );
    const pdfContent = Buffer.from('%PDF-1.7 test');

    const document = await runner.run(ownerId, [animalId], {
      originalFileName: 'formula.pdf',
      mimeType: 'application/pdf',
      size: pdfContent.length,
      content: pdfContent,
    });

    expect(document.status).toBe(MedicalDocumentStatus.ReviewPending);
    expect(storage.putObject.mock.calls).toHaveLength(1);
    expect(analyzer.analyze.mock.calls).toEqual([['s3://bucket/document.pdf']]);
    expect(repository.update.mock.calls).toHaveLength(2);
  });
});
