import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsDefined,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalDocumentType } from '../../context/medical-document/domain/medical-document';

export enum MedicalDocumentReviewDecision {
  Accept = 'ACCEPT',
  Reject = 'REJECT',
}

export class ExtractionSourceDto {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description: 'One-based page number containing the extracted value',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 'Amoxicilina 250 mg cada 12 horas',
    description: 'Evidence text supporting the extracted value',
  })
  @IsOptional()
  @IsString()
  text?: string;
}

class ExtractedItemDto {
  @ApiProperty({
    example: 'diagnosis-1',
    description:
      'Stable extraction item identifier used in per-animal assignments',
  })
  @IsString()
  id: string;

  @ApiPropertyOptional({
    example: 0.94,
    minimum: 0,
    maximum: 1,
    description: 'AI confidence score when provided by the blueprint',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({
    type: ExtractionSourceDto,
    description: 'Location and evidence found in the source document',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtractionSourceDto)
  source?: ExtractionSourceDto;
}

export class ExtractedDiagnosisDto extends ExtractedItemDto {
  @ApiProperty({ example: 'Dermatitis', description: 'Diagnosis name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: 'L30.9',
    description: 'Diagnostic code when present in the document',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    example: 'Compatible with allergic dermatitis',
    description: 'Additional diagnostic observations',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ExtractedMedicationDto extends ExtractedItemDto {
  @ApiProperty({ example: 'Amoxicilina', description: 'Medication name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: 'Amoxicilina',
    description: 'Active ingredient',
  })
  @IsOptional()
  @IsString()
  activeIngredient?: string;

  @ApiPropertyOptional({ example: 'Tabletas de 250 mg' })
  @IsOptional()
  @IsString()
  presentation?: string;

  @ApiPropertyOptional({ example: '250 mg' })
  @IsOptional()
  @IsString()
  dose?: string;

  @ApiPropertyOptional({ example: 'Oral' })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({ example: 'Cada 12 horas' })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({ example: '7 dias' })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({ example: 'Administrar despues de comer' })
  @IsOptional()
  @IsString()
  instructions?: string;
}

export class ExtractedVaccinationDto extends ExtractedItemDto {
  @ApiProperty({ example: 'Rabia', description: 'Vaccine name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Rabia'],
    description: 'Diseases covered by the vaccine',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diseasesCovered?: string[];

  @ApiPropertyOptional({ example: 'Nobivac 1' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 'Laboratorio Veterinario SA' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'Virus inactivado' })
  @IsOptional()
  @IsString()
  vaccineType?: string;

  @ApiPropertyOptional({ example: 'LOT-2026-001' })
  @IsOptional()
  @IsString()
  lot?: string;

  @ApiPropertyOptional({ example: '2027-01-31' })
  @IsOptional()
  @IsString()
  lotExpirationDate?: string;

  @ApiPropertyOptional({ example: '2026-07-19' })
  @IsOptional()
  @IsString()
  applicationDate?: string;

  @ApiPropertyOptional({ example: '2027-07-19' })
  @IsOptional()
  @IsString()
  nextDoseDate?: string;

  @ApiPropertyOptional({ example: 'Subcutanea' })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({ example: 'Miembro posterior derecho' })
  @IsOptional()
  @IsString()
  applicationSite?: string;

  @ApiPropertyOptional({ example: 'TAG-12345' })
  @IsOptional()
  @IsString()
  tagNumber?: string;

  @ApiPropertyOptional({ example: 'Dra. Ana Perez' })
  @IsOptional()
  @IsString()
  veterinarian?: string;
}

export class ExtractedMedicalOrderDto extends ExtractedItemDto {
  @ApiProperty({
    example: 'Hemograma',
    description: 'Ordered exam or procedure',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Laboratorio' })
  @IsOptional()
  @IsString()
  orderType?: string;

  @ApiPropertyOptional({ example: 'Ayuno de 8 horas' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({ example: 'Normal' })
  @IsOptional()
  @IsString()
  priority?: string;
}

export class ExtractedDiagnosticResultDto extends ExtractedItemDto {
  @ApiProperty({ example: 'Hemograma', description: 'Exam or study name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '2026-07-19' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: 'Dentro de rangos de referencia' })
  @IsOptional()
  @IsString()
  result?: string;

  @ApiPropertyOptional({ example: 'Sin alteraciones significativas' })
  @IsOptional()
  @IsString()
  interpretation?: string;

  @ApiPropertyOptional({ example: 'Final' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class ExtractedClinicalHistoryDto {
  @ApiPropertyOptional({ example: 'Prurito y enrojecimiento en ambos oidos' })
  @IsOptional()
  @IsString()
  reasonForConsultation?: string;

  @ApiPropertyOptional({ example: 'Siete dias de rascado intenso' })
  @IsOptional()
  @IsString()
  anamnesis?: string;

  @ApiPropertyOptional({ example: 'Paciente alerta, mucosas rosadas' })
  @IsOptional()
  @IsString()
  physicalExam?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Temperatura: 38.7 C', 'Frecuencia cardiaca: 96 lpm'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vitalSigns?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Eritema y secrecion ceruminosa bilateral'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clinicalFindings?: string[];

  @ApiPropertyOptional({ example: 'Paciente estable durante la consulta' })
  @IsOptional()
  @IsString()
  evolution?: string;

  @ApiPropertyOptional({ example: 'Limpieza otica cada 12 horas' })
  @IsOptional()
  @IsString()
  treatmentPlan?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Evitar humedad en los oidos'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recommendations?: string[];

  @ApiPropertyOptional({ example: 'Control en 8 dias' })
  @IsOptional()
  @IsString()
  followUp?: string;

  @ApiPropertyOptional({ example: 'Bueno con cumplimiento del tratamiento' })
  @IsOptional()
  @IsString()
  prognosis?: string;

  @ApiPropertyOptional({ example: 0.9, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({ type: ExtractionSourceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtractionSourceDto)
  source?: ExtractionSourceDto;
}

export class ExtractedReferralDto {
  @ApiPropertyOptional({ example: 'Valoracion por cardiologia' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ example: 'Hospital Veterinario Central' })
  @IsOptional()
  @IsString()
  destination?: string;

  @ApiPropertyOptional({ example: 'Cardiologia veterinaria' })
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional({ example: 'Paciente con soplo cardiaco grado II' })
  @IsOptional()
  @IsString()
  clinicalSummary?: string;

  @ApiPropertyOptional({ example: 0.9, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({ type: ExtractionSourceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtractionSourceDto)
  source?: ExtractionSourceDto;
}

export class ExtractedIssuerDto {
  @ApiPropertyOptional({ example: 'Dra. Ana Perez' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Clinica Veterinaria Central' })
  @IsOptional()
  @IsString()
  clinic?: string;

  @ApiPropertyOptional({ example: 'MV-12345' })
  @IsOptional()
  @IsString()
  professionalId?: string;
}

export class ValidatedMedicalDocumentExtractionDto {
  @ApiProperty({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    example: MedicalDocumentType.Prescription,
    description: 'Document category detected by AI and confirmed by the user',
  })
  @IsEnum(MedicalDocumentType)
  documentType: MedicalDocumentType;

  @ApiPropertyOptional({
    example: 0.97,
    minimum: 0,
    maximum: 1,
    description: 'Blueprint matching confidence',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  documentTypeConfidence?: number;

  @ApiPropertyOptional({ example: 'Prescription for dermatitis treatment' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({
    example: '2026-07-19',
    description: 'Date as written or normalized from the source document',
  })
  @IsOptional()
  @IsString()
  documentDate?: string;

  @ApiPropertyOptional({
    type: ExtractedIssuerDto,
    description: 'Veterinarian, clinic, or issuing organization',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtractedIssuerDto)
  issuer?: ExtractedIssuerDto;

  @ApiProperty({
    type: [String],
    example: ['Max'],
    description:
      'Patient names, identifiers, or other hints found in the document. These are not used to associate animals automatically.',
  })
  @IsArray()
  @IsString({ each: true })
  patientHints: string[];

  @ApiProperty({
    type: [ExtractedDiagnosisDto],
    description: 'Extracted diagnoses',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedDiagnosisDto)
  diagnoses: ExtractedDiagnosisDto[];

  @ApiProperty({
    type: [ExtractedMedicationDto],
    description: 'Extracted medications',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedMedicationDto)
  medications: ExtractedMedicationDto[];

  @ApiProperty({
    type: [ExtractedVaccinationDto],
    description: 'Extracted vaccines',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedVaccinationDto)
  vaccinations: ExtractedVaccinationDto[];

  @ApiProperty({
    type: [ExtractedMedicalOrderDto],
    description: 'Extracted exams, procedures, or medical orders',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedMedicalOrderDto)
  medicalOrders: ExtractedMedicalOrderDto[];

  @ApiPropertyOptional({
    type: ExtractedClinicalHistoryDto,
    description:
      'Structured clinical encounter or longitudinal history details',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtractedClinicalHistoryDto)
  clinicalHistory?: ExtractedClinicalHistoryDto;

  @ApiPropertyOptional({
    type: [ExtractedDiagnosticResultDto],
    description:
      'Clinically relevant exam, laboratory, imaging, or procedure results',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedDiagnosticResultDto)
  diagnosticResults?: ExtractedDiagnosticResultDto[];

  @ApiPropertyOptional({
    type: ExtractedReferralDto,
    description: 'Referral details when the document contains a referral',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtractedReferralDto)
  referral?: ExtractedReferralDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { followUp: 'Control en 7 dias' },
    description:
      'Relevant blueprint fields that do not belong to a canonical clinical section',
  })
  @IsObject()
  additionalFields: Record<string, unknown>;

  @ApiProperty({
    type: [String],
    example: ['The medication duration was not legible'],
    description: 'Extraction uncertainties that should be reviewed by the user',
  })
  @IsArray()
  @IsString({ each: true })
  warnings: string[];
}

export class MedicalDocumentAssignmentDto {
  @ApiProperty({
    format: 'uuid',
    example: '123e4567-e89b-42d3-a456-426614174090',
    description: 'Associated animal receiving the selected extracted items',
  })
  @IsUUID('4')
  animalId: string;

  @ApiProperty({
    type: [String],
    example: ['diagnosis-1', 'medication-1'],
    description:
      'IDs from diagnoses, medications, vaccinations, medicalOrders, or diagnosticResults in validatedExtraction',
  })
  @IsArray()
  @IsString({ each: true })
  extractedItemIds: string[];
}

export class ReviewMedicalDocumentDto {
  @ApiProperty({
    enum: MedicalDocumentReviewDecision,
    enumName: 'MedicalDocumentReviewDecision',
    description: 'User decision after reviewing the AI extraction',
  })
  @IsEnum(MedicalDocumentReviewDecision)
  decision: MedicalDocumentReviewDecision;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Current version returned by the medical document endpoint',
  })
  @IsInt()
  @Min(1)
  documentVersion: number;

  @ApiPropertyOptional({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    example: MedicalDocumentType.Referral,
    description:
      'Required for ACCEPT. This user-selected category controls the validated data and final storage location.',
  })
  @ValidateIf(
    (dto: { decision?: MedicalDocumentReviewDecision }) =>
      dto.decision === MedicalDocumentReviewDecision.Accept,
  )
  @IsDefined()
  @IsEnum(MedicalDocumentType)
  finalCategory?: MedicalDocumentType;

  @ApiPropertyOptional({
    type: ValidatedMedicalDocumentExtractionDto,
    description:
      'Required for ACCEPT. Contains only user-confirmed data belonging to finalCategory.',
  })
  @ValidateIf(
    (dto: { decision?: MedicalDocumentReviewDecision }) =>
      dto.decision === MedicalDocumentReviewDecision.Accept,
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => ValidatedMedicalDocumentExtractionDto)
  validatedExtraction?: ValidatedMedicalDocumentExtractionDto;

  @ApiPropertyOptional({
    type: [MedicalDocumentAssignmentDto],
    description:
      'Required for ACCEPT. Exactly one assignment must be sent for every animal associated during analysis.',
  })
  @ValidateIf(
    (dto: { decision?: MedicalDocumentReviewDecision }) =>
      dto.decision === MedicalDocumentReviewDecision.Accept,
  )
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MedicalDocumentAssignmentDto)
  assignments?: MedicalDocumentAssignmentDto[];
}
