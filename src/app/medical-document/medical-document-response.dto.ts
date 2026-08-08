import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  MedicalDocument,
  MedicalDocumentAssignment,
  MedicalDocumentClassificationOutcome,
  MedicalDocumentDetectedCategory,
  MedicalDocumentExtraction,
  MedicalDocumentExtractionsByCategory,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../context/medical-document/domain/medical-document';
import {
  MedicalDocumentAssignmentDto,
  ValidatedMedicalDocumentExtractionDto,
} from './review-medical-document.dto';

export class MedicalDocumentDetectedCategoryDto {
  @ApiProperty({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    example: MedicalDocumentType.Referral,
  })
  category: MedicalDocumentType;

  @ApiPropertyOptional({ example: 0.94, minimum: 0, maximum: 1 })
  confidence?: number;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  pageStart?: number;

  @ApiPropertyOptional({ example: 2, minimum: 1 })
  pageEnd?: number;

  @ApiPropertyOptional({ example: 'Referral to veterinary cardiology' })
  summary?: string;

  @ApiPropertyOptional({
    example: 'REMISION VETERINARIA - Se remite a cardiologia',
  })
  evidence?: string;
}

export class MedicalDocumentResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '123e4567-e89b-42d3-a456-426614174010',
    description: 'Identifier used for review, status queries, and downloads',
  })
  id: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: ['123e4567-e89b-42d3-a456-426614174000'],
    description: 'Animals associated with this document',
  })
  animalIds: string[];

  @ApiProperty({
    example: 'formula-veterinaria.pdf',
    description: 'Original file name provided by the client',
  })
  originalFileName: string;

  @ApiProperty({
    enum: ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'],
    example: 'application/pdf',
  })
  mimeType: string;

  @ApiProperty({
    example: 245760,
    description: 'Original file size in bytes',
  })
  fileSize: number;

  @ApiProperty({
    enum: MedicalDocumentStatus,
    enumName: 'MedicalDocumentStatus',
    example: MedicalDocumentStatus.ReviewPending,
    description: 'Current lifecycle state of the medical document',
  })
  status: MedicalDocumentStatus;

  @ApiPropertyOptional({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    example: MedicalDocumentType.Prescription,
    description:
      'Navigation context selected before analysis. Omitted for general uploads. It is never an AI detection or a fallback for primaryDetectedCategory.',
  })
  requestedCategory?: MedicalDocumentType;

  @ApiPropertyOptional({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    example: MedicalDocumentType.Referral,
    description:
      'AI recommendation for the main purpose of the document. It remains absent when no medical category was confidently detected, regardless of requestedCategory.',
  })
  primaryDetectedCategory?: MedicalDocumentType;

  @ApiProperty({
    type: [MedicalDocumentDetectedCategoryDto],
    description:
      'Immutable medical categories detected by AI. Empty when no category was confidently detected.',
  })
  detectedCategories: MedicalDocumentDetectedCategory[];

  @ApiPropertyOptional({
    enum: MedicalDocumentClassificationOutcome,
    enumName: 'MedicalDocumentClassificationOutcome',
    example: MedicalDocumentClassificationOutcome.Mismatch,
    description:
      'Comparison between requestedCategory and the categories detected by AI',
  })
  classificationOutcome?: MedicalDocumentClassificationOutcome;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      $ref: getSchemaPath(ValidatedMedicalDocumentExtractionDto),
    },
    example: {
      REFERRAL: {
        documentType: 'REFERRAL',
        patient: { name: 'Max', species: 'Canino' },
        owner: { name: 'Laura Gomez' },
        patientHints: [],
        diagnoses: [],
        medications: [],
        vaccinations: [],
        medicalOrders: [],
        additionalFields: {},
        warnings: [],
      },
    },
    description:
      'Category-specific AI extractions available during review. Discarded category payloads are removed after acceptance.',
  })
  extractionsByCategory: MedicalDocumentExtractionsByCategory;

  @ApiPropertyOptional({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    example: MedicalDocumentType.Referral,
    description:
      'Single category chosen by the user. Present only after acceptance.',
  })
  finalCategory?: MedicalDocumentType;

  @ApiPropertyOptional({
    type: ValidatedMedicalDocumentExtractionDto,
    description:
      'User-validated data for finalCategory. Present only after acceptance.',
  })
  validatedExtraction?: MedicalDocumentExtraction;

  @ApiProperty({
    type: [MedicalDocumentAssignmentDto],
    description:
      'Accepted extraction items assigned to each animal. Empty until review is accepted',
  })
  assignments: MedicalDocumentAssignment[];

  @ApiProperty({
    example: 1,
    minimum: 1,
    description:
      'Optimistic-lock version. Send this value as documentVersion during review',
  })
  version: number;

  @ApiProperty({
    format: 'date-time',
    example: '2026-07-19T18:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-07-19T18:30:12.000Z',
  })
  updatedAt: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-07-19T18:35:00.000Z',
    description: 'Time at which the user accepted or rejected the extraction',
  })
  reviewedAt?: string;
}

export class MedicalDocumentDownloadResponseDto {
  @ApiProperty({
    format: 'uri',
    example: 'https://bucket.s3.amazonaws.com/users/.../source.pdf?X-Amz-...',
    description: 'Private, temporary S3 download URL',
  })
  downloadUrl: string;

  @ApiProperty({
    example: 300,
    description: 'URL validity in seconds',
  })
  expiresIn: number;
}

export function toMedicalDocumentResponse(
  document: MedicalDocument,
): MedicalDocumentResponseDto {
  return {
    id: document.id,
    animalIds: document.animalIds,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    status: document.status,
    requestedCategory: document.requestedCategory,
    primaryDetectedCategory: document.primaryDetectedCategory,
    detectedCategories: document.detectedCategories,
    classificationOutcome: document.classificationOutcome,
    extractionsByCategory: document.extractionsByCategory,
    finalCategory: document.finalCategory,
    validatedExtraction: document.validatedExtraction,
    assignments: document.assignments,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    reviewedAt: document.reviewedAt,
  };
}
