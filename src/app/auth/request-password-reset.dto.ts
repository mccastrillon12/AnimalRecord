import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RequestPasswordResetDto {
    @ApiProperty({ example: 'user@example.com', description: 'User email or cell phone' })
    @IsString()
    @IsNotEmpty()
    identifier: string;
}
