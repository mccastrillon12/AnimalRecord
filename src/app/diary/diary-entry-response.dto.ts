import { ApiProperty } from '@nestjs/swagger';

export class AttachmentResponseDto {
    @ApiProperty({ example: 'a1b2c3d4-uuid' })
    id: string;

    @ApiProperty({ example: 'image.jpg' })
    fileName: string;

    @ApiProperty({ example: 'image', enum: ['image', 'audio'] })
    fileType: string;

    @ApiProperty({ example: 'image/jpeg' })
    mimeType: string;

    @ApiProperty({ example: 'https://bucket.s3.region.amazonaws.com/...' })
    url: string;

    @ApiProperty({ example: 500000 })
    size: number;

    @ApiProperty({ example: '2026-03-17T18:55:00.000Z' })
    createdAt: string;
}

export class DiaryEntryResponseDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090' })
    id: string;

    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174091' })
    animalId: string;

    @ApiProperty({ example: 'Estado de ánimo Brownie' })
    title: string;

    @ApiProperty({ example: 'Hoy 17 de marzo vi a Brownie muy decaido...' })
    content: string;

    @ApiProperty({ example: '2026-03-17T00:00:00.000Z' })
    date: string;

    @ApiProperty({ type: [AttachmentResponseDto] })
    attachments: AttachmentResponseDto[];

    @ApiProperty({ example: '2026-03-17T18:55:00.000Z' })
    createdAt: string;

    @ApiProperty({ example: '2026-03-17T18:55:00.000Z' })
    updatedAt: string;
}
