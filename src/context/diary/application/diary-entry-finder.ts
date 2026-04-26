import { Injectable, Inject } from '@nestjs/common';
import { DiaryRepository } from '../domain/diary-repository';
import { DiaryEntry } from '../domain/diary-entry';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class DiaryEntryFinder {
    constructor(
        @Inject('DiaryRepository') private readonly repository: DiaryRepository
    ) { }

    async findByAnimal(animalId: string): Promise<DiaryEntry[]> {
        return this.repository.findByAnimalId(animalId);
    }

    async findById(entryId: string): Promise<DiaryEntry> {
        const entry = await this.repository.findById(entryId);
        if (!entry) {
            throw new ResourceNotFoundError(`Diary entry with id ${entryId} not found`);
        }
        return entry;
    }
}
