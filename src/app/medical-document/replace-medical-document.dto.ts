import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MedicalDocumentAssignmentDto,
  MedicalDocumentReviewDecision,
  ValidatedMedicalDocumentExtractionDto,
} from './review-medical-document.dto';
import { MedicalDocumentType } from '../../context/medical-document/domain/medical-document';

const toNumber = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() ? Number(value) : value;

const parseAnimalIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

const normalizeDescription = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class AnalyzeMedicalDocumentReplacementDto {
  @ApiProperty({ example: 2, minimum: 1 })
  @Transform(({ value }) => toNumber(value))
  @IsInt()
  @Min(1)
  documentVersion: number;

  @ApiProperty({ type: [String], minItems: 1, format: 'uuid' })
  @Transform(({ value }) => parseAnimalIds(value))
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  animalIds: string[];

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(({ value }) => normalizeDescription(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class MedicalDocumentReplacementVersionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  documentId: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  version: number;
}

export class ReviewMedicalDocumentReplacementDto {
  @ApiProperty({
    enum: MedicalDocumentReviewDecision,
    enumName: 'MedicalDocumentReviewDecision',
  })
  @IsEnum(MedicalDocumentReviewDecision)
  decision: MedicalDocumentReviewDecision;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  candidateDocumentId: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  documentVersion: number;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  candidateVersion: number;

  @ApiPropertyOptional({ type: [MedicalDocumentReplacementVersionDto] })
  @ValidateIf(
    (dto: ReviewMedicalDocumentReplacementDto) =>
      dto.decision === MedicalDocumentReviewDecision.Accept,
  )
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MedicalDocumentReplacementVersionDto)
  documentVersions?: MedicalDocumentReplacementVersionDto[];

  @ApiPropertyOptional({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    description:
      'Final category selected by the user. It controls the destination folder and may differ from the detected or extracted document type.',
  })
  @ValidateIf(
    (dto: ReviewMedicalDocumentReplacementDto) =>
      dto.decision === MedicalDocumentReviewDecision.Accept,
  )
  @IsDefined()
  @IsEnum(MedicalDocumentType)
  finalCategory?: MedicalDocumentType;

  @ApiPropertyOptional({ type: ValidatedMedicalDocumentExtractionDto })
  @ValidateIf(
    (dto: ReviewMedicalDocumentReplacementDto) =>
      dto.decision === MedicalDocumentReviewDecision.Accept,
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => ValidatedMedicalDocumentExtractionDto)
  validatedExtraction?: ValidatedMedicalDocumentExtractionDto;

  @ApiPropertyOptional({ type: [MedicalDocumentAssignmentDto] })
  @ValidateIf(
    (dto: ReviewMedicalDocumentReplacementDto) =>
      dto.decision === MedicalDocumentReviewDecision.Accept,
  )
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MedicalDocumentAssignmentDto)
  assignments?: MedicalDocumentAssignmentDto[];
}

export class RemoveMedicalDocumentFromAnimalDto {
  @ApiProperty({ example: 2, minimum: 1 })
  @Transform(({ value }) => toNumber(value))
  @IsInt()
  @Min(1)
  documentVersion: number;
}
