import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MedicalDocument,
  MedicalDocumentAssignment,
  MedicalDocumentExtraction,
  MedicalDocumentStatus,
} from '../../context/medical-document/domain/medical-document';
import {
  MedicalDocumentAssignmentDto,
  ValidatedMedicalDocumentExtractionDto,
} from './review-medical-document.dto';

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
    type: ValidatedMedicalDocumentExtractionDto,
    description:
      'AI extraction while pending review, or the user-validated extraction after acceptance',
  })
  extraction?: MedicalDocumentExtraction;

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
    extraction: document.validatedExtraction || document.extraction,
    assignments: document.assignments,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    reviewedAt: document.reviewedAt,
  };
}
