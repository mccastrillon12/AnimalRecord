import { MedicalDocumentReviewer } from '../../../src/context/medical-document/application/medical-document-reviewer';
import { MedicalDocumentAnimalAccess } from '../../../src/context/medical-document/application/medical-document-animal-access';
import { MedicalDocumentRepository } from '../../../src/context/medical-document/domain/medical-document-repository';
import { MedicalDocumentStorage } from '../../../src/context/medical-document/domain/medical-document-storage';
import {
  MedicalDocument,
  MedicalDocumentExtraction,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';
import { AnimalRepository } from '../../../src/context/animal/domain/animalRepository';
import { Animal } from '../../../src/context/animal/domain/animal';

describe('MedicalDocumentReviewer', () => {
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const animalId = '123e4567-e89b-42d3-a456-426614174000';
  const secondAnimalId = '123e4567-e89b-42d3-a456-426614174002';
  const extraction: MedicalDocumentExtraction = {
    documentType: MedicalDocumentType.Prescription,
    patientHints: [],
    diagnoses: [{ id: 'diagnosis-1', name: 'Dermatitis' }],
    medications: [],
    vaccinations: [],
    medicalOrders: [],
    additionalFields: {},
    warnings: [],
  };

  it('persists the versioned acceptance before applying diagnoses and can retry safely', async () => {
    const document = MedicalDocument.create(
      ownerId,
      [animalId],
      'formula.pdf',
      'application/pdf',
      100,
      `users/${ownerId}/medical-document-intake/document-id/source.pdf`,
      'document-id',
    );
    document.markAnalyzing();
    document.registerAnalysisJob(
      'arn:aws:bedrock:job/123',
      `s3://bucket/users/${ownerId}/medical-document-intake/document-id/analysis-output/`,
    );
    document.completeAnalysis(
      MedicalDocumentType.Prescription,
      [{ category: MedicalDocumentType.Prescription }],
      { [MedicalDocumentType.Prescription]: extraction },
      { provider: 'TEST' },
    );

    const animal = Animal.fromPrimitives({
      id: animalId,
      name: 'Buddy',
      species: 'PERRO',
      breed: 'MIXED',
      code: 'AR-C001',
      sex: 'MALE',
      reproductiveStatus: 'NEUTERED',
      hasChip: false,
      isAssociationMember: false,
      temperament: [],
      diagnosis: [],
      ownerId,
    });

    const updateDocument = jest.fn().mockResolvedValue(true);
    const updateAnimal = jest.fn().mockResolvedValue(true);
    const repository = {
      save: jest.fn(),
      findById: jest.fn().mockResolvedValue(document),
      findAcceptedByAnimalId: jest.fn(),
      update: updateDocument,
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const copyObject = jest.fn().mockResolvedValue(undefined);
    const deleteObject = jest.fn();
    const deletePrefix = jest.fn();
    const storage = {
      putObject: jest.fn(),
      copyObject,
      deleteObject,
      deletePrefix,
      generateDownloadUrl: jest.fn(),
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const animalRepository = {
      update: updateAnimal,
    } as unknown as jest.Mocked<AnimalRepository>;
    const animalAccess = {
      findOwnedAnimals: jest
        .fn()
        .mockResolvedValue(new Map([[animalId, animal]])),
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>;
    const reviewer = new MedicalDocumentReviewer(
      repository,
      storage,
      animalRepository,
      animalAccess,
    );
    const assignments = [{ animalId, extractedItemIds: ['diagnosis-1'] }];

    const accepted = await reviewer.accept(
      document.id,
      ownerId,
      1,
      MedicalDocumentType.Prescription,
      extraction,
      assignments,
    );
    await reviewer.accept(
      document.id,
      ownerId,
      1,
      MedicalDocumentType.Prescription,
      extraction,
      assignments,
    );

    expect(accepted.status).toBe(MedicalDocumentStatus.Accepted);
    expect(copyObject).toHaveBeenCalledWith(
      `users/${ownerId}/medical-document-intake/document-id/source.pdf`,
      `users/${ownerId}/animals/${animalId}/medical-documents/prescriptions/document-id/source.pdf`,
    );
    expect(accepted.documentLocations).toEqual([
      {
        animalId,
        storageKey: `users/${ownerId}/animals/${animalId}/medical-documents/prescriptions/document-id/source.pdf`,
      },
    ]);
    expect(accepted.temporaryStorageKey).toBeUndefined();
    expect(deleteObject).toHaveBeenCalledWith(
      `users/${ownerId}/medical-document-intake/document-id/source.pdf`,
    );
    expect(deletePrefix).toHaveBeenCalledWith(
      `s3://bucket/users/${ownerId}/medical-document-intake/document-id/analysis-output/`,
    );
    expect(accepted.analysisOutputUri).toBeUndefined();
    expect(updateDocument.mock.invocationCallOrder[0]).toBeLessThan(
      updateAnimal.mock.invocationCallOrder[0],
    );
    expect(animal.diagnosis.value).toEqual(['Dermatitis']);
  });

  it('deletes only the temporary source when rejected', async () => {
    const document = MedicalDocument.create(
      ownerId,
      [animalId, secondAnimalId],
      'formula.pdf',
      'application/pdf',
      100,
      `users/${ownerId}/medical-document-intake/document-id/source.pdf`,
      'document-id',
    );
    document.markAnalyzing();
    document.completeAnalysis(
      MedicalDocumentType.Prescription,
      [{ category: MedicalDocumentType.Prescription }],
      { [MedicalDocumentType.Prescription]: extraction },
      { provider: 'TEST' },
    );

    const repository = {
      findById: jest.fn().mockResolvedValue(document),
      update: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const storage = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
      deletePrefix: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const reviewer = new MedicalDocumentReviewer(
      repository,
      storage,
      {} as jest.Mocked<AnimalRepository>,
      {} as jest.Mocked<MedicalDocumentAnimalAccess>,
    );

    await reviewer.reject(document.id, ownerId, 1);

    expect(storage.deleteObject.mock.calls).toEqual([
      [`users/${ownerId}/medical-document-intake/document-id/source.pdf`],
    ]);
    expect(document.temporaryStorageKey).toBeUndefined();
  });

  it('removes completed final copies when a later animal copy fails', async () => {
    const document = MedicalDocument.create(
      ownerId,
      [animalId, secondAnimalId],
      'formula.pdf',
      'application/pdf',
      100,
      `users/${ownerId}/medical-document-intake/document-id/source.pdf`,
      'document-id',
    );
    document.markAnalyzing();
    document.completeAnalysis(
      MedicalDocumentType.Prescription,
      [{ category: MedicalDocumentType.Prescription }],
      { [MedicalDocumentType.Prescription]: extraction },
      { provider: 'TEST' },
    );

    const updateDocument = jest.fn();
    const repository = {
      findById: jest.fn().mockResolvedValue(document),
      update: updateDocument,
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const copyObject = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('copy failed'));
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const storage = {
      copyObject,
      deleteObject,
      deletePrefix: jest.fn(),
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const reviewer = new MedicalDocumentReviewer(
      repository,
      storage,
      {} as jest.Mocked<AnimalRepository>,
      {} as jest.Mocked<MedicalDocumentAnimalAccess>,
    );

    await expect(
      reviewer.accept(
        document.id,
        ownerId,
        1,
        MedicalDocumentType.Prescription,
        extraction,
        [
          { animalId, extractedItemIds: ['diagnosis-1'] },
          { animalId: secondAnimalId, extractedItemIds: ['diagnosis-1'] },
        ],
      ),
    ).rejects.toThrow('copy failed');

    expect(document.status).toBe(MedicalDocumentStatus.ReviewPending);
    expect(updateDocument).not.toHaveBeenCalled();
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(
      `users/${ownerId}/animals/${animalId}/medical-documents/prescriptions/document-id/source.pdf`,
    );
  });

  it('does not delete final objects committed by a concurrent acceptance', async () => {
    const temporaryStorageKey = `users/${ownerId}/medical-document-intake/document-id/source.pdf`;
    const finalStorageKey = `users/${ownerId}/animals/${animalId}/medical-documents/prescriptions/document-id/source.pdf`;
    const document = MedicalDocument.create(
      ownerId,
      [animalId],
      'formula.pdf',
      'application/pdf',
      100,
      temporaryStorageKey,
      'document-id',
    );
    document.markAnalyzing();
    document.completeAnalysis(
      MedicalDocumentType.Prescription,
      [{ category: MedicalDocumentType.Prescription }],
      { [MedicalDocumentType.Prescription]: extraction },
      { provider: 'TEST' },
    );

    const concurrentlyAccepted = MedicalDocument.fromPrimitives({
      ...document.toPrimitives(),
      status: MedicalDocumentStatus.Accepted,
      finalCategory: MedicalDocumentType.Prescription,
      validatedExtraction: extraction,
      assignments: [{ animalId, extractedItemIds: ['diagnosis-1'] }],
      documentLocations: [{ animalId, storageKey: finalStorageKey }],
      temporaryStorageKey: undefined,
      version: 2,
    });
    const repository = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(document)
        .mockResolvedValueOnce(concurrentlyAccepted),
      update: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const copyObject = jest.fn().mockResolvedValue(undefined);
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const storage = {
      copyObject,
      deleteObject,
      deletePrefix: jest.fn(),
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const reviewer = new MedicalDocumentReviewer(
      repository,
      storage,
      {} as jest.Mocked<AnimalRepository>,
      {} as jest.Mocked<MedicalDocumentAnimalAccess>,
    );

    await expect(
      reviewer.accept(
        document.id,
        ownerId,
        1,
        MedicalDocumentType.Prescription,
        extraction,
        [{ animalId, extractedItemIds: ['diagnosis-1'] }],
      ),
    ).rejects.toThrow('modified by another request');

    expect(copyObject).toHaveBeenCalledWith(
      temporaryStorageKey,
      finalStorageKey,
    );
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
