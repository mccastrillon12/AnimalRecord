import { Injectable, Inject } from '@nestjs/common';
import { DiaryRepository } from '../domain/diary-repository';
import { IStorageService } from '../../user/domain/ports/IStorageService';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';

@Injectable()
export class DiaryEntryDeleter {
    constructor(
        @Inject('DiaryRepository') private readonly repository: DiaryRepository,
        @Inject('IStorageService') private readonly storageService: IStorageService
    ) { }

    async run(entryId: string): Promise<void> {
        const entry = await this.repository.findById(entryId);
        if (!entry) {
            throw new ResourceNotFoundError(`Diary entry with id ${entryId} not found`);
        }

        // Delete all attachments from S3
        for (const attachment of entry.attachments) {
            await this.storageService.deleteFile(attachment.url);
        }

        await this.repository.delete(entryId);
    }
}
