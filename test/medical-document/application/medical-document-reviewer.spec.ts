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
      'users/owner/document.pdf',
    );
    document.markAnalyzing();
    document.completeAnalysis(extraction, { provider: 'TEST' });

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
    const storage = {
      putObject: jest.fn(),
      deleteObject: jest.fn(),
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
      extraction,
      assignments,
    );
    await reviewer.accept(document.id, ownerId, 1, extraction, assignments);

    expect(accepted.status).toBe(MedicalDocumentStatus.Accepted);
    expect(updateDocument.mock.invocationCallOrder[0]).toBeLessThan(
      updateAnimal.mock.invocationCallOrder[0],
    );
    expect(animal.diagnosis.value).toEqual(['Dermatitis']);
  });
});
