import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AnimalTransferReasonCode,
  AnimalTransferRejectionReasonCode,
} from '../../context/catalogs/domain/animal-transfer-reason';
import {
  TRANSFER_ITEM_STATUSES,
  TRANSFER_LIST_FILTERS,
  TRANSFER_REQUEST_STATUSES,
  type TransferAnimalAge,
  type TransferRequestRecord,
  type TransferRequestItem,
} from '../../context/animal-transfer/domain/transfer-request';
export class TransferRequestAuthorizationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() challengeId: string;
  @ApiProperty({
    description:
      'Single-use ANIMAL_TRANSFER proof returned by OTP verification',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  proof: string;
}
export class CreateTransferRequestDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Required only for reasonCode OTHER.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonComment?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() recipientId: string;
  @ApiProperty({ enum: AnimalTransferReasonCode })
  @IsEnum(AnimalTransferReasonCode)
  reasonCode: AnimalTransferReasonCode;
  @ApiProperty({ type: [String], minItems: 1, uniqueItems: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  animalIds: string[];
  @ApiProperty({ type: TransferRequestAuthorizationDto })
  @ValidateNested()
  @Type(() => TransferRequestAuthorizationDto)
  authorization: TransferRequestAuthorizationDto;
}
export class TransferRequestIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id: string;
}
export class TransferDecisionDto {
  @ApiPropertyOptional({
    enum: AnimalTransferRejectionReasonCode,
    description: 'Common reason for all rejected animals in this decision.',
  })
  @IsOptional()
  @IsEnum(AnimalTransferRejectionReasonCode)
  rejectionReasonCode?: AnimalTransferRejectionReasonCode;
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Required only for rejectionReasonCode OTHER.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionComment?: string;
  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedVersion: number;
  @ApiProperty({
    type: [String],
    description:
      'Only an empty selection (reject all) is enabled. Nonempty selections return 409 without changes.',
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  acceptedAnimalIds: string[];
}
export class TransferRequestPageDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
export class TransferRequestListDto extends TransferRequestPageDto {
  @ApiPropertyOptional({ enum: ['INCOMING', 'OUTGOING'], default: 'INCOMING' })
  @IsIn(['INCOMING', 'OUTGOING'])
  direction: 'INCOMING' | 'OUTGOING' = 'INCOMING';
  @ApiPropertyOptional({ enum: TRANSFER_LIST_FILTERS })
  @IsOptional()
  @IsIn(TRANSFER_LIST_FILTERS)
  status?: (typeof TRANSFER_LIST_FILTERS)[number];
}
export class TransferRequestResponseDto {
  @ApiPropertyOptional() reasonComment?: string;
  @ApiPropertyOptional({ enum: AnimalTransferRejectionReasonCode })
  rejectionReasonCode?: AnimalTransferRejectionReasonCode;
  @ApiPropertyOptional() rejectionReasonName?: string;
  @ApiPropertyOptional() rejectionComment?: string;
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) senderId: string;
  @ApiProperty() senderName: string;
  @ApiProperty({ format: 'uuid' }) recipientId: string;
  @ApiProperty() recipientName: string;
  @ApiProperty({ enum: AnimalTransferReasonCode })
  reasonCode: AnimalTransferReasonCode;
  @ApiProperty() reasonName: string;
  @ApiProperty({ enum: TRANSFER_REQUEST_STATUSES })
  status: TransferRequestRecord['status'];
  @ApiPropertyOptional({ format: 'date-time' }) decidedAt?: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiPropertyOptional({ format: 'date-time' }) expiresAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) expiredAt?: string;
  @ApiProperty() animalCount: number;
  @ApiProperty({ minimum: 1 }) version: number;
}
export class TransferRequestItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) animalId: string;
  @ApiProperty() animalName: string;
  @ApiProperty() animalCode: string;
  @ApiPropertyOptional() animalBreed?: string;
  @ApiPropertyOptional() animalSex?: string;
  @ApiPropertyOptional({
    format: 'uri',
    description: 'Short-lived signed URL for the authorized transfer preview',
  })
  animalProfilePictureUrl?: string;
  @ApiPropertyOptional({
    description: 'Age at the time of the request, in whole months',
    oneOf: [
      {
        type: 'object',
        required: ['type', 'months'],
        properties: {
          type: { type: 'string', enum: ['EXACT'] },
          months: { type: 'integer', minimum: 0 },
        },
      },
      {
        type: 'object',
        required: ['type', 'minMonths', 'maxMonths'],
        properties: {
          type: { type: 'string', enum: ['APPROXIMATE'] },
          minMonths: { type: 'integer', minimum: 0 },
          maxMonths: { type: 'integer', minimum: 0 },
        },
      },
    ],
  })
  animalAge?: TransferAnimalAge;
  @ApiProperty({ enum: TRANSFER_ITEM_STATUSES })
  status: TransferRequestItem['status'];
}
export class TransferRequestListResponseDto {
  @ApiProperty({ type: [TransferRequestResponseDto] })
  items: TransferRequestResponseDto[];
  @ApiPropertyOptional() nextCursor?: string;
}
export class TransferRequestDetailResponseDto {
  @ApiProperty({ type: TransferRequestResponseDto })
  request: TransferRequestResponseDto;
  @ApiProperty({ type: [TransferRequestItemResponseDto] })
  items: TransferRequestItemResponseDto[];
  @ApiPropertyOptional() nextCursor?: string;
}
