import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
    @ApiProperty()
    @IsString()
    id: string;

    @ApiProperty()
    @IsString()
    name: string;

    @ApiProperty()
    @IsString()
    identificationType: string;

    @ApiProperty()
    @IsString()
    identificationNumber: string;

    @ApiProperty()
    @IsString()
    country: string;

    @ApiProperty()
    @IsString()
    @IsOptional()
    city: string;

    @ApiProperty()
    @IsString()
    @IsOptional()
    email: string;

    @ApiProperty()
    @IsString()
    @IsOptional()
    cellPhone: string;

    @ApiProperty()
    @IsString()
    @IsOptional()
    professionalCard: string;

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    animalTypes: string[];

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    services: string[];

    @ApiProperty()
    @IsBoolean()
    @IsOptional()
    isHomeDelivery: boolean;

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    roles: string[];

    @ApiProperty()
    @IsString()
    @IsOptional()
    password?: string;
}
