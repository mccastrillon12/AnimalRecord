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
  const secondAnimalId = '123e4567-e89b-42d3-a456-426614174002';
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
      copyObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      objectUri: jest.fn().mockImplementation((key) => `s3://bucket/${key}`),
      listJsonObjects: jest.fn(),
      deletePrefix: jest.fn(),
      generateDownloadUrl: jest.fn(),
    };
    analyzer = {
      start: jest.fn().mockResolvedValue('arn:aws:bedrock:job/123'),
      getResult: jest.fn(),
    };
    animalAccess = {
      findOwnedAnimals: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>;
  });

  it('stores a valid PDF and starts its asynchronous analysis', async () => {
    const runner = new MedicalDocumentAnalysisRunner(
      repository,
      storage,
      analyzer,
      animalAccess,
    );
    const pdfContent = Buffer.from('%PDF-1.7 test');

    const document = await runner.run(
      ownerId,
      [animalId, secondAnimalId],
      {
        originalFileName: 'formula.pdf',
        mimeType: 'application/pdf',
        size: pdfContent.length,
        content: pdfContent,
      },
      MedicalDocumentType.Prescription,
    );

    expect(document.status).toBe(MedicalDocumentStatus.Analyzing);
    expect(storage.putObject.mock.calls).toHaveLength(1);
    expect(storage.putObject.mock.calls[0][0]).toBe(
      `users/${ownerId}/medical-document-intake/${document.id}/source.pdf`,
    );
    expect(analyzer.start.mock.calls).toEqual([
      [
        's3://bucket/document.pdf',
        `s3://bucket/users/${ownerId}/medical-document-intake/${document.id}/analysis-output/`,
        document.id,
      ],
    ]);
    expect(document.requestedCategory).toBe(MedicalDocumentType.Prescription);
    expect(document.primaryDetectedCategory).toBeUndefined();
    expect(document.analysisInvocationArn).toBe('arn:aws:bedrock:job/123');
    expect(document.temporaryStorageKey).toBe(
      `users/${ownerId}/medical-document-intake/${document.id}/source.pdf`,
    );
    expect(document.documentLocations).toEqual([]);
    expect(repository.update.mock.calls).toHaveLength(2);
  });
});
