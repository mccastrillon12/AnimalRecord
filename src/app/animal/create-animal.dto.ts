import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAnimalDto {
    @ApiProperty()
    @IsString()
    id: string;

    @ApiProperty()
    @IsString()
    name: string;

    @ApiProperty()
    @IsString()
    species: string;

    @ApiProperty()
    @IsString()
    breed: string;

    @ApiProperty()
    @IsString()
    sex: string;

    @ApiProperty()
    @IsString()
    reproductiveStatus: string;

    @ApiProperty()
    @IsString()
    birthDate: string;

    @ApiProperty()
    @IsBoolean()
    hasChip: boolean;

    @ApiProperty()
    @IsBoolean()
    isAssociationMember: boolean;

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    temperament: string[];

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    diagnosis: string[];

    @ApiProperty()
    @IsString()
    ownerId: string;

    @ApiProperty()
    @IsNumber()
    @IsOptional()
    weight?: number;

    @ApiProperty()
    @IsString()
    @IsOptional()
    colorAndMarkings?: string;

    @ApiProperty()
    @IsString()
    @IsOptional()
    allergies?: string;
}
