import { Controller, Post, Get, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DiaryEntryCreator } from '../../context/diary/application/diary-entry-creator';
import { DiaryEntryFinder } from '../../context/diary/application/diary-entry-finder';
import { DiaryEntryUpdater } from '../../context/diary/application/diary-entry-updater';
import { DiaryEntryDeleter } from '../../context/diary/application/diary-entry-deleter';
import { DiaryAttachmentManager } from '../../context/diary/application/diary-attachment-manager';
import { CreateDiaryEntryDto } from './create-diary-entry.dto';
import { UpdateDiaryEntryDto } from './update-diary-entry.dto';
import { ConfirmAttachmentDto } from './confirm-attachment.dto';
import { DiaryEntryResponseDto } from './diary-entry-response.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HttpErrorDto } from '../shared/dto/http-error.dto';

@ApiTags('diary')
@Controller('animals/:animalId/diary')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class DiaryController {
    constructor(
        private readonly creator: DiaryEntryCreator,
        private readonly finder: DiaryEntryFinder,
        private readonly updater: DiaryEntryUpdater,
        private readonly deleter: DiaryEntryDeleter,
        private readonly attachmentManager: DiaryAttachmentManager
    ) { }

    // =====================================================
    // DIARY ENTRY CRUD
    // =====================================================

    @Post()
    @ApiOperation({ summary: 'Create a diary entry for an animal' })
    @ApiResponse({ status: 201, description: 'Entry created.', type: DiaryEntryResponseDto })
    @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async create(
        @Param('animalId') animalId: string,
        @Body() dto: CreateDiaryEntryDto
    ) {
        const entry = await this.creator.run(animalId, dto.title, dto.content, dto.date);
        return entry.toPrimitives();
    }

    @Get()
    @ApiOperation({ summary: 'List all diary entries for an animal (sorted by date desc)' })
    @ApiResponse({ status: 200, description: 'Return diary entries.', type: [DiaryEntryResponseDto] })
    @ApiResponse({ status: 401, description: 'Unauthorized.', type: HttpErrorDto })
    async findAll(@Param('animalId') animalId: string) {
        const entries = await this.finder.findByAnimal(animalId);
        return entries.map(e => e.toPrimitives());
    }

    @Get(':entryId')
    @ApiOperation({ summary: 'Get a single diary entry' })
    @ApiResponse({ status: 200, description: 'Return the diary entry.', type: DiaryEntryResponseDto })
    @ApiResponse({ status: 404, description: 'Entry not found.', type: HttpErrorDto })
    async findOne(@Param('entryId') entryId: string) {
        const entry = await this.finder.findById(entryId);
        return entry.toPrimitives();
    }

    @Put(':entryId')
    @ApiOperation({ summary: 'Update title and content of a diary entry (date is not editable)' })
    @ApiResponse({ status: 200, description: 'Entry updated.', type: DiaryEntryResponseDto })
    @ApiResponse({ status: 404, description: 'Entry not found.', type: HttpErrorDto })
    async update(
        @Param('entryId') entryId: string,
        @Body() dto: UpdateDiaryEntryDto
    ) {
        const entry = await this.updater.run(entryId, dto.title, dto.content);
        return entry.toPrimitives();
    }

    @Delete(':entryId')
    @ApiOperation({ summary: 'Delete a diary entry and all its attachments from S3' })
    @ApiResponse({ status: 200, description: 'Entry deleted.' })
    @ApiResponse({ status: 404, description: 'Entry not found.', type: HttpErrorDto })
    async remove(@Param('entryId') entryId: string) {
        await this.deleter.run(entryId);
        return { success: true };
    }

    // =====================================================
    // ATTACHMENTS
    // =====================================================

    @Get(':entryId/attachments/upload-url')
    @ApiOperation({ summary: 'Get a pre-signed URL to upload an attachment (image or audio) to S3' })
    @ApiQuery({ name: 'mimeType', required: true, example: 'image/jpeg' })
    @ApiQuery({ name: 'fileSize', required: true, example: 500000 })
    @ApiResponse({ status: 200, description: 'Return upload URL, final URL, and attachment ID.' })
    @ApiResponse({ status: 400, description: 'Invalid file type.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'Entry not found.', type: HttpErrorDto })
    async getAttachmentUploadUrl(
        @Param('animalId') animalId: string,
        @Param('entryId') entryId: string,
        @Query('mimeType') mimeType: string,
        @Query('fileSize') fileSize: string
    ) {
        return this.attachmentManager.generateUploadUrl(animalId, entryId, mimeType, Number(fileSize));
    }

    @Post(':entryId/attachments')
    @ApiOperation({ summary: 'Confirm an attachment upload and save metadata' })
    @ApiResponse({ status: 201, description: 'Attachment confirmed.', type: DiaryEntryResponseDto })
    @ApiResponse({ status: 404, description: 'Entry not found.', type: HttpErrorDto })
    async confirmAttachment(
        @Param('animalId') animalId: string,
        @Param('entryId') entryId: string,
        @Body() dto: ConfirmAttachmentDto
    ) {
        await this.attachmentManager.confirmAttachment(
            animalId, entryId,
            dto.attachmentId, dto.finalUrl, dto.fileName, dto.mimeType, dto.size
        );
        const entry = await this.finder.findById(entryId);
        return entry.toPrimitives();
    }

    @Delete(':entryId/attachments/:attachmentId')
    @ApiOperation({ summary: 'Delete an attachment from a diary entry and S3' })
    @ApiResponse({ status: 200, description: 'Attachment deleted.' })
    @ApiResponse({ status: 404, description: 'Entry or attachment not found.', type: HttpErrorDto })
    async deleteAttachment(
        @Param('animalId') animalId: string,
        @Param('entryId') entryId: string,
        @Param('attachmentId') attachmentId: string
    ) {
        await this.attachmentManager.deleteAttachment(animalId, entryId, attachmentId);
        return { success: true };
    }
}
