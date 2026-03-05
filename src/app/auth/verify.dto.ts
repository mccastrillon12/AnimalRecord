import { IsString, IsNotEmpty, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyDto {
    @ApiProperty({ example: 'user@example.com / +57...', description: 'User email or cell phone' })
    @IsString()
    @IsNotEmpty()
    identifier: string;

    @ApiProperty({ example: '123456', description: 'Verification code' })
    @IsString()
    @IsNotEmpty()
    code: string;
}
