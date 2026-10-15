import { Inject, Injectable } from '@nestjs/common';
import {
  MedicalDocument,
  MedicalDocumentAssignment,
  MedicalDocumentExtraction,
  MedicalDocumentLocation,
  MedicalDocumentStatus,
} from '../domain/medical-document';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocumentStorage } from '../domain/medical-document-storage';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import {
  MedicalDocumentAnalysisRunner,
  MedicalDocumentUpload,
} from './medical-document-analysis-runner';
import {
  buildMedicalDocumentAnalysisInputStorageKey,
  buildMedicalDocumentReplacementLocations,
  getMedicalDocumentSourceFileName,
} from './medical-document-storage-key';
import { requiresPdfAnalysisInput } from './medical-document-analysis-input';
import { AnimalRepository } from '../../animal/domain/animalRepository';
import { MedicalDocumentAnimalAccess } from './medical-document-animal-access';
import { MedicalDocumentCodeGenerator } from './medical-document-code-generator';

export type MedicalDocumentReplacementVersion = {
  documentId: string;
  version: number;
};

@Injectable()
export class MedicalDocumentReplacementService {
  constructor(
    @Inject('MedicalDocumentRepository')
    private readonly repository: MedicalDocumentRepository,
    @Inject('MedicalDocumentStorage')
    private readonly storage: MedicalDocumentStorage,
    private readonly analysisRunner: MedicalDocumentAnalysisRunner,
    @Inject('AnimalRepository')
    private readonly animalRepository: AnimalRepository,
    private readonly animalAccess: MedicalDocumentAnimalAccess,
    private readonly codeGenerator: MedicalDocumentCodeGenerator,
  ) {}

  async relatedDocuments(
    documentId: string,
    ownerId: string,
  ): Promise<MedicalDocument[]> {
    const document = await this.findOwnedDocument(documentId, ownerId);
    return this.ensureIndividualGroupDocuments(document);
  }

  async start(
    documentId: string,
    ownerId: string,
    expectedVersion: number,
    animalIds: string[],
    description: string | undefined,
    file: MedicalDocumentUpload,
  ): Promise<MedicalDocument> {
    const original = await this.findOwnedDocument(documentId, ownerId);
    if (original.version !== expectedVersion) {
      throw new ConflictError('The document was modified by another request');
    }
    const groupDocuments = await this.ensureIndividualGroupDocuments(original);
    const uniqueAnimalIds = [...new Set(animalIds)];
    const documentsByAnimal = new Map(
      groupDocuments.map((document) => [document.animalIds[0], document]),
    );
    if (
      uniqueAnimalIds.length === 0 ||
      uniqueAnimalIds.some((animalId) => !documentsByAnimal.has(animalId))
    ) {
      throw new ConflictError(
        'Replacement animals must belong to the current document group',
      );
    }
    const selectedDocuments = uniqueAnimalIds.map(
      (animalId) => documentsByAnimal.get(animalId)!,
    );
    for (const document of selectedDocuments) {
      document.assertReplacementAllowed();
      if (document.finalCategory !== original.finalCategory) {
        throw new ConflictError(
          'All selected documents must have the same final category',
        );
      }
    }
    const active = await this.repository.findActiveReplacementForGroup(
      original.documentGroupId,
    );
    if (active) {
      throw new ConflictError(
        `Replacement analysis ${active.id} is already active for this document`,
      );
    }
    if (!original.finalCategory) {
      throw new ConflictError('The accepted document has no final category');
    }

    return this.analysisRunner.run(
      ownerId,
      uniqueAnimalIds,
      file,
      original.finalCategory,
      description,
      original.id,
      original.documentGroupId,
    );
  }

