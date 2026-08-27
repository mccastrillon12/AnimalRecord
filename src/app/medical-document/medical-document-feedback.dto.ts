import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MedicalDocumentFeedbackValue } from '../../context/medical-document/domain/medical-document-feedback';

export class RecordMedicalDocumentFeedbackDto {
  @ApiProperty({
    enum: MedicalDocumentFeedbackValue,
    enumName: 'MedicalDocumentFeedbackValue',
    example: MedicalDocumentFeedbackValue.Like,
  })
  @IsEnum(MedicalDocumentFeedbackValue)
  value: MedicalDocumentFeedbackValue;
}

export class MedicalDocumentFeedbackRegisteredDto {
  @ApiProperty({ example: true })
  registered: boolean;
}

export class MedicalDocumentFeedbackSummaryDto {
  @ApiProperty({ example: 125, minimum: 0 })
  likes: number;

  @ApiProperty({ example: 18, minimum: 0 })
  dislikes: number;

  @ApiProperty({ example: 143, minimum: 0 })
  total: number;

  @ApiProperty({ example: 87.41, minimum: 0, maximum: 100 })
  approvalRate: number;
}
