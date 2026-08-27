import { ApiProperty } from '@nestjs/swagger';
import { MedicalDocumentRejectionReason } from '../../context/medical-document/domain/medical-document';

export class MedicalDocumentRejectionReasonOptionDto {
  @ApiProperty({
    enum: MedicalDocumentRejectionReason,
    enumName: 'MedicalDocumentRejectionReason',
  })
  code: MedicalDocumentRejectionReason;

  @ApiProperty({ example: 'Información incorrecta' })
  label: string;

  @ApiProperty({ example: false })
  requiresComment: boolean;
}

export const MEDICAL_DOCUMENT_REJECTION_REASON_OPTIONS: ReadonlyArray<MedicalDocumentRejectionReasonOptionDto> =
  [
    {
      code: MedicalDocumentRejectionReason.IncorrectInformation,
      label: 'Información incorrecta',
      requiresComment: false,
    },
    {
      code: MedicalDocumentRejectionReason.WrongAnimal,
      label: 'El archivo no es el correspondiente al animal',
      requiresComment: false,
    },
    {
      code: MedicalDocumentRejectionReason.Other,
      label: 'Otros',
      requiresComment: true,
    },
  ];
