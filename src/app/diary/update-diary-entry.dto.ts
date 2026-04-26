import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateDiaryEntryDto {
    @ApiProperty({ example: 'Nuevo título', description: 'Updated title' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'Contenido actualizado...', description: 'Updated content' })
    @IsString()
    content: string;
}
