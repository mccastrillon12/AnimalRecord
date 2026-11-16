import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateAnimalDto } from './create-animal.dto';

export class UpdateAnimalDto extends PartialType(CreateAnimalDto) {
  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Legacy compatibility only: must equal the current owner. Ownership changes require a transfer.',
  })
  ownerId?: string;
}
