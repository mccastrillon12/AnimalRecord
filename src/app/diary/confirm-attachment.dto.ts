import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber } from 'class-validator';

export class ConfirmAttachmentDto {
    @ApiProperty({ example: 'a1b2c3d4-uuid', description: 'Attachment ID returned from upload-url' })
    @IsString()
    attachmentId: string;

    @ApiProperty({ example: 'https://bucket.s3.region.amazonaws.com/users/.../diary/...', description: 'Final S3 URL' })
    @IsString()
    finalUrl: string;

    @ApiProperty({ example: 'image.jpg', description: 'Original file name' })
    @IsString()
    fileName: string;

    @ApiProperty({ example: 'image/jpeg', description: 'MIME type of the file' })
    @IsString()
    mimeType: string;

    @ApiProperty({ example: 500000, description: 'File size in bytes' })
    @IsNumber()
    size: number;
}
