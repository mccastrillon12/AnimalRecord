import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CheckAvailabilityDto {
    @ApiPropertyOptional({ example: 'usuario@ejemplo.com', description: 'Email to check' })
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiPropertyOptional({ example: '3001234567', description: 'Cell phone to check' })
    @IsOptional()
    @IsString()
    cellPhone?: string;

    @ApiPropertyOptional({ example: '123456789', description: 'Identification number to check' })
    @IsOptional()
    @IsString()
    identificationNumber?: string;
}
