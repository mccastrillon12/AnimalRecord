import { Inject, Injectable } from '@nestjs/common';
import { MedicalDocument } from '../domain/medical-document';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocumentAnimalAccess } from './medical-document-animal-access';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';

@Injectable()
export class MedicalDocumentFinder {
  constructor(
    @Inject('MedicalDocumentRepository')
    private readonly repository: MedicalDocumentRepository,
    private readonly animalAccess: MedicalDocumentAnimalAccess,
  ) {}

  async findById(
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

  async findByAnimal(
    animalId: string,
    ownerId: string,
  ): Promise<MedicalDocument[]> {
    await this.animalAccess.findOwnedAnimals([animalId], ownerId);
    return this.repository.findAcceptedByAnimalId(animalId);
  }
}
