import { MedicalDocument } from './medical-document';

export interface MedicalDocumentRepository {
  save(document: MedicalDocument): Promise<MedicalDocument>;
  findById(documentId: string): Promise<MedicalDocument | null>;
  findAcceptedByAnimalId(animalId: string): Promise<MedicalDocument[]>;
  update(document: MedicalDocument, expectedVersion?: number): Promise<boolean>;
}
