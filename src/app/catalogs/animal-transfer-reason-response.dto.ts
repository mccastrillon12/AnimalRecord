import { ApiProperty } from '@nestjs/swagger';
import { AnimalTransferReasonCode } from '../../context/catalogs/domain/animal-transfer-reason';

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
    description: 'No transfer reason currently requires a comment.',
  })
  requiresComment: boolean;
}
