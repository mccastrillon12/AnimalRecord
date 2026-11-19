import { ApiProperty } from '@nestjs/swagger';
import {
  AnimalTransferReasonCode,
  AnimalTransferRejectionReasonCode,
} from '../../context/catalogs/domain/animal-transfer-reason';

export class AnimalTransferReasonResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: AnimalTransferReasonCode,
    enumName: 'AnimalTransferReasonCode',
  })
  code: AnimalTransferReasonCode;

  @ApiProperty({ example: 'Compra / venta' })
  name: string;

  @ApiProperty({ example: 1 })
  sortOrder: number;

  @ApiProperty({
    example: false,
    description: 'OTHER requires a nonempty comment of at most 500 characters.',
  })
  requiresComment: boolean;
}

export class AnimalTransferRejectionReasonResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: AnimalTransferRejectionReasonCode })
  code: AnimalTransferRejectionReasonCode;
  @ApiProperty() name: string;
  @ApiProperty() sortOrder: number;
  @ApiProperty() requiresComment: boolean;
}
