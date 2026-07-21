import { Inject, Injectable } from '@nestjs/common';
import {
  MedicalDocument,
  MedicalDocumentAssignment,
  MedicalDocumentExtraction,
  MedicalDocumentStatus,
} from '../domain/medical-document';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocumentStorage } from '../domain/medical-document-storage';
import { AnimalRepository } from '../../animal/domain/animalRepository';
import { MedicalDocumentAnimalAccess } from './medical-document-animal-access';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';

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
  ) {}

  async accept(
    documentId: string,
    ownerId: string,
    expectedVersion: number,
    extraction: MedicalDocumentExtraction,
    assignments: MedicalDocumentAssignment[],
  ): Promise<MedicalDocument> {
    const document = await this.findOwnedDocument(documentId, ownerId);
    if (document.status === MedicalDocumentStatus.Accepted) {
      await this.applyAcceptedDiagnoses(document, ownerId);
      return document;
    }

    document.accept(expectedVersion, extraction, assignments);
    const updated = await this.repository.update(document, expectedVersion);
    if (!updated) {
      throw new ConflictError('The document was modified by another request');
    }

    await this.applyAcceptedDiagnoses(document, ownerId);
    return document;
  }

  async reject(
    documentId: string,
    ownerId: string,
    expectedVersion: number,
  ): Promise<MedicalDocument> {
    const document = await this.findOwnedDocument(documentId, ownerId);
    if (document.status === MedicalDocumentStatus.Rejected) return document;

    document.reject(expectedVersion);
    const updated = await this.repository.update(document, expectedVersion);
    if (!updated) {
      throw new ConflictError('The document was modified by another request');
    }

    await this.storage.deleteObject(document.storageKey).catch(() => undefined);
    return document;
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
