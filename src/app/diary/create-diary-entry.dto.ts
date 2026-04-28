import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CreateDiaryEntryDto {
    @ApiProperty({ example: 'Estado de ánimo Brownie', description: 'Entry title' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'Hoy 17 de marzo vi a Brownie muy decaido...', description: 'Entry content', required: false })
    @IsString()
    @IsOptional()
    content?: string;

    @ApiProperty({ example: '2026-03-17T00:00:00.000Z', description: 'Date of the diary entry (ISO string). Defaults to now if not provided.', required: false })
    @IsString()
    @IsOptional()
    date?: string;
}
