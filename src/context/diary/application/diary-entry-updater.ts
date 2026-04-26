import { Injectable, Inject } from '@nestjs/common';
import { DiaryRepository } from '../domain/diary-repository';
import { DiaryEntry } from '../domain/diary-entry';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class DiaryEntryUpdater {
    constructor(
        @Inject('DiaryRepository') private readonly repository: DiaryRepository
    ) { }

    async run(entryId: string, title: string, content: string): Promise<DiaryEntry> {
        const entry = await this.repository.findById(entryId);
        if (!entry) {
            throw new ResourceNotFoundError(`Diary entry with id ${entryId} not found`);
        }

        entry.updateContent(title, content);
        await this.repository.update(entry);
        return entry;
    }
}
