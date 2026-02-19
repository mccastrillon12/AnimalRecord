import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ValidateTokenDto {
    @ApiProperty({ example: 'user@example.com', description: 'User identifier (email or phone)' })
    @IsString()
    @IsNotEmpty()
    identifier: string;

    @ApiProperty({ example: '123456', description: 'Token to validate' })
    @IsString()
    @IsNotEmpty()
    token: string;
}
