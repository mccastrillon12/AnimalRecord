import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsArray, IsBoolean } from 'class-validator';

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

    @ApiProperty({ example: '+573001234567', required: false })
    @IsString()
    @IsOptional()
    cellPhone: string;

    @ApiProperty({ example: 'Colombia' })
    @IsString()
    @IsNotEmpty()
    country: string;

    @ApiProperty({ example: 'Bogotá' })
    @IsString()
    @IsOptional()
    city?: string;

    @ApiProperty({ example: ['PROPIETARIO_MASCOTA'], description: 'User roles' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    roles?: string[];

    @ApiProperty({ example: 'TP-12345-VET', description: 'Professional license ID', required: false })
    @IsString()
    @IsOptional()
    professionalCard?: string;

    @ApiProperty({ example: ['DOG', 'CAT'], description: 'Types of animals treated', required: false, type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    animalTypes?: string[];

    @ApiProperty({ example: ['CONSULTATION', 'SURGERY'], description: 'Services offered', required: false, type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    services?: string[];

    @ApiProperty({ example: true, description: 'Whether home delivery is available', required: false })
    @IsBoolean()
    @IsOptional()
    isHomeDelivery?: boolean;
}
