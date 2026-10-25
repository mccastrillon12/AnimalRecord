import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferRecipientSearchBy } from '../../context/user/domain/transfer-recipient-search';

export class SearchTransferRecipientsDto {
  @ApiProperty({ minLength: 2, maxLength: 100, example: 'Ana María' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({
    enum: TransferRecipientSearchBy,
    default: TransferRecipientSearchBy.Name,
    description:
      'IDENTIFICATION is reserved for a future release and currently returns 400.',
  })
  @IsOptional()
  @IsEnum(TransferRecipientSearchBy)
  searchBy: TransferRecipientSearchBy = TransferRecipientSearchBy.Name;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}

export class TransferRecipientResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  identificationType: string;
  @ApiProperty({
    description:
      'Used by the mobile app to contrast the identification entered by the sender.',
  })
  identificationNumber: string;
  @ApiPropertyOptional()
  profilePictureUrl?: string;
  @ApiPropertyOptional()
  countryId?: string;
  @ApiPropertyOptional()
  departmentId?: string;
  @ApiPropertyOptional()
  cityId?: string;
}

export class TransferRecipientPageResponseDto {
  @ApiProperty({ type: [TransferRecipientResponseDto] })
  items: TransferRecipientResponseDto[];
  @ApiPropertyOptional()
  nextCursor?: string;
}
