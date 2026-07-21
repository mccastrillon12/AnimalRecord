import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

function parseAnimalIds(value: unknown): unknown {
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
}

export class AnalyzeMedicalDocumentDto {
  @ApiProperty({
    type: [String],
    example: ['123e4567-e89b-12d3-a456-426614174090'],
    minItems: 1,
    description:
      'Animals that can receive extracted information. In multipart requests this can be a JSON array, a repeated field, or comma-separated UUIDs.',
  })
  @Transform(({ value }) => parseAnimalIds(value))
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  animalIds: string[];
}
