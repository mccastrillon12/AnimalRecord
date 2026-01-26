import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResendCodeDto {
    @ApiProperty({
        description: 'Email or cell phone number of the user',
        example: 'user@example.com'
    })
    @IsString()
    @IsNotEmpty()
    identifier: string;
}