  async accept(
    documentId: string,
    candidateDocumentId: string,
    ownerId: string,
    expectedVersion: number,
    candidateVersion: number,
    documentVersions: MedicalDocumentReplacementVersion[],
    extraction: MedicalDocumentExtraction,
    assignments: MedicalDocumentAssignment[],
  ): Promise<MedicalDocument[]> {
    const original = await this.findOwnedDocument(documentId, ownerId);
    if (original.version !== expectedVersion) {
      throw new ConflictError('The document was modified by another request');
    }
    const candidate = await this.findOwnedDocument(
      candidateDocumentId,
      ownerId,
    );
    if (candidate.version !== candidateVersion) {
      throw new ConflictError(
        'The replacement candidate was modified by another request',
      );
    }
    candidate.validateAcceptance(candidateVersion, extraction, assignments);
    if (
      candidate.replacementOfDocumentId !== original.id ||
      candidate.documentGroupId !== original.documentGroupId
    ) {
      throw new ConflictError(
        'The replacement candidate belongs to another document group',
      );
    }

    const groupDocuments = await this.repository.findAcceptedByGroupId(
      original.documentGroupId,
    );
    if (groupDocuments.some((document) => document.animalIds.length !== 1)) {
      throw new ConflictError(
        'The document group must be refreshed before accepting a replacement',
      );
    }
    const documentsByAnimal = new Map(
      groupDocuments.map((document) => [document.animalIds[0], document]),
    );
    const versionsByDocument = new Map(
      documentVersions.map((target) => [target.documentId, target.version]),
    );
    if (
      versionsByDocument.size !== candidate.animalIds.length ||
      documentVersions.length !== versionsByDocument.size
    ) {
      throw new ConflictError(
        'Every selected document must provide exactly one version',
      );
    }
    const selectedDocuments = candidate.animalIds.map((animalId) => {
      const document = documentsByAnimal.get(animalId);
      if (!document || !versionsByDocument.has(document.id)) {
        throw new ConflictError(
          'The selected documents changed after replacement analysis started',
        );
      }
      document.assertReplacementAllowed();
      if (document.finalCategory !== original.finalCategory) {
        throw new ConflictError(
          'All selected documents must have the same final category',
        );
      }
      return document;
    });

    const sourceKey = candidate.temporaryStorageKey || candidate.storageKey;
    const locationsByDocument = new Map<string, MedicalDocumentLocation>();
    for (const document of selectedDocuments) {
      const location = buildMedicalDocumentReplacementLocations(
        document.ownerId,
        document.animalIds,
        document.finalCategory!,
        document.id,
        candidate.id,
        getMedicalDocumentSourceFileName(sourceKey),
      )[0];
      locationsByDocument.set(document.id, location);
    }
    const copiedLocations: MedicalDocumentLocation[] = [];

    try {
      for (const location of locationsByDocument.values()) {
        await this.storage.copyObject(sourceKey, location.storageKey);
        copiedLocations.push(location);
      }
    } catch (error) {
      await this.deleteLocations(copiedLocations);
      throw error;
    }

    const oldLocations = selectedDocuments.flatMap((document) =>
      document.documentLocations.map((location) => ({ ...location })),
    );
    try {
      for (const document of selectedDocuments) {
        const animalId = document.animalIds[0];
        const assignment = assignments.find(
          (candidateAssignment) => candidateAssignment.animalId === animalId,
        )!;
        document.replaceAcceptedContent(
          versionsByDocument.get(document.id)!,
          candidate,
          extraction,
          assignment,
          locationsByDocument.get(document.id)!,
        );
      }
      candidate.discardReplacement(candidateVersion);
      const updated = await this.repository.updateManyAtomically([
        ...selectedDocuments.map((document) => ({
          document,
          expectedVersion: versionsByDocument.get(document.id)!,
        })),
        { document: candidate, expectedVersion: candidateVersion },
      ]);
      if (!updated) {
        throw new ConflictError(
          'One of the selected documents was modified by another request',
        );
      }
    } catch (error) {
      await this.deleteLocations(copiedLocations);
      throw error;
    }

    await this.deleteLocations(oldLocations);
    await this.cleanupCandidateObjects(candidate);
    for (const document of selectedDocuments) {
      await this.applyAcceptedDiagnoses(document, ownerId);
    }
    return selectedDocuments;
  }

