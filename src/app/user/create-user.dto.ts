import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'Unique user ID (UUID)' })
    @IsString()
    id: string;

    @ApiProperty({ example: 'Alvaro', description: 'User first name' })
    @IsString()
    name: string;

    @ApiProperty({ example: 'CC', description: 'Identification type (OD, CC, etc.)' })
    @IsString()
    identificationType: string;

    @ApiProperty({ example: '1234567890', description: 'Identification number' })
    @IsString()
    identificationNumber: string;

    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'User country ID (UUID)' })
    @IsString()
    countryId: string;

    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'User city ID (UUID)', required: false })
    @IsString()
    @IsOptional()
    cityId: string;

    @ApiProperty({ example: 'user@example.com', description: 'User email address', required: false })
    @IsString()
    @IsOptional()
    email: string;

    @ApiProperty({ example: '+573001234567', description: 'User cell phone number', required: false })
    @IsString()
    @IsOptional()
    cellPhone: string;

    @ApiProperty({ example: 'TP-12345-VET', description: 'Professional license ID', required: false })
    @IsString()
    @IsOptional()
    professionalCard: string;

    @ApiProperty({ example: ['DOG', 'CAT'], description: 'Types of animals treated', required: false, type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    animalTypes: string[];

    @ApiProperty({ example: ['CONSULTATION', 'SURGERY'], description: 'Services offered', required: false, type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    services: string[];

    @ApiProperty({ example: true, description: 'Whether home delivery is available', required: false })
    @IsBoolean()
    @IsOptional()
    isHomeDelivery: boolean;

    @ApiProperty({ example: ['VET', 'OWNER'], description: 'User roles', required: false, type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    roles: string[];

    @ApiProperty({ example: 'SecureP@ssw0rd!', description: 'User password', required: false })
    @IsString()
    @IsOptional()
    password?: string;
}
