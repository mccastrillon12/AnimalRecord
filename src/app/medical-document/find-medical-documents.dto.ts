import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { MedicalDocumentType } from '../../context/medical-document/domain/medical-document';

export class FindMedicalDocumentsDto {
  @ApiPropertyOptional({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    example: MedicalDocumentType.Prescription,
    description:
      'Final category selected by the user. Omit it to return every accepted category.',
  })
  @IsOptional()
  @IsEnum(MedicalDocumentType)
  category?: MedicalDocumentType;
}
