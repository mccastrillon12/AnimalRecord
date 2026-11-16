import { MedicalDocumentAssociationRemover } from '../../../src/context/medical-document/application/medical-document-association-remover';
import { MedicalDocumentAnimalAccess } from '../../../src/context/medical-document/application/medical-document-animal-access';
import { MedicalDocumentRepository } from '../../../src/context/medical-document/domain/medical-document-repository';
import { MedicalDocumentStorage } from '../../../src/context/medical-document/domain/medical-document-storage';
import {
  MedicalDocument,
  MedicalDocumentExtraction,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';

describe('MedicalDocumentAssociationRemover', () => {
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const firstAnimal = '123e4567-e89b-42d3-a456-426614174010';
  const secondAnimal = '123e4567-e89b-42d3-a456-426614174011';
  const extraction: MedicalDocumentExtraction = {
    documentType: MedicalDocumentType.Prescription,
    patientHints: [],
    diagnoses: [],
    medications: [],
    vaccinations: [],
    medicalOrders: [],
    additionalFields: {},
    warnings: [],
  };

  const accepted = (animalIds: string[]): MedicalDocument => {
    const document = MedicalDocument.create(
      ownerId,
      animalIds,
      'formula.pdf',
      'application/pdf',
      100,
      'intake/source.pdf',
      'document-id',
    );
    document.markAnalyzing();
    document.completeAnalysis(
      MedicalDocumentType.Prescription,
      [{ category: MedicalDocumentType.Prescription }],
      { [MedicalDocumentType.Prescription]: extraction },
      { provider: 'TEST' },
    );
    document.accept(
      1,
      MedicalDocumentType.Prescription,
      extraction,
      animalIds.map((animalId) => ({ animalId, extractedItemIds: [] })),
      animalIds.map((animalId) => ({
        animalId,
        storageKey: `final/${animalId}/source.pdf`,
      })),
      { value: 'F-57-01', sequence: 1, countryCode: '57' },
    );
    return document;
  };

  it('removes only the selected association and S3 object', async () => {
    const document = accepted([firstAnimal, secondAnimal]);
    const update = jest.fn().mockResolvedValue(true);
    const deleteRecord = jest.fn();
    const repository = {
      findById: jest.fn().mockResolvedValue(document),
      findActiveReplacementForGroup: jest.fn().mockResolvedValue(null),
      update,
      delete: deleteRecord,
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const storage = {
      getObject: jest.fn().mockResolvedValue(Buffer.from('file')),
      deleteObject,
      putObject: jest.fn().mockResolvedValue('s3://restored'),
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const access = {
      findWritableAnimals: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>;
    const remover = new MedicalDocumentAssociationRemover(
      repository,
      storage,
      access,
    );

    await remover.run(document.id, firstAnimal, ownerId, 2);

    expect(document.animalIds).toEqual([secondAnimal]);
    expect(update).toHaveBeenCalledWith(document, 2);
    expect(deleteRecord).not.toHaveBeenCalled();
    expect(deleteObject).toHaveBeenCalledWith(
      `final/${firstAnimal}/source.pdf`,
    );
  });

  it('removes the database record when the final association is deleted', async () => {
    const document = accepted([firstAnimal]);
    const update = jest.fn();
    const deleteRecord = jest.fn().mockResolvedValue(true);
    const repository = {
      findById: jest.fn().mockResolvedValue(document),
      findActiveReplacementForGroup: jest.fn().mockResolvedValue(null),
      update,
      delete: deleteRecord,
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const storage = {
      getObject: jest.fn().mockResolvedValue(Buffer.from('file')),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      putObject: jest.fn().mockResolvedValue('s3://restored'),
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const remover = new MedicalDocumentAssociationRemover(repository, storage, {
      findWritableAnimals: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>);

    await remover.run(document.id, firstAnimal, ownerId, 2);

    expect(deleteRecord).toHaveBeenCalledWith(document.id, 2);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not touch S3 when the client version is stale', async () => {
    const document = accepted([firstAnimal]);
    const getObject = jest.fn();
    const deleteObject = jest.fn();
    const remover = new MedicalDocumentAssociationRemover(
      {
        findById: jest.fn().mockResolvedValue(document),
      } as unknown as jest.Mocked<MedicalDocumentRepository>,
      {
        getObject,
        deleteObject,
      } as unknown as jest.Mocked<MedicalDocumentStorage>,
      {
        findWritableAnimals: jest.fn().mockResolvedValue(new Map()),
      } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>,
    );

    await expect(
      remover.run(document.id, firstAnimal, ownerId, 1),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(getObject).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
