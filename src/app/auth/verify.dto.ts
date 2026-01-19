import { IsString, IsNotEmpty, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyDto {
    @ApiProperty({ example: 'user@example.com', description: 'User email' })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({ example: '123456', description: 'Verification code' })
    @IsString()
    @IsNotEmpty()
    code: string;
}
