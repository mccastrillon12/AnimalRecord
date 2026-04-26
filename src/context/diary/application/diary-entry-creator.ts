import { Injectable, Inject } from '@nestjs/common';
import { DiaryRepository } from '../domain/diary-repository';
import { DiaryEntry } from '../domain/diary-entry';

@Injectable()
export class DiaryEntryCreator {
    constructor(
        @Inject('DiaryRepository') private readonly repository: DiaryRepository
    ) { }

    async run(animalId: string, title: string, content: string, date: string): Promise<DiaryEntry> {
        const entry = DiaryEntry.create(animalId, title, content, date);
        return this.repository.save(entry);
    }
}
