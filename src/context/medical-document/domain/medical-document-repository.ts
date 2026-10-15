import { MedicalDocument, MedicalDocumentType } from './medical-document';

export interface MedicalDocumentRepository {
  save(document: MedicalDocument): Promise<MedicalDocument>;
  findById(documentId: string): Promise<MedicalDocument | null>;
  findAcceptedByAnimalId(
    animalId: string,
    category?: MedicalDocumentType,
  ): Promise<MedicalDocument[]>;
  findActiveReplacementFor(documentId: string): Promise<MedicalDocument | null>;
  findAcceptedByGroupId(documentGroupId: string): Promise<MedicalDocument[]>;
  findActiveReplacementForGroup(
    documentGroupId: string,
  ): Promise<MedicalDocument | null>;
  update(document: MedicalDocument, expectedVersion?: number): Promise<boolean>;
  updateManyAtomically(
    documents: Array<{
      document: MedicalDocument;
      expectedVersion: number;
    }>,
  ): Promise<boolean>;
  delete(documentId: string, expectedVersion?: number): Promise<boolean>;
}
