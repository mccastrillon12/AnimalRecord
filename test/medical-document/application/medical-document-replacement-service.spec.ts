import { MedicalDocumentReplacementService } from '../../../src/context/medical-document/application/medical-document-replacement-service';
import { MedicalDocumentAnalysisRunner } from '../../../src/context/medical-document/application/medical-document-analysis-runner';
import { MedicalDocumentCodeGenerator } from '../../../src/context/medical-document/application/medical-document-code-generator';
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

describe('MedicalDocumentReplacementService per animal', () => {
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const brownieId = '123e4567-e89b-42d3-a456-426614174010';
  const spotId = '123e4567-e89b-42d3-a456-426614174011';
  const groupId = '123e4567-e89b-42d3-a456-426614174020';
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

  const analyzed = (
    id: string,
    animalIds: string[],
    fileName: string,
    description?: string,
    replacementOfDocumentId?: string,
  ): MedicalDocument => {
    const document = MedicalDocument.create(
      ownerId,
      animalIds,
      fileName,
      'application/pdf',
      100,
      `intake/${id}/source.pdf`,
      id,
      MedicalDocumentType.Prescription,
      description,
      replacementOfDocumentId,
      groupId,
    );
    document.markAnalyzing();
    document.completeAnalysis(
      MedicalDocumentType.Prescription,
      [{ category: MedicalDocumentType.Prescription }],
      { [MedicalDocumentType.Prescription]: extraction },
      { provider: 'TEST' },
    );
    return document;
  };

  const accepted = (
    id: string,
    animalId: string,
    sequence: number,
  ): MedicalDocument => {
    const document = analyzed(id, [animalId], 'original.pdf', 'Anterior');
    document.accept(
      1,
      MedicalDocumentType.Prescription,
      extraction,
      [{ animalId, extractedItemIds: [] }],
      [{ animalId, storageKey: `old/${animalId}/source.pdf` }],
      { value: `F-57-0${sequence}`, sequence, countryCode: '57' },
    );
    return document;
  };

  const dependencies = () => ({
    animalRepository: {
      update: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AnimalRepository>,
    animalAccess: {
      findOwnedAnimals: jest.fn().mockResolvedValue(
        new Map([
          [brownieId, { addDiagnoses: jest.fn() }],
          [spotId, { addDiagnoses: jest.fn() }],
        ]),
      ),
    } as unknown as jest.Mocked<MedicalDocumentAnimalAccess>,
    codeGenerator: {
      generate: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MedicalDocumentCodeGenerator>,
  });

  it('starts one analysis only for the animals selected by the user', async () => {
    const brownie = accepted('brownie-document', brownieId, 1);
    const spot = accepted('spot-document', spotId, 2);
    const candidate = analyzed(
      'candidate-id',
      [brownieId],
      'replacement.pdf',
      'Descripción nueva',
      brownie.id,
    );
    const runAnalysis = jest.fn().mockResolvedValue(candidate);
    const repository = {
      findById: jest.fn().mockResolvedValue(brownie),
      findAcceptedByGroupId: jest.fn().mockResolvedValue([brownie, spot]),
      findActiveReplacementForGroup: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const deps = dependencies();
    const service = new MedicalDocumentReplacementService(
      repository,
      {} as MedicalDocumentStorage,
      { run: runAnalysis } as unknown as MedicalDocumentAnalysisRunner,
      deps.animalRepository,
      deps.animalAccess,
      deps.codeGenerator,
    );
    const file = {
      originalFileName: 'replacement.pdf',
      mimeType: 'application/pdf',
      size: 100,
      content: new Uint8Array([1]),
    };

    await service.start(
      brownie.id,
      ownerId,
      brownie.version,
      [brownieId],
      'Descripción nueva',
      file,
    );

    expect(runAnalysis).toHaveBeenCalledWith(
      ownerId,
      [brownieId],
      file,
      MedicalDocumentType.Prescription,
      'Descripción nueva',
      brownie.id,
      groupId,
    );
  });

  it('updates Brownie while Spot keeps the previous file and reading', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-14T10:00:00.000Z'));
    try {
      const brownie = accepted('brownie-document', brownieId, 1);
      const spot = accepted('spot-document', spotId, 2);
      const candidate = analyzed(
        'candidate-id',
        [brownieId],
        'replacement.pdf',
        'Descripción nueva',
        brownie.id,
      );
      const updateManyAtomically = jest.fn().mockResolvedValue(true);
      const repository = {
        findById: jest.fn((id: string) =>
          Promise.resolve(id === candidate.id ? candidate : brownie),
        ),
        findAcceptedByGroupId: jest.fn().mockResolvedValue([brownie, spot]),
        updateManyAtomically,
        update: jest.fn().mockResolvedValue(true),
      } as unknown as jest.Mocked<MedicalDocumentRepository>;
      const copyObject = jest.fn().mockResolvedValue(undefined);
      const deleteObject = jest.fn().mockResolvedValue(undefined);
      const deps = dependencies();
      const service = new MedicalDocumentReplacementService(
        repository,
        {
          copyObject,
          deleteObject,
          deletePrefix: jest.fn().mockResolvedValue(undefined),
        } as unknown as MedicalDocumentStorage,
        {} as MedicalDocumentAnalysisRunner,
        deps.animalRepository,
        deps.animalAccess,
        deps.codeGenerator,
      );

      const updated = await service.accept(
        brownie.id,
        candidate.id,
        ownerId,
        brownie.version,
        candidate.version,
        [{ documentId: brownie.id, version: brownie.version }],
        extraction,
        [{ animalId: brownieId, extractedItemIds: [] }],
      );

      expect(updated).toEqual([brownie]);
      expect(brownie.originalFileName).toBe('replacement.pdf');
      expect(brownie.description).toBe('Descripción nueva');
      expect(spot.originalFileName).toBe('original.pdf');
      expect(spot.description).toBe('Anterior');
      expect(spot.version).toBe(2);
      expect(copyObject).toHaveBeenCalledTimes(1);
      expect(deleteObject).toHaveBeenCalledWith(`old/${brownieId}/source.pdf`);
      expect(deleteObject).not.toHaveBeenCalledWith(`old/${spotId}/source.pdf`);
      expect(updateManyAtomically).toHaveBeenCalledTimes(1);
      expect(candidate.status).toBe(MedicalDocumentStatus.Rejected);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects the candidate and leaves every animal unchanged', async () => {
    const brownie = accepted('brownie-document', brownieId, 1);
    const spot = accepted('spot-document', spotId, 2);
    const candidate = analyzed(
      'candidate-id',
      [brownieId],
      'replacement.pdf',
      'Descripción nueva',
      brownie.id,
    );
    const repository = {
      findById: jest.fn((id: string) =>
        Promise.resolve(id === candidate.id ? candidate : brownie),
      ),
      findAcceptedByGroupId: jest.fn().mockResolvedValue([brownie, spot]),
      update: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<MedicalDocumentRepository>;
    const deps = dependencies();
    const service = new MedicalDocumentReplacementService(
      repository,
      {
        deleteObject: jest.fn().mockResolvedValue(undefined),
        deletePrefix: jest.fn().mockResolvedValue(undefined),
      } as unknown as MedicalDocumentStorage,
      {} as MedicalDocumentAnalysisRunner,
      deps.animalRepository,
      deps.animalAccess,
      deps.codeGenerator,
    );

    const unchanged = await service.reject(
      brownie.id,
      candidate.id,
      ownerId,
      brownie.version,
      candidate.version,
    );

    expect(unchanged).toEqual([brownie]);
    expect(brownie.originalFileName).toBe('original.pdf');
    expect(spot.originalFileName).toBe('original.pdf');
    expect(candidate.status).toBe(MedicalDocumentStatus.Rejected);
  });
});
