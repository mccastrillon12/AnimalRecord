import { Inject, Injectable } from '@nestjs/common';
import { AnimalWriteCoordinator } from '../../animal-transfer/application/animal-write-coordinator';
import { MedicalDocumentRepository } from '../domain/medical-document-repository';
import { MedicalDocument } from '../domain/medical-document';
import { MedicalDocumentFinder } from './medical-document-finder';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ForbiddenError } from '../../shared/domain/errors/ForbiddenError';

/** Covers the entire operation, including S3 rollback/cleanup and legacy normalization. */
@Injectable()
export class MedicalDocumentWriteCoordinator {
  constructor(
    private readonly writes: AnimalWriteCoordinator,
    private readonly finder: MedicalDocumentFinder,
    @Inject('MedicalDocumentRepository')
    private readonly repository: MedicalDocumentRepository,
  ) {}

  async forDocuments<T>(
    documentIds: string[],
    ownerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const resolve = async () =>
      (
        await Promise.all(
          documentIds.map((id) => this.finder.findById(id, ownerId)),
        )
      ).flatMap((document) => document.animalIds);
    return this.withStableAnimals(await resolve(), ownerId, resolve, operation);
  }

  async forGroup<T>(
    documentId: string,
    ownerId: string,
    selectedAnimalIds: string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const resolve = async () => {
      const anchor = await this.finder.findById(documentId, ownerId);
      return [...selectedAnimalIds, ...(await this.legacyGroupAnimals(anchor))];
    };
    const animalIds = await resolve();
    // Already individual related-documents are a pure read, even under a transfer lock.
    if (animalIds.length === 0) return operation();
    return this.withStableAnimals(animalIds, ownerId, resolve, operation);
  }

  private async legacyGroupAnimals(anchor: MedicalDocument): Promise<string[]> {
    const group = await this.repository.findAcceptedByGroupId(
      anchor.documentGroupId,
    );
    if (group.some((document) => document.ownerId !== anchor.ownerId)) {
      throw new ForbiddenError(
        'The document group contains a document from another user',
      );
    }
    return group
      .filter((document) => document.animalIds.length !== 1)
      .flatMap((document) => document.animalIds);
  }

  private async withStableAnimals<T>(
    animalIds: string[],
    ownerId: string,
    resolve: () => Promise<string[]>,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.writes.run(animalIds, ownerId, async () => {
      const claimed = new Set(animalIds);
      // Re-fetch after acquisition: never mutate animals discovered outside our claims.
      if ((await resolve()).some((id) => !claimed.has(id))) {
        throw new ConflictError(
          'The medical document associations changed; refresh and retry',
        );
      }
      return operation();
    });
  }
}
