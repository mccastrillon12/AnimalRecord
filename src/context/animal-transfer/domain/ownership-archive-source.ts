import { AnimalPrimitiveType } from '../../animal/domain/animal';
import { DiaryEntryPrimitiveType } from '../../diary/domain/diary-entry';
import { MedicalDocumentPrimitiveType } from '../../medical-document/domain/medical-document';
import { ArchiveDefinition } from './ownership-archive';

/** Read-only live dossier. No AWS/AI, normalization, or writes. */
export interface OwnershipArchiveSource {
  findAnimal(animalId: string): Promise<AnimalPrimitiveType | null>;
  assertInitialPeriod(definition: ArchiveDefinition): Promise<void>;
  hasPendingMedicalWork(animalId: string): Promise<boolean>;
  listDiary(
    animalId: string,
    afterId: string | undefined,
    limit: number,
  ): Promise<DiaryEntryPrimitiveType[]>;
  listAcceptedDocuments(
    animalId: string,
    afterId: string | undefined,
    limit: number,
  ): Promise<MedicalDocumentPrimitiveType[]>;
}