  async reject(
    documentId: string,
    candidateDocumentId: string,
    ownerId: string,
    expectedVersion: number,
    candidateVersion: number,
  ): Promise<MedicalDocument[]> {
    const original = await this.findOwnedDocument(documentId, ownerId);
    if (original.version !== expectedVersion) {
      throw new ConflictError('The document was modified by another request');
    }
    const candidate = await this.findOwnedDocument(
      candidateDocumentId,
      ownerId,
    );
    if (candidate.replacementOfDocumentId !== documentId) {
      throw new ConflictError(
        'The replacement candidate belongs to another document',
      );
    }
    if (candidate.status !== MedicalDocumentStatus.Rejected) {
      candidate.discardReplacement(candidateVersion);
      const updated = await this.repository.update(candidate, candidateVersion);
      if (!updated) {
        throw new ConflictError(
          'The replacement candidate was modified by another request',
        );
      }
    }
    await this.cleanupCandidateObjects(candidate);
    const groupDocuments = await this.repository.findAcceptedByGroupId(
      original.documentGroupId,
    );
    return groupDocuments.filter((document) =>
      document.animalIds.some((animalId) =>
        candidate.animalIds.includes(animalId),
      ),
    );
  }

  private async cleanupCandidateObjects(
    candidate: MedicalDocument,
  ): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];
    if (candidate.analysisOutputUri) {
      tasks.push(
        this.storage.deletePrefix(
          candidate.analysisOutputUri.replace(
            /analysis-output\/.*$/,
            'analysis-output/',
          ),
        ),
      );
    }
    if (requiresPdfAnalysisInput(candidate.mimeType)) {
      tasks.push(
        this.storage.deleteObject(
          buildMedicalDocumentAnalysisInputStorageKey(
            candidate.ownerId,
            candidate.id,
          ),
        ),
      );
    }
    tasks.push(
      this.storage.deleteObject(
        candidate.temporaryStorageKey || candidate.storageKey,
      ),
    );
    await Promise.allSettled(tasks);
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

  private async ensureIndividualGroupDocuments(
    anchor: MedicalDocument,
  ): Promise<MedicalDocument[]> {
    const groupDocuments = await this.repository.findAcceptedByGroupId(
      anchor.documentGroupId,
    );
    const result: MedicalDocument[] = [];

    for (const document of groupDocuments) {
      if (document.ownerId !== anchor.ownerId) {
        throw new ForbiddenError(
          'The document group contains a document from another user',
        );
      }
      if (document.animalIds.length === 1) {
        result.push(document);
        continue;
      }
      if (!document.finalCategory) {
        throw new ConflictError('The accepted document has no final category');
      }

      const expectedVersion = document.version;
      const animalIds = [...document.animalIds];
      const createdSiblings: MedicalDocument[] = [];
      try {
        for (const animalId of animalIds.slice(1)) {
          const code = await this.codeGenerator.generate(
            document.finalCategory,
          );
          const sibling = document.createAcceptedSiblingForAnimal(
            animalId,
            code,
          );
          await this.repository.save(sibling);
          createdSiblings.push(sibling);
        }
        document.retainOnlyAcceptedAnimal(expectedVersion, animalIds[0]);
        const updated = await this.repository.update(document, expectedVersion);
        if (!updated) {
          throw new ConflictError(
            'The document was modified while its animal records were separated',
          );
        }
      } catch (error) {
        await Promise.all(
          createdSiblings.map((sibling) =>
            this.repository.delete(sibling.id).catch(() => false),
          ),
        );
        throw error;
      }
      result.push(document, ...createdSiblings);
    }

    return result.sort((left, right) =>
      left.animalIds[0].localeCompare(right.animalIds[0]),
    );
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
}
