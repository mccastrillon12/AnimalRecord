import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateDiaryEntryDto {
    @ApiProperty({ example: 'Estado de ánimo Brownie', description: 'Entry title' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'Hoy 17 de marzo vi a Brownie muy decaido...', description: 'Entry content' })
    @IsString()
    content: string;

    @ApiProperty({ example: '2026-03-17T00:00:00.000Z', description: 'Date of the diary entry (ISO string)' })
    @IsString()
    date: string;
}
