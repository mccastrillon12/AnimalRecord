import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { DiaryRepository } from '../domain/diary-repository';
import { AnimalRepository } from '../../animal/domain/animalRepository';
import { IStorageService } from '../../user/domain/ports/IStorageService';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { Attachment } from '../domain/diary-entry';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/x-m4a'];
const ALL_ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_AUDIO_TYPES];

@Injectable()
export class DiaryAttachmentManager {
    constructor(
        @Inject('DiaryRepository') private readonly diaryRepository: DiaryRepository,
        @Inject('AnimalRepository') private readonly animalRepository: AnimalRepository,
        @Inject('IStorageService') private readonly storageService: IStorageService
    ) { }

    async generateUploadUrl(
        animalId: string,
        entryId: string,
        mimeType: string,
        fileSize: number
    ): Promise<{ uploadUrl: string; finalUrl: string; attachmentId: string }> {
        // Validate entry exists
        const entry = await this.diaryRepository.findById(entryId);
        if (!entry || entry.animalId.value !== animalId) {
            throw new ResourceNotFoundError('Diary entry not found');
        }

        // Validate mime type
        if (!ALL_ALLOWED_TYPES.includes(mimeType)) {
            throw new BadRequestException(
                `Invalid file type: ${mimeType}. Allowed types: ${ALL_ALLOWED_TYPES.join(', ')}`
            );
        }

        // Get owner ID for S3 path
        const animal = await this.animalRepository.findById(new Uuid(animalId));
        if (!animal) {
            throw new ResourceNotFoundError('Animal not found');
        }

        const ownerId = animal.ownerId.value;
        const attachmentId = uuidv4();
        const extension = this.getExtension(mimeType);
        const fileName = `users/${ownerId}/animals/${animalId}/diary/${entryId}/${attachmentId}.${extension}`;

        const { uploadUrl, finalUrl } = await this.storageService.generatePreSignedUploadUrl(fileName, mimeType, fileSize);

        return { uploadUrl, finalUrl, attachmentId };
    }

    async confirmAttachment(
        animalId: string,
        entryId: string,
        attachmentId: string,
        finalUrl: string,
        fileName: string,
        mimeType: string,
        size: number
    ): Promise<void> {
        const entry = await this.diaryRepository.findById(entryId);
        if (!entry || entry.animalId.value !== animalId) {
            throw new ResourceNotFoundError('Diary entry not found');
        }

        const fileType = ALLOWED_IMAGE_TYPES.includes(mimeType) ? 'image' : 'audio';
        const now = new Date().toISOString();

        const attachment = new Attachment(
            attachmentId,
            fileName,
            fileType,
            mimeType,
            finalUrl,
            size,
            now
        );

        entry.addAttachment(attachment);
        await this.diaryRepository.update(entry);
    }

    async deleteAttachment(animalId: string, entryId: string, attachmentId: string): Promise<void> {
        const entry = await this.diaryRepository.findById(entryId);
        if (!entry || entry.animalId.value !== animalId) {
            throw new ResourceNotFoundError('Diary entry not found');
        }

        const removed = entry.removeAttachment(attachmentId);
        if (!removed) {
            throw new ResourceNotFoundError(`Attachment with id ${attachmentId} not found`);
        }

        // Delete from S3
        await this.storageService.deleteFile(removed.url);

        await this.diaryRepository.update(entry);
    }

    private getExtension(mimeType: string): string {
        const map: Record<string, string> = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/heic': 'heic',
            'audio/mpeg': 'mp3',
            'audio/mp4': 'm4a',
            'audio/m4a': 'm4a',
            'audio/aac': 'aac',
            'audio/wav': 'wav',
            'audio/ogg': 'ogg',
            'audio/x-m4a': 'm4a'
        };
        return map[mimeType] || 'bin';
    }
}
