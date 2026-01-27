import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsPhoneNumber, IsOptional } from 'class-validator';

export class SocialRegisterDto {
    @ApiProperty({
        description: 'Pre-Auth Token received from /auth/social/check',
        example: 'eyJhbGciOiJIUzI1Ni...'
    })
    @IsString()
    @IsNotEmpty()
    preAuthToken: string;

    @ApiProperty({ example: '123456789' })
    @IsString()
    @IsNotEmpty()
    identificationNumber: string;

    @ApiProperty({ example: 'CC' })
    @IsString()
    @IsNotEmpty()
    identificationType: string;

    @ApiProperty({ example: '+573001234567' })
    @IsPhoneNumber() // Or IsString if strict validation not needed yet
    @IsNotEmpty()
    cellPhone: string;

    @ApiProperty({ example: 'Colombia' })
    @IsString()
    @IsNotEmpty()
    country: string;

    @ApiProperty({ example: 'Bogotá' })
    @IsString()
    @IsOptional()
    city?: string;
}
