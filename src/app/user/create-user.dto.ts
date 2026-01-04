import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsString } from 'class-validator';

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
    city: string;

    @ApiProperty()
    @IsString()
    email: string;

    @ApiProperty()
    @IsString()
    cellPhone: string;

    @ApiProperty()
    @IsString()
    professionalCard: string;

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    animalTypes: string[];

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    services: string[];

    @ApiProperty()
    @IsBoolean()
    isHomeDelivery: boolean;
}
