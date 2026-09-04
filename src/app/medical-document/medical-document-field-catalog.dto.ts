import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import {
  MedicalDocumentFieldKind,
  type MedicalDocumentFieldCatalogResponse,
} from '../../context/medical-document/application/medical-document-field-catalog';
import { MedicalDocumentType } from '../../context/medical-document/domain/medical-document';

export class MedicalDocumentFieldCatalogQueryDto {
  @ApiProperty({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
    example: MedicalDocumentType.LaboratoryResult,
    description: 'Medical extraction category whose presentation is required.',
  })
  @IsEnum(MedicalDocumentType)
  category: MedicalDocumentType;

  @ApiPropertyOptional({
    enum: ['es', 'es-CO'],
    default: 'es-CO',
    description:
      'Requested UI locale. Both supported values currently resolve to es-CO.',
  })
  @IsOptional()
  @IsIn(['es', 'es-CO'])
  locale?: 'es' | 'es-CO';
}

export class MedicalDocumentFieldCatalogSectionDto {
  @ApiProperty({ example: 'patient' })
  key: string;

  @ApiProperty({ example: 'Paciente' })
  label: string;

  @ApiProperty({ example: 30 })
  order: number;
}

export class MedicalDocumentFieldCatalogColumnDto {
  @ApiProperty({ example: 'referenceRange' })
  key: string;

  @ApiProperty({ example: 'Rango de referencia' })
  label: string;

  @ApiProperty({
    enum: MedicalDocumentFieldKind,
    enumName: 'MedicalDocumentFieldKind',
  })
  kind: MedicalDocumentFieldKind;

  @ApiProperty({ example: 50 })
  order: number;

  @ApiProperty({ example: true })
  editable: boolean;

  @ApiProperty({ example: true })
  hideWhenEmpty: boolean;
}

export class MedicalDocumentFieldCatalogFieldDto {
  @ApiProperty({ example: 'laboratoryResults' })
  path: string;

  @ApiProperty({ example: 'Resultados de laboratorio' })
  label: string;

  @ApiProperty({ example: 'laboratoryResults' })
  sectionKey: string;

  @ApiProperty({ example: 10 })
  order: number;

  @ApiProperty({
    enum: MedicalDocumentFieldKind,
    enumName: 'MedicalDocumentFieldKind',
  })
  kind: MedicalDocumentFieldKind;

  @ApiProperty({ example: true })
  editable: boolean;

  @ApiProperty({ example: true })
  hideWhenEmpty: boolean;

  @ApiPropertyOptional({
    type: [MedicalDocumentFieldCatalogColumnDto],
    description: 'Ordered columns when kind is TABLE.',
  })
  columns?: MedicalDocumentFieldCatalogColumnDto[];

  @ApiPropertyOptional({
    example: 'Campo adicional',
    description:
      'Generic Spanish label for keys that cannot be known by the catalog.',
  })
  fallbackLabel?: string;
}

export class MedicalDocumentFieldCatalogResponseDto implements MedicalDocumentFieldCatalogResponse {
  @ApiProperty({ example: '1.0.0' })
  catalogVersion: string;

  @ApiProperty({ example: 'es-CO', enum: ['es-CO'] })
  locale: 'es-CO';

  @ApiProperty({
    enum: MedicalDocumentType,
    enumName: 'MedicalDocumentType',
  })
  category: MedicalDocumentType;

  @ApiProperty({ example: 'Resultado de laboratorio' })
  categoryLabel: string;

  @ApiProperty({ type: [MedicalDocumentFieldCatalogSectionDto] })
  sections: MedicalDocumentFieldCatalogSectionDto[];

  @ApiProperty({ type: [MedicalDocumentFieldCatalogFieldDto] })
  fields: MedicalDocumentFieldCatalogFieldDto[];

  @ApiProperty({
    type: [String],
    example: ['id', 'confidence', 'source'],
    description:
      'Keys that clients must preserve but should not render as ordinary editable fields.',
  })
  hiddenTechnicalKeys: string[];
}
