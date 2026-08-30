import { MedicalDocumentReviewer } from '../../../src/context/medical-document/application/medical-document-reviewer';
import { MedicalDocumentAnimalAccess } from '../../../src/context/medical-document/application/medical-document-animal-access';
import { MedicalDocumentRepository } from '../../../src/context/medical-document/domain/medical-document-repository';
import { MedicalDocumentStorage } from '../../../src/context/medical-document/domain/medical-document-storage';
import {
  MedicalDocument,
  MedicalDocumentExtraction,
  MedicalDocumentRejectionReason,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../src/context/medical-document/domain/medical-document';
import { AnimalRepository } from '../../../src/context/animal/domain/animalRepository';
import { Animal } from '../../../src/context/animal/domain/animal';
import { MedicalDocumentCodeGenerator } from '../../../src/context/medical-document/application/medical-document-code-generator';

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
  const documentCode = {
    value: 'F-57-01',
    sequence: 1,
    countryCode: '57',
  };

  function codeGenerator(): {
    generator: jest.Mocked<MedicalDocumentCodeGenerator>;
    generate: jest.Mock;
  } {
    const generate = jest.fn().mockResolvedValue(documentCode);
    return {
      generator: {
        generate,
      } as unknown as jest.Mocked<MedicalDocumentCodeGenerator>,
      generate,
    };
  }

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
    const { generator, generate } = codeGenerator();
    const reviewer = new MedicalDocumentReviewer(
      repository,
      storage,
      animalRepository,
      animalAccess,
      generator,
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
    expect(accepted.documentCode).toBe('F-57-01');
    expect(accepted.documentSequence).toBe(1);
    expect(accepted.documentCountryCode).toBe('57');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(MedicalDocumentType.Prescription);
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

  it('accepts a diagnostic JPEG into its final S3 folder and removes temporary objects', async () => {
    const diagnosticExtraction: MedicalDocumentExtraction = {
      documentType: MedicalDocumentType.DiagnosticImage,
      patientHints: [],
      diagnoses: [],
      medications: [],
      vaccinations: [],
      medicalOrders: [],
      diagnosticImages: [
        {
          id: 'diagnostic-image-1',
          name: 'Imagen diagnostica',
          studyDate: '05/26/2020',
          reportedDiagnosis: 'Displasia de cadera',
        },
      ],
      additionalFields: {},
      warnings: [],
    };
    const temporaryStorageKey = `users/${ownerId}/medical-document-intake/document-id/source.jpg`;
    const analysisOutputUri = `s3://bucket/users/${ownerId}/medical-document-intake/document-id/analysis-output/`;
    const finalStorageKey = `users/${ownerId}/animals/${animalId}/medical-documents/diagnostic-images/document-id/source.jpg`;
    const document = MedicalDocument.create(
      ownerId,
      [animalId],
      'radiografia.jpeg',
      'image/jpeg',
      100,
      temporaryStorageKey,
      'document-id',
      MedicalDocumentType.DiagnosticImage,
    );
    document.markAnalyzing();
    document.registerAnalysisJob(
      'arn:aws:bedrock:job/diagnostic-image',
      analysisOutputUri,
    );
    document.completeAnalysis(
      MedicalDocumentType.DiagnosticImage,
      [{ category: MedicalDocumentType.DiagnosticImage }],
      { [MedicalDocumentType.DiagnosticImage]: diagnosticExtraction },
      { provider: 'TEST' },
    );

    const animal = Animal.fromPrimitives({
      id: animalId,
      name: 'Gordo',
      species: 'PERRO',
      breed: 'MIXED',
      code: 'AR-C002',
      sex: 'MALE',
      reproductiveStatus: 'NEUTERED',
      hasChip: false,
      isAssociationMember: false,
      temperament: [],
      diagnosis: [],
      ownerId,
    });
    const repository = {
      findById: jest.fn().mockResolvedValue(document),
      update: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const copyObject = jest.fn().mockResolvedValue(undefined);
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const deletePrefix = jest.fn().mockResolvedValue(undefined);
    const storage = {
      copyObject,
      deleteObject,
      deletePrefix,
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const animalRepository = {
      update: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AnimalRepository>;
    const animalAccess = {
      findOwnedAnimals: jest
        .fn()
        .mockResolvedValue(new Map([[animalId, animal]])),
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>;
    const generate = jest.fn().mockResolvedValue({
      value: 'I-57-01',
      sequence: 1,
      countryCode: '57',
    });
    const reviewer = new MedicalDocumentReviewer(
      repository,
      storage,
      animalRepository,
      animalAccess,
      { generate } as unknown as jest.Mocked<MedicalDocumentCodeGenerator>,
    );

    const accepted = await reviewer.accept(
      document.id,
      ownerId,
      1,
      MedicalDocumentType.DiagnosticImage,
      diagnosticExtraction,
      [{ animalId, extractedItemIds: ['diagnostic-image-1'] }],
    );

    expect(accepted.status).toBe(MedicalDocumentStatus.Accepted);
    expect(accepted.mimeType).toBe('image/jpeg');
    expect(accepted.documentCode).toBe('I-57-01');
    expect(accepted.documentLocations).toEqual([
      { animalId, storageKey: finalStorageKey },
    ]);
    expect(accepted.validatedExtraction?.diagnosticImages?.[0]).toEqual(
      expect.objectContaining({
        id: 'diagnostic-image-1',
        reportedDiagnosis: 'Displasia de cadera',
      }),
    );
    expect(generate).toHaveBeenCalledWith(MedicalDocumentType.DiagnosticImage);
    expect(copyObject).toHaveBeenCalledWith(
      temporaryStorageKey,
      finalStorageKey,
    );
    expect(deleteObject).toHaveBeenCalledWith(temporaryStorageKey);
    expect(deletePrefix).toHaveBeenCalledWith(analysisOutputUri);
    expect(accepted.temporaryStorageKey).toBeUndefined();
    expect(accepted.analysisOutputUri).toBeUndefined();
    expect(animal.diagnosis.value).toEqual([]);
  });

  it('accepts a laboratory PDF without applying reported comments as animal diagnoses', async () => {
    const reportedComment =
      'Interpretación escrita por el laboratorio para correlación profesional.';
    const laboratoryExtraction: MedicalDocumentExtraction = {
      documentType: MedicalDocumentType.LaboratoryResult,
      patientHints: [],
      diagnoses: [],
      medications: [],
      vaccinations: [],
      medicalOrders: [],
      diagnosticResults: [],
      laboratoryReport: {
        specimenType: 'Suero',
        reportedComments: [reportedComment],
      },
      laboratoryResults: [
        {
          id: 'laboratory-result-1',
          name: 'Creatinina',
          result: '1.7',
          unit: 'mg/dl',
          referenceRange: '0.5-1.5',
          flag: '*',
        },
      ],
      additionalFields: {},
      warnings: [],
    };
    const temporaryStorageKey = `users/${ownerId}/medical-document-intake/document-id/source.pdf`;
    const analysisOutputUri = `s3://bucket/users/${ownerId}/medical-document-intake/document-id/analysis-output/`;
    const finalStorageKey = `users/${ownerId}/animals/${animalId}/medical-documents/laboratory-results/document-id/source.pdf`;
    const document = MedicalDocument.create(
      ownerId,
      [animalId],
      'resultados.pdf',
      'application/pdf',
      100,
      temporaryStorageKey,
      'document-id',
      MedicalDocumentType.LaboratoryResult,
    );
    document.markAnalyzing();
    document.registerAnalysisJob(
      'arn:aws:bedrock:job/laboratory-result',
      analysisOutputUri,
    );
    document.completeAnalysis(
      MedicalDocumentType.LaboratoryResult,
      [{ category: MedicalDocumentType.LaboratoryResult }],
      { [MedicalDocumentType.LaboratoryResult]: laboratoryExtraction },
      { provider: 'TEST' },
    );

    const animal = Animal.fromPrimitives({
      id: animalId,
      name: 'Albóndiga',
      species: 'PERRO',
      breed: 'MIXED',
      code: 'AR-C003',
      sex: 'FEMALE',
      reproductiveStatus: 'NEUTERED',
      hasChip: false,
      isAssociationMember: false,
      temperament: [],
      diagnosis: [],
      ownerId,
    });
    const repository = {
      findById: jest.fn().mockResolvedValue(document),
      update: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const copyObject = jest.fn().mockResolvedValue(undefined);
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const deletePrefix = jest.fn().mockResolvedValue(undefined);
    const storage = {
      copyObject,
      deleteObject,
      deletePrefix,
    } as unknown as jest.Mocked<MedicalDocumentStorage>;
    const animalRepository = {
      update: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AnimalRepository>;
    const animalAccess = {
      findOwnedAnimals: jest
        .fn()
        .mockResolvedValue(new Map([[animalId, animal]])),
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>;
    const generate = jest.fn().mockResolvedValue({
      value: 'L-57-01',
      sequence: 1,
      countryCode: '57',
    });
    const reviewer = new MedicalDocumentReviewer(
      repository,
      storage,
      animalRepository,
      animalAccess,
      { generate } as unknown as jest.Mocked<MedicalDocumentCodeGenerator>,
    );

    const accepted = await reviewer.accept(
      document.id,
      ownerId,
      1,
      MedicalDocumentType.LaboratoryResult,
      laboratoryExtraction,
      [{ animalId, extractedItemIds: ['laboratory-result-1'] }],
    );

    expect(accepted.status).toBe(MedicalDocumentStatus.Accepted);
    expect(accepted.mimeType).toBe('application/pdf');
    expect(accepted.documentCode).toBe('L-57-01');
    expect(accepted.documentLocations).toEqual([
      { animalId, storageKey: finalStorageKey },
    ]);
    expect(
      accepted.validatedExtraction?.laboratoryReport?.reportedComments,
    ).toEqual([reportedComment]);
    expect(generate).toHaveBeenCalledWith(MedicalDocumentType.LaboratoryResult);
    expect(copyObject).toHaveBeenCalledWith(
      temporaryStorageKey,
      finalStorageKey,
    );
    expect(deleteObject).toHaveBeenCalledWith(temporaryStorageKey);
    expect(deletePrefix).toHaveBeenCalledWith(analysisOutputUri);
    expect(accepted.temporaryStorageKey).toBeUndefined();
    expect(accepted.analysisOutputUri).toBeUndefined();
    expect(animal.diagnosis.value).toEqual([]);
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
      codeGenerator().generator,
    );

    await reviewer.reject(
      document.id,
      ownerId,
      1,
      MedicalDocumentRejectionReason.WrongAnimal,
    );

    expect(storage.deleteObject.mock.calls).toEqual([
      [`users/${ownerId}/medical-document-intake/document-id/source.pdf`],
    ]);
    expect(document.temporaryStorageKey).toBeUndefined();
    expect(document.rejectionReason).toBe(
      MedicalDocumentRejectionReason.WrongAnimal,
    );
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
      codeGenerator().generator,
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
      codeGenerator().generator,
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
