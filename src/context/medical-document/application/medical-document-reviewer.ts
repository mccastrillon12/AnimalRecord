import { Inject, Injectable } from '@nestjs/common';
import {
  MedicalDocument,
  MedicalDocumentAssignment,
  MedicalDocumentExtraction,
  MedicalDocumentLocation,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../domain/medical-document';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocumentStorage } from '../domain/medical-document-storage';
import { AnimalRepository } from '../../animal/domain/animalRepository';
import { MedicalDocumentAnimalAccess } from './medical-document-animal-access';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  buildLegacyMedicalDocumentStorageKeys,
  buildMedicalDocumentLocations,
  getMedicalDocumentSourceFileName,
} from './medical-document-storage-key';
import { MedicalDocumentCodeGenerator } from './medical-document-code-generator';

@Injectable()
export class MedicalDocumentReviewer {
  constructor(
    @Inject('MedicalDocumentRepository')
    private readonly repository: MedicalDocumentRepository,
    @Inject('MedicalDocumentStorage')
    private readonly storage: MedicalDocumentStorage,
    @Inject('AnimalRepository')
    private readonly animalRepository: AnimalRepository,
    private readonly animalAccess: MedicalDocumentAnimalAccess,
    private readonly codeGenerator: MedicalDocumentCodeGenerator,
  ) {}

  async accept(
    documentId: string,
    ownerId: string,
    expectedVersion: number,
    finalCategory: MedicalDocumentType,
    extraction: MedicalDocumentExtraction,
    assignments: MedicalDocumentAssignment[],
  ): Promise<MedicalDocument> {
    const document = await this.findOwnedDocument(documentId, ownerId);
    if (document.status === MedicalDocumentStatus.Accepted) {
      if (document.temporaryStorageKey || document.analysisOutputUri) {
        await this.cleanupSourceObjects(document);
      }
      await this.applyAcceptedDiagnoses(document, ownerId);
      return document;
    }

    document.validateAcceptance(
      expectedVersion,
      finalCategory,
      extraction,
      assignments,
    );

    const sourceKey = document.temporaryStorageKey || document.storageKey;
    const locations = buildMedicalDocumentLocations(
      document.ownerId,
      document.animalIds,
      finalCategory,
      document.id,
      getMedicalDocumentSourceFileName(sourceKey),
    );
    const copiedLocations: MedicalDocumentLocation[] = [];

    try {
      for (const location of locations) {
        await this.storage.copyObject(sourceKey, location.storageKey);
        copiedLocations.push(location);
      }
    } catch (error) {
      await this.deleteLocations(copiedLocations);
      throw error;
    }

    try {
      const documentCode = await this.codeGenerator.generate(finalCategory);
      document.accept(
        expectedVersion,
        finalCategory,
        extraction,
        assignments,
        locations,
        documentCode,
      );
      const updated = await this.repository.update(document, expectedVersion);
      if (!updated) {
        throw new ConflictError('The document was modified by another request');
      }
    } catch (error) {
      await this.deleteUncommittedLocations(document.id, copiedLocations);
      throw error;
    }

    await this.cleanupSourceObjects(document);
    await this.applyAcceptedDiagnoses(document, ownerId);
    return document;
  }

  async reject(
    documentId: string,
    ownerId: string,
    expectedVersion: number,
  ): Promise<MedicalDocument> {
    const document = await this.findOwnedDocument(documentId, ownerId);
    if (document.status === MedicalDocumentStatus.Rejected) {
      if (document.temporaryStorageKey || document.analysisOutputUri) {
        await this.cleanupSourceObjects(document);
      }
      return document;
    }

    document.reject(expectedVersion);
    const updated = await this.repository.update(document, expectedVersion);
    if (!updated) {
      throw new ConflictError('The document was modified by another request');
    }

    await this.cleanupSourceObjects(document);
    return document;
  }

  private sourceStorageKeys(document: MedicalDocument): string[] {
    if (document.temporaryStorageKey) {
      return [document.temporaryStorageKey];
    }

    return [
      ...new Set([
        document.storageKey,
        ...buildLegacyMedicalDocumentStorageKeys(
          document.ownerId,
          document.animalIds,
          document.id,
          getMedicalDocumentSourceFileName(document.storageKey),
        ),
      ]),
    ];
  }

  private async cleanupSourceObjects(document: MedicalDocument): Promise<void> {
    try {
      if (document.analysisOutputUri) {
        await this.storage.deletePrefix(document.analysisOutputUri);
      }
      for (const storageKey of this.sourceStorageKeys(document)) {
        await this.storage.deleteObject(storageKey);
      }
      if (document.temporaryStorageKey || document.analysisOutputUri) {
        document.clearTemporaryStorage();
        document.clearAnalysisJob();
        await this.repository.update(document);
      }
    } catch {
      // The persisted source key allows cleanup to be retried safely.
    }
  }

  private async deleteLocations(
    locations: MedicalDocumentLocation[],
  ): Promise<void> {
    await Promise.all(
      locations.map((location) =>
        this.storage.deleteObject(location.storageKey).catch(() => undefined),
      ),
    );
  }

  private async deleteUncommittedLocations(
    documentId: string,
    locations: MedicalDocumentLocation[],
  ): Promise<void> {
    let protectedStorageKeys = new Set<string>();
    try {
      const persistedDocument = await this.repository.findById(documentId);
      if (persistedDocument?.status === MedicalDocumentStatus.Accepted) {
        protectedStorageKeys = new Set(
          persistedDocument.documentLocations.map(
            (location) => location.storageKey,
          ),
        );
      }
    } catch {
      // If persistence cannot be checked, leave copies for a later cleanup job.
      return;
    }

    await this.deleteLocations(
      locations.filter(
        (location) => !protectedStorageKeys.has(location.storageKey),
      ),
    );
  }

  private async findOwnedDocument(
    documentId: string,
    ownerId: string,
  ): Promise<MedicalDocument> {
    const document = await this.repository.findById(documentId);
    if (!document) {
      throw new ResourceNotFoundError(
        `Medical document with id ${documentId} not found`,
      );
    }
    if (document.ownerId !== ownerId) {
      throw new ForbiddenError(
        'The medical document does not belong to the user',
      );
    }
    return document;
  }

  private async applyAcceptedDiagnoses(
    document: MedicalDocument,
    ownerId: string,
  ): Promise<void> {
    if (!document.validatedExtraction) {
      throw new ConflictError(
        'The accepted document has no validated extraction',
      );
    }

    const animals = await this.animalAccess.findOwnedAnimals(
      document.animalIds,
      ownerId,
    );
    const diagnosesById = new Map(
      document.validatedExtraction.diagnoses.map((diagnosis) => [
        diagnosis.id,
        diagnosis.name,
      ]),
    );

    for (const assignment of document.assignments) {
      const animal = animals.get(assignment.animalId)!;
      const diagnoses = assignment.extractedItemIds
        .map((itemId) => diagnosesById.get(itemId))
        .filter((diagnosis): diagnosis is string => Boolean(diagnosis));
      animal.addDiagnoses(diagnoses);
      await this.animalRepository.update(animal);
    }
  }
}
