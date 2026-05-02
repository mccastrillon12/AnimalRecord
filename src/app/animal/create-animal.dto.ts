import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAnimalDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'Unique animal ID (UUID)' })
    @IsString()
    id: string;

    @ApiProperty({ example: 'Max', description: 'Animal name' })
    @IsString()
    name: string;

    @ApiProperty({ example: 'DOG', description: 'Animal species (DOG, CAT, BOVINE, EQUINE)', enum: ['DOG', 'CAT', 'BOVINE', 'EQUINE'] })
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

    @ApiProperty({ example: '2023-01-01', description: 'Date of birth (YYYY-MM-DD)', required: false })
    @IsString()
    @IsOptional()
    birthDate?: string;

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

    @ApiProperty({ example: 'Finca', description: 'Type of housing', required: false })
    @IsString()
    @IsOptional()
    housingType?: string;

    @ApiProperty({ example: 'Producción de Leche', description: 'Purpose of the animal', required: false })
    @IsString()
    @IsOptional()
    purpose?: string;

    @ApiProperty({ example: 'Pasto', description: 'Type of feeding', required: false })
    @IsString()
    @IsOptional()
    feedingType?: string;

    @ApiProperty({ example: 'Natural', description: 'Type of birth', required: false })
    @IsString()
    @IsOptional()
    birthType?: string;

    @ApiProperty({ example: 'Normal', description: 'Condition at birth', required: false })
    @IsString()
    @IsOptional()
    birthCondition?: string;

    @ApiProperty({ example: true, description: 'Is the animal adopted?', required: false })
    @IsBoolean()
    @IsOptional()
    isAdopted?: boolean;

    @ApiProperty({ example: 'Fundación', description: 'Where the animal was adopted from (dropdown)', required: false })
    @IsString()
    @IsOptional()
    adoptionSource?: string;

    @ApiProperty({ example: 'Fundación Amigos Peludos', description: 'Name of the adoption place', required: false })
    @IsString()
    @IsOptional()
    adoptionPlaceName?: string;

    @ApiProperty({ example: 'Microchip', description: 'Type of identification (dropdown)', required: false })
    @IsString()
    @IsOptional()
    identificationType?: string;

    @ApiProperty({ example: '900123456789012', description: 'Identification number', required: false })
    @IsString()
    @IsOptional()
    identificationNumber?: string;

    @ApiProperty({ example: 'ACCC – Asociación Club Canino Colombiano', description: 'Registration association (dropdown)', required: false })
    @IsString()
    @IsOptional()
    registrationAssociation?: string;

    @ApiProperty({ example: true, description: 'Is the animal active?', required: false })
    @IsBoolean()
    @IsOptional()
    isActive?: boolean;

    @ApiProperty({ example: true, description: 'User does not know exact birth date', required: false })
    @IsBoolean()
    @IsOptional()
    unknownBirthDate?: boolean;

    @ApiProperty({ example: 0, description: 'Approximate age range min (months)', required: false })
    @IsNumber()
    @IsOptional()
    approximateAgeMinMonths?: number;

    @ApiProperty({ example: 6, description: 'Approximate age range max (months)', required: false })
    @IsNumber()
    @IsOptional()
    approximateAgeMaxMonths?: number;

    @ApiProperty({ example: true, description: 'Diagnosis is "Other" (not in catalog)', required: false })
    @IsBoolean()
    @IsOptional()
    otherDiagnosis?: boolean;

    @ApiProperty({ example: 'Síndrome vestibular', description: 'Custom diagnosis detail when otherDiagnosis=true', required: false })
    @IsString()
    @IsOptional()
    otherDiagnosisDetail?: string;

    @ApiProperty({ example: 'Fallecimiento del paciente', description: 'Reason for deactivation (from catalog dropdown)', required: false })
    @IsString()
    @IsOptional()
    deactivationReason?: string;
}
