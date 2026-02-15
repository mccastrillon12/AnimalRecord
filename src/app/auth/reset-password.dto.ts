import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
    @ApiProperty({ example: 'user@example.com', description: 'User email or cell phone' })
    @IsString()
    @IsNotEmpty()
    identifier: string;

    @ApiProperty({ example: '123456', description: 'Reset password code or token from link' })
    @IsString()
    @IsNotEmpty()
    code: string;

    @ApiProperty({ example: 'NewSecureP@ssw0rd!', description: 'New password' })
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    newPassword: string;
}
