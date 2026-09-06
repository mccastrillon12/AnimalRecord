import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyzeMedicalDocumentDto } from './analyze-medical-document.dto';
import { FindMedicalDocumentsDto } from './find-medical-documents.dto';
import {
  MedicalDocumentReviewDecision,
  ReviewMedicalDocumentDto,
} from './review-medical-document.dto';
import {
  MedicalDocumentDownloadResponseDto,
  MedicalDocumentResponseDto,
  toMedicalDocumentResponse,
} from './medical-document-response.dto';
import { MedicalDocumentAnalysisRunner } from '../../context/medical-document/application/medical-document-analysis-runner';
import { MedicalDocumentReviewer } from '../../context/medical-document/application/medical-document-reviewer';
import { MedicalDocumentFinder } from '../../context/medical-document/application/medical-document-finder';
import { MedicalDocumentDownloader } from '../../context/medical-document/application/medical-document-downloader';
import { InvalidArgumentError } from '../../context/shared/domain/errors/InvalidArgumentError';
import { HttpErrorDto } from '../shared/dto/http-error.dto';
import { MedicalDocumentAnalysisRefresher } from '../../context/medical-document/application/medical-document-analysis-refresher';
import {
  MEDICAL_DOCUMENT_REJECTION_REASON_OPTIONS,
  MedicalDocumentRejectionReasonOptionDto,
} from './medical-document-review-options.dto';
import {
  MedicalDocumentFeedbackRegisteredDto,
  MedicalDocumentFeedbackSummaryDto,
  RecordMedicalDocumentFeedbackDto,
} from './medical-document-feedback.dto';
import { MedicalDocumentFeedbackService } from '../../context/medical-document/application/medical-document-feedback-service';
import { MedicalDocumentFieldCatalog } from '../../context/medical-document/application/medical-document-field-catalog';
import {
  MedicalDocumentFieldCatalogQueryDto,
  MedicalDocumentFieldCatalogResponseDto,
} from './medical-document-field-catalog.dto';

type UploadedDocumentFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@ApiTags('medical-documents')
@ApiExtraModels(ReviewMedicalDocumentDto)
@Controller('medical-documents')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class MedicalDocumentController {
  constructor(
    private readonly analysisRunner: MedicalDocumentAnalysisRunner,
    private readonly analysisRefresher: MedicalDocumentAnalysisRefresher,
    private readonly reviewer: MedicalDocumentReviewer,
    private readonly finder: MedicalDocumentFinder,
    private readonly downloader: MedicalDocumentDownloader,
    private readonly feedbackService: MedicalDocumentFeedbackService,
    private readonly fieldCatalog: MedicalDocumentFieldCatalog,
  ) {}

  @Get('field-catalog')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({
    summary: 'Get localized presentation metadata for a medical extraction',
    description:
      'Returns Spanish labels and rendering metadata without changing the canonical English JSON keys or medical values.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Versioned field catalog for the requested category and locale.',
    type: MedicalDocumentFieldCatalogResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Unsupported category or locale.',
    type: HttpErrorDto,
  })
  fieldCatalogForCategory(
    @Query() query: MedicalDocumentFieldCatalogQueryDto,
  ): MedicalDocumentFieldCatalogResponseDto {
    return this.fieldCatalog.get(query.category, query.locale);
  }

  @Get('rejection-reasons')
  @ApiOperation({
    summary: 'List the reasons available when rejecting an AI extraction',
  })
  @ApiResponse({
    status: 200,
    description: 'Stable reason codes and labels for the rejection dropdown.',
    type: [MedicalDocumentRejectionReasonOptionDto],
  })
  rejectionReasons(): ReadonlyArray<MedicalDocumentRejectionReasonOptionDto> {
    return MEDICAL_DOCUMENT_REJECTION_REASON_OPTIONS;
  }

  @Post('ai-feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Increment the global anonymous like or dislike counter',
    description:
      'The feedback is intentionally not associated with a user, document, animal, category, or blueprint. Every valid request increments one global counter.',
  })
  @ApiResponse({
    status: 200,
    description: 'The selected global counter was incremented.',
    type: MedicalDocumentFeedbackRegisteredDto,
  })
  async recordFeedback(
    @Body() dto: RecordMedicalDocumentFeedbackDto,
  ): Promise<MedicalDocumentFeedbackRegisteredDto> {
    await this.feedbackService.record(dto.value);
    return { registered: true };
  }

  @Get('ai-feedback/summary')
  @ApiOperation({ summary: 'Get the global anonymous AI process feedback' })
  @ApiResponse({
    status: 200,
    description: 'Global likes, dislikes, total responses, and approval rate.',
    type: MedicalDocumentFeedbackSummaryDto,
  })
  async feedbackSummary(): Promise<MedicalDocumentFeedbackSummaryDto> {
    return this.feedbackService.summary();
  }

  @Post('analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a veterinary document and start asynchronous analysis',
    description:
      'Validates animal ownership, stores the private source file in S3, starts Amazon Bedrock Data Automation, and returns immediately. Poll GET /medical-documents/{documentId} until the status changes from ANALYZING.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'animalIds'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'PDF, JPEG, PNG, or TIFF document. Maximum application size: 10 MB.',
        },
        animalIds: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', format: 'uuid' },
          description:
            'Animals that may receive information from the document. Every animal must belong to the authenticated user.',
        },
        requestedCategory: {
          type: 'string',
          enum: [
            'PRESCRIPTION',
            'MEDICAL_ORDER',
            'REFERRAL',
            'VACCINATION_CARD',
            'CLINICAL_HISTORY',
            'DIAGNOSTIC_IMAGE',
            'LABORATORY_RESULT',
            'OTHER',
          ],
          description:
            'Optional category selected before upload. Omit for a general upload.',
        },
        description: {
          type: 'string',
          maxLength: 500,
          description:
            'Optional user-authored note stored with the document. It is not sent to AI.',
        },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Analysis accepted. The returned status is ANALYZING.',
    type: MedicalDocumentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Missing file, unsupported format, invalid signature, empty file, or invalid animal IDs.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'At least one animal does not belong to the authenticated user.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'At least one requested animal does not exist.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 413,
    description: 'The uploaded file exceeds the 10 MB application limit.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'S3 or Amazon Bedrock Data Automation could not process the document.',
    type: HttpErrorDto,
  })
  async analyze(
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Body() dto: AnalyzeMedicalDocumentDto,
    @Request() request: { user: { id: string } },
  ): Promise<MedicalDocumentResponseDto> {
    if (!file) throw new InvalidArgumentError('A document file is required');

    const document = await this.analysisRunner.run(
      request.user.id,
      dto.animalIds,
      {
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        content: file.buffer,
      },
      dto.requestedCategory,
      dto.description,
    );
    return toMedicalDocumentResponse(document);
  }

  @Get(':documentId')
  @ApiOperation({
    summary: 'Get a medical document and its extraction',
    description:
      'Returns only documents owned by the authenticated user. While status is ANALYZING, it also refreshes the asynchronous AWS job. Storage keys and AWS provider metadata are never exposed.',
  })
  @ApiParam({
    name: 'documentId',
    format: 'uuid',
    description: 'Medical document identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Medical document found.',
    type: MedicalDocumentResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 403,
    description: 'The document belongs to another user.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Medical document not found.',
    type: HttpErrorDto,
  })
  async findOne(
    @Param('documentId') documentId: string,
    @Request() request: { user: { id: string } },
  ): Promise<MedicalDocumentResponseDto> {
    const document = await this.finder.findById(documentId, request.user.id);
    const refreshed = await this.analysisRefresher.refresh(document);
    return toMedicalDocumentResponse(refreshed);
  }

  @Put(':documentId/review')
  @ApiOperation({
    summary: 'Accept or reject an analyzed medical document',
    description:
      'Acceptance requires the complete user-validated extraction and one assignment for every associated animal. Rejection only requires the current document version.',
  })
  @ApiParam({
    name: 'documentId',
    format: 'uuid',
    description:
      'Medical document identifier returned by the analysis endpoint',
  })
  @ApiBody({
    schema: { $ref: getSchemaPath(ReviewMedicalDocumentDto) },
    examples: {
      accept: {
        summary: 'Accept a corrected prescription',
        value: {
          decision: 'ACCEPT',
          documentVersion: 1,
          finalCategory: 'PRESCRIPTION',
          validatedExtraction: {
            documentType: 'PRESCRIPTION',
            documentTypeConfidence: 0.97,
            summary: 'Prescription for dermatitis treatment',
            documentDate: '2026-07-19',
            issuer: {
              name: 'Dra. Ana Perez',
              clinic: 'Clinica Veterinaria Central',
              professionalId: 'MV-12345',
            },
            patientHints: ['Max'],
            diagnoses: [
              { id: 'diagnosis-1', name: 'Dermatitis', confidence: 0.94 },
            ],
            medications: [
              {
                id: 'medication-1',
                name: 'Amoxicilina',
                dose: '250 mg',
                route: 'Oral',
                frequency: 'Cada 12 horas',
                duration: '7 dias',
                confidence: 0.91,
              },
            ],
            vaccinations: [],
            medicalOrders: [],
            additionalFields: {},
            warnings: [],
          },
          assignments: [
            {
              animalId: '123e4567-e89b-42d3-a456-426614174000',
              extractedItemIds: ['diagnosis-1', 'medication-1'],
            },
          ],
        },
      },
      reject: {
        summary: 'Reject an extraction',
        value: {
          decision: 'REJECT',
          documentVersion: 1,
          rejectionReason: 'INCORRECT_INFORMATION',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Review applied. The status is ACCEPTED or REJECTED.',
    type: MedicalDocumentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid extraction, missing assignment, duplicate item IDs, or an unknown assigned item.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 403,
    description: 'The document or an animal belongs to another user.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Medical document or associated animal not found.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Version conflict, invalid document state, or a concurrent review already modified the document.',
    type: HttpErrorDto,
  })
  async review(
    @Param('documentId') documentId: string,
    @Body() dto: ReviewMedicalDocumentDto,
    @Request() request: { user: { id: string } },
  ): Promise<MedicalDocumentResponseDto> {
    const document =
      dto.decision === MedicalDocumentReviewDecision.Accept
        ? await this.reviewer.accept(
            documentId,
            request.user.id,
            dto.documentVersion,
            dto.finalCategory!,
            dto.validatedExtraction!,
            dto.assignments!,
          )
        : await this.reviewer.reject(
            documentId,
            request.user.id,
            dto.documentVersion,
            dto.rejectionReason!,
            dto.rejectionComment,
          );

    return toMedicalDocumentResponse(document);
  }

  @Get(':documentId/download-url')
  @ApiOperation({
    summary: 'Get a temporary download URL for an accepted document',
    description:
      'Generates a private S3 URL valid for five minutes. Only accepted documents can be downloaded.',
  })
  @ApiParam({
    name: 'documentId',
    format: 'uuid',
    description: 'Medical document identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Temporary private download URL generated.',
    type: MedicalDocumentDownloadResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 403,
    description: 'The document belongs to another user.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Medical document not found.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'The document has not been accepted.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 502,
    description: 'S3 could not generate the download URL.',
    type: HttpErrorDto,
  })
  async getDownloadUrl(
    @Param('documentId') documentId: string,
    @Request() request: { user: { id: string } },
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    return this.downloader.run(documentId, request.user.id);
  }
}

@ApiTags('medical-documents')
@Controller('animals/:animalId/medical-documents')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class AnimalMedicalDocumentController {
  constructor(private readonly finder: MedicalDocumentFinder) {}

  @Get()
  @ApiOperation({
    summary: 'List accepted medical documents associated with an animal',
    description:
      'Returns structured accepted documents ordered from newest to oldest after validating animal ownership. Use category to build category-specific views without downloading the original file. validatedExtraction is the user-approved source of truth.',
  })
  @ApiParam({
    name: 'animalId',
    format: 'uuid',
    description: 'Animal identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Accepted documents associated with the animal.',
    type: [MedicalDocumentResponseDto],
  })
  @ApiResponse({
    status: 400,
    description: 'The category query parameter is not supported.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 403,
    description: 'The animal belongs to another user.',
    type: HttpErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Animal not found.',
    type: HttpErrorDto,
  })
  async findByAnimal(
    @Param('animalId') animalId: string,
    @Query() query: FindMedicalDocumentsDto,
    @Request() request: { user: { id: string } },
  ): Promise<MedicalDocumentResponseDto[]> {
    const documents = await this.finder.findByAnimal(
      animalId,
      request.user.id,
      query.category,
    );
    return documents.map(toMedicalDocumentResponse);
  }
}
