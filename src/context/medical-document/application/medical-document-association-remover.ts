import { Inject, Injectable } from '@nestjs/common';
import { MedicalDocument } from '../domain/medical-document';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocumentStorage } from '../domain/medical-document-storage';
import { MedicalDocumentAnimalAccess } from './medical-document-animal-access';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class MedicalDocumentAssociationRemover {
  constructor(
    @Inject('MedicalDocumentRepository')
    private readonly repository: MedicalDocumentRepository,
    @Inject('MedicalDocumentStorage')
    private readonly storage: MedicalDocumentStorage,
    private readonly animalAccess: MedicalDocumentAnimalAccess,
  ) {}

  async run(
    documentId: string,
    animalId: string,
    ownerId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.animalAccess.findOwnedAnimals([animalId], ownerId);
    const document = await this.findOwnedDocument(documentId, ownerId);
    if (document.version !== expectedVersion) {
      throw new ConflictError('The document was modified by another request');
    }
    const activeReplacement =
      await this.repository.findActiveReplacementForGroup(
        document.documentGroupId,
      );
    if (activeReplacement?.animalIds.includes(animalId)) {
      throw new ConflictError(
        'The document cannot be removed while replacement analysis is active',
      );
    }
    const location = document.documentLocations.find(
      (candidate) => candidate.animalId === animalId,
    );
    if (!location) {
      throw new ResourceNotFoundError(
        'The document is not stored for this animal',
      );
    }

    const backup = await this.storage.getObject(location.storageKey);
    await this.storage.deleteObject(location.storageKey);
    try {
      document.removeFromAnimal(expectedVersion, animalId);
      const persisted =
        document.animalIds.length === 0
          ? await this.repository.delete(document.id, expectedVersion)
          : await this.repository.update(document, expectedVersion);
      if (!persisted) {
        throw new ConflictError('The document was modified by another request');
      }
    } catch (error) {
      await this.storage
        .putObject(location.storageKey, backup, document.mimeType)
        .catch(() => undefined);
      throw error;
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
