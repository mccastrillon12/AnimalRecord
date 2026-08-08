import { MedicalDocument, MedicalDocumentType } from './medical-document';

export interface MedicalDocumentRepository {
  save(document: MedicalDocument): Promise<MedicalDocument>;
  findById(documentId: string): Promise<MedicalDocument | null>;
  findAcceptedByAnimalId(
    animalId: string,
    category?: MedicalDocumentType,
  ): Promise<MedicalDocument[]>;
  update(document: MedicalDocument, expectedVersion?: number): Promise<boolean>;
}
