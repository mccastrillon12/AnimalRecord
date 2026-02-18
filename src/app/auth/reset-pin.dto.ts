import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPinDto {
    @ApiProperty({ description: 'Email or Phone' })
    @IsString()
    @IsNotEmpty()
    identifier: string;

    @ApiProperty({ description: 'Reset Token from Link' })
    @IsString()
    @IsNotEmpty()
    token: string;

    @ApiProperty({ description: 'New PIN (4 digits)' })
    @IsString()
    @IsNotEmpty()
    @MinLength(4)
    @MaxLength(4)
    newPin: string;
}
