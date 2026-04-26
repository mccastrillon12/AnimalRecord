import { DiaryEntry } from './diary-entry';

export interface DiaryRepository {
    save(entry: DiaryEntry): Promise<DiaryEntry>;
    findById(entryId: string): Promise<DiaryEntry | null>;
    findByAnimalId(animalId: string): Promise<DiaryEntry[]>;
    update(entry: DiaryEntry): Promise<boolean>;
    delete(entryId: string): Promise<boolean>;
}
