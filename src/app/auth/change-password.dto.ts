import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
    @ApiProperty({ example: 'OldP@ssw0rd!', description: 'Current password' })
    @IsString()
    @IsNotEmpty()
    oldPassword: string;

    @ApiProperty({ example: 'NewSecureP@ssw0rd!', description: 'New password' })
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    newPassword: string;
}
