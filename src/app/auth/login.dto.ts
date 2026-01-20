import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
    @ApiProperty({
        description: 'Email or cell phone number of the user',
        example: 'user@example.com'
    })
    @IsString()
    @IsNotEmpty()
    identifier: string;

    @ApiProperty({
        description: 'User password',
        example: 'SecurePass123!'
    })
    @IsString()
    @IsNotEmpty()
    password: string;
}
