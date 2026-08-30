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
  const jpegContent = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
    'base64',
  );
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
      putObject: jest
        .fn()
        .mockImplementation((key) => Promise.resolve(`s3://bucket/${key}`)),
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
        `s3://bucket/users/${ownerId}/medical-document-intake/${document.id}/source.pdf`,
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

  it('stores a valid diagnostic JPEG with its image content type', async () => {
    const runner = new MedicalDocumentAnalysisRunner(
      repository,
      storage,
      analyzer,
      animalAccess,
    );
    const document = await runner.run(
      ownerId,
      [animalId],
      {
        originalFileName: 'radiografia.jpeg',
        mimeType: 'image/jpeg',
        size: jpegContent.length,
        content: jpegContent,
      },
      MedicalDocumentType.DiagnosticImage,
    );

    expect(document.status).toBe(MedicalDocumentStatus.Analyzing);
    expect(document.mimeType).toBe('image/jpeg');
    expect(document.requestedCategory).toBe(
      MedicalDocumentType.DiagnosticImage,
    );
    expect(storage.putObject.mock.calls).toContainEqual([
      `users/${ownerId}/medical-document-intake/${document.id}/source.jpg`,
      jpegContent,
      'image/jpeg',
    ]);
    const analysisInputCall = storage.putObject.mock.calls.find(([key]) =>
      key.endsWith('/analysis-input.pdf'),
    );
    expect(analysisInputCall).toBeDefined();
    expect(analysisInputCall?.[2]).toBe('application/pdf');
    expect(
      Buffer.from(analysisInputCall?.[1] || [])
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    expect(analyzer.start.mock.calls).toContainEqual([
      `s3://bucket/users/${ownerId}/medical-document-intake/${document.id}/analysis-input.pdf`,
      `s3://bucket/users/${ownerId}/medical-document-intake/${document.id}/analysis-output/`,
      document.id,
    ]);
  });

  it('cleans both JPEG analysis objects when BDA cannot start', async () => {
    analyzer.start.mockRejectedValue(new Error('BDA unavailable'));
    const runner = new MedicalDocumentAnalysisRunner(
      repository,
      storage,
      analyzer,
      animalAccess,
    );

    await expect(
      runner.run(ownerId, [animalId], {
        originalFileName: 'radiografia.jpeg',
        mimeType: 'image/jpeg',
        size: jpegContent.length,
        content: jpegContent,
      }),
    ).rejects.toThrow('BDA unavailable');

    const savedDocument = repository.save.mock.calls[0][0];
    expect(storage.deleteObject).toHaveBeenCalledWith(
      `users/${ownerId}/medical-document-intake/${savedDocument.id}/source.jpg`,
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(
      `users/${ownerId}/medical-document-intake/${savedDocument.id}/analysis-input.pdf`,
    );
    expect(storage.deletePrefix).toHaveBeenCalledWith(
      `s3://bucket/users/${ownerId}/medical-document-intake/${savedDocument.id}/analysis-output/`,
    );
    expect(savedDocument.temporaryStorageKey).toBeUndefined();
  });
});
