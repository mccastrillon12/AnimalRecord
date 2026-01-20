import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAnimalDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'Unique animal ID (UUID)' })
    @IsString()
    id: string;

    @ApiProperty({ example: 'Max', description: 'Animal name' })
    @IsString()
    name: string;

    @ApiProperty({ example: 'DOG', description: 'Animal species (DOG, CAT, BOVINE)', enum: ['DOG', 'CAT', 'BOVINE'] })
    @IsString()
    species: string;

    @ApiProperty({ example: 'Golden Retriever', description: 'Animal breed' })
    @IsString()
    breed: string;

    @ApiProperty({ example: 'MALE', description: 'Animal sex' })
    @IsString()
    sex: string;

    @ApiProperty({ example: 'INTACT', description: 'Reproductive status (INTACT, NEUTERED)' })
    @IsString()
    reproductiveStatus: string;

    @ApiProperty({ example: '2023-01-01', description: 'Date of birth (YYYY-MM-DD)' })
    @IsString()
    birthDate: string;

    @ApiProperty({ example: true, description: 'Has microchip?' })
    @IsBoolean()
    hasChip: boolean;

    @ApiProperty({ example: false, description: 'Is member of association?' })
    @IsBoolean()
    isAssociationMember: boolean;

    @ApiProperty({ example: ['FRIENDLY', 'PLAYFUL'], description: 'Temperament traits', type: [String] })
    @IsArray()
    @IsString({ each: true })
    temperament: string[];

    @ApiProperty({ example: ['HEALTHY'], description: 'Medical diagnosis', type: [String] })
    @IsArray()
    @IsString({ each: true })
    diagnosis: string[];

    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'Owner User UUID' })
    @IsString()
    ownerId: string;

    @ApiProperty({ example: 25.5, description: 'Weight in kg', required: false })
    @IsNumber()
    @IsOptional()
    weight?: number;

    @ApiProperty({ example: 'Golden', description: 'Color and markings', required: false })
    @IsString()
    @IsOptional()
    colorAndMarkings?: string;

    @ApiProperty({ example: 'None', description: 'Known allergies', required: false })
    @IsString()
    @IsOptional()
    allergies?: string;
}
