import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
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
import { DiaryAccessGuard } from './diary-access.guard';
import { AuthenticatedRequest } from '../shared/authenticated-request';
import { AnimalWriteCoordinator } from '../../context/animal-transfer/application/animal-write-coordinator';

@ApiTags('diary')
@ApiResponse({
  status: 500,
  type: HttpErrorDto,
  description:
    'Internal persistence failure. Coordinated writes do not start if journal preparation fails; retain local data and refresh before retrying.',
})
@Controller('animals/:animalId/diary')
@UseGuards(JwtAuthGuard, DiaryAccessGuard)
@ApiBearerAuth('access-token')
@ApiResponse({
  status: 403,
  description: 'The animal belongs to another user.',
  type: HttpErrorDto,
})
export class DiaryController {
  constructor(
    private readonly creator: DiaryEntryCreator,
    private readonly finder: DiaryEntryFinder,
    private readonly updater: DiaryEntryUpdater,
    private readonly deleter: DiaryEntryDeleter,
    private readonly attachmentManager: DiaryAttachmentManager,
    private readonly writes: AnimalWriteCoordinator,
  ) {}

  // =====================================================
  // DIARY ENTRY CRUD
  // =====================================================

  @Post()
  @ApiResponse({
    status: 409,
    description:
      'Diary writes are temporarily blocked while the animal transfer is processed.',
    type: HttpErrorDto,
  })
  @ApiOperation({ summary: 'Create a diary entry for an animal' })
  @ApiResponse({
    status: 201,
    description: 'Entry created.',
    type: DiaryEntryResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request.', type: HttpErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  async create(
    @Param('animalId') animalId: string,
    @Body() dto: CreateDiaryEntryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run(
      [animalId],
      req.user.id,
      async () => {
        const entry = await this.creator.run(
          animalId,
          dto.title,
          dto.content,
          dto.date,
        );
        return entry.toPrimitives();
      },
      { kind: 'DIARY_CREATE' },
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List all diary entries for an animal (sorted by date desc)',
  })
  @ApiResponse({
    status: 200,
    description: 'Return diary entries.',
    type: [DiaryEntryResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: HttpErrorDto,
  })
  async findAll(@Param('animalId') animalId: string) {
    const entries = await this.finder.findByAnimal(animalId);
    return entries.map((e) => e.toPrimitives());
  }

  @Get(':entryId')
  @ApiOperation({ summary: 'Get a single diary entry' })
  @ApiResponse({
    status: 200,
    description: 'Return the diary entry.',
    type: DiaryEntryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Entry not found.',
    type: HttpErrorDto,
  })
  async findOne(@Param('entryId') entryId: string) {
    const entry = await this.finder.findById(entryId);
    return entry.toPrimitives();
  }

  @Put(':entryId')
  @ApiResponse({
    status: 409,
    description:
      'Diary writes are temporarily blocked while the animal transfer is processed.',
    type: HttpErrorDto,
  })
  @ApiOperation({
    summary: 'Update title and content of a diary entry (date is not editable)',
  })
  @ApiResponse({
    status: 200,
    description: 'Entry updated.',
    type: DiaryEntryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Entry not found.',
    type: HttpErrorDto,
  })
  async update(
    @Param('animalId') animalId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateDiaryEntryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run(
      [animalId],
      req.user.id,
      async () => {
        const entry = await this.updater.run(entryId, dto.title, dto.content);
        return entry.toPrimitives();
      },
      { kind: 'DIARY_UPDATE' },
    );
  }

  @Delete(':entryId')
  @ApiResponse({
    status: 409,
    description:
      'Diary writes are temporarily blocked while the animal transfer is processed.',
    type: HttpErrorDto,
  })
  @ApiOperation({
    summary: 'Delete a diary entry and all its attachments from S3',
  })
  @ApiResponse({ status: 200, description: 'Entry deleted.' })
  @ApiResponse({
    status: 404,
    description: 'Entry not found.',
    type: HttpErrorDto,
  })
  async remove(
    @Param('animalId') animalId: string,
    @Param('entryId') entryId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run(
      [animalId],
      req.user.id,
      async () => {
        await this.deleter.run(entryId);
        return { success: true };
      },
      { kind: 'DIARY_DELETE' },
    );
  }

  // =====================================================
  // ATTACHMENTS
  // =====================================================

  @Get(':entryId/attachments/upload-url')
  @ApiResponse({
    status: 409,
    description:
      'Diary writes are temporarily blocked while the animal transfer is processed.',
    type: HttpErrorDto,
  })
  @ApiOperation({
    summary:
      'Get a pre-signed URL to upload an attachment (image or audio) to S3',
    description:
      'uploadUrl and finalUrl are opaque and may target different keys. Upload using uploadUrl, then confirm finalUrl and attachmentId unchanged. New final files become available after backend confirmation, not just after PUT.',
  })
  @ApiQuery({ name: 'mimeType', required: true, example: 'image/jpeg' })
  @ApiQuery({ name: 'fileSize', required: true, example: 500000 })
  @ApiResponse({
    status: 200,
    description: 'Return upload URL, final URL, and attachment ID.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file type.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Entry not found.',
    type: HttpErrorDto,
  })
  async getAttachmentUploadUrl(
    @Param('animalId') animalId: string,
    @Param('entryId') entryId: string,
    @Query('mimeType') mimeType: string,
    @Query('fileSize') fileSize: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run(
      [animalId],
      req.user.id,
      () =>
        this.attachmentManager.generateUploadUrl(
          animalId,
          entryId,
          mimeType,
          Number(fileSize),
        ),
      { issuesUploadUrl: true, kind: 'ATTACHMENT_UPLOAD_URL' },
    );
  }

  @Post(':entryId/attachments')
  @ApiResponse({
    status: 400,
    description: 'Metadata does not match the issued URL or this animal/entry.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'S3 could not copy/verify the upload. Retrying the same confirmation reconciles an uncertain result.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Transfer or maintenance reservation, migrated/changed URL, non-current migration copy, pending upload, changed source, conflicting destination, or failure to persist attachment. Refresh a changed URL and compare attachmentId; do not infer transfer state from 409 alone.',
    type: HttpErrorDto,
  })
  @ApiOperation({
    summary: 'Confirm an attachment upload and save metadata',
    description:
      'Use exact URLs returned by the backend. An existing migrated attachment may use a sealed subpath without changing attachmentId; identical canonical confirmation remains idempotent. An obsolete URL conflicts and requires refresh.',
  })
  @ApiResponse({
    status: 201,
    description: 'Attachment confirmed.',
    type: DiaryEntryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Entry not found.',
    type: HttpErrorDto,
  })
  async confirmAttachment(
    @Param('animalId') animalId: string,
    @Param('entryId') entryId: string,
    @Body() dto: ConfirmAttachmentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run(
      [animalId],
      req.user.id,
      async (context) => {
        await this.attachmentManager.confirmAttachment(
          animalId,
          entryId,
          dto.attachmentId,
          dto.finalUrl,
          dto.fileName,
          dto.mimeType,
          dto.size,
          context,
        );
        const entry = await this.finder.findById(entryId);
        return entry.toPrimitives();
      },
      {
        kind: 'ATTACHMENT_CONFIRM',
        mediaPromotionProtocol: 'MEDIA_PROMOTION_ROWS_V1',
      },
    );
  }

  @Delete(':entryId/attachments/:attachmentId')
  @ApiResponse({
    status: 409,
    description:
      'Diary writes are temporarily blocked while the animal transfer is processed.',
    type: HttpErrorDto,
  })
  @ApiOperation({ summary: 'Delete an attachment from a diary entry and S3' })
  @ApiResponse({ status: 200, description: 'Attachment deleted.' })
  @ApiResponse({
    status: 404,
    description: 'Entry or attachment not found.',
    type: HttpErrorDto,
  })
  async deleteAttachment(
    @Param('animalId') animalId: string,
    @Param('entryId') entryId: string,
    @Param('attachmentId') attachmentId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.writes.run(
      [animalId],
      req.user.id,
      async () => {
        await this.attachmentManager.deleteAttachment(
          animalId,
          entryId,
          attachmentId,
        );
        return { success: true };
      },
      { kind: 'ATTACHMENT_DELETE' },
    );
  }
}
