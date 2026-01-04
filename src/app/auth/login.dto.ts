import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
    @ApiProperty({ description: 'Email or cell phone number' })
    @IsString()
    @IsNotEmpty()
    identifier: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    password: string;
}
