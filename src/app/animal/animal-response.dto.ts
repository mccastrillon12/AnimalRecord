import { ApiProperty } from '@nestjs/swagger';

export class AnimalResponseDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'Unique animal ID (UUID)' })
    id: string;

    @ApiProperty({ example: 'Max', description: 'Animal name' })
    name: string;

    @ApiProperty({ example: 'DOG', description: 'Species' })
    species: string;

    @ApiProperty({ example: 'Golden Retriever', description: 'Breed' })
    breed: string;

    @ApiProperty({ example: 'MALE', description: 'Sex' })
    sex: string;

    @ApiProperty({ example: 'INTACT', description: 'Reproductive status' })
    reproductiveStatus: string;

    @ApiProperty({ example: '2023-01-01', description: 'Birth date' })
    birthDate: string;

    @ApiProperty({ example: true, description: 'Has chip?' })
    hasChip: boolean;

    @ApiProperty({ example: false, description: 'Is association member?' })
    isAssociationMember: boolean;

    @ApiProperty({ example: ['FRIENDLY'], description: 'Temperament' })
    temperament: string[];

    @ApiProperty({ example: ['HEALTHY'], description: 'Diagnosis' })
    diagnosis: string[];

    @ApiProperty({ example: '123e4567-user-uuid', description: 'Owner ID' })
    ownerId: string;

    @ApiProperty({ example: 'AR-D001', description: 'Animal Code' })
    code: string;

    @ApiProperty({ example: 25.5, description: 'Weight', required: false })
    weight?: number;

    @ApiProperty({ example: 'Golden', description: 'Color', required: false })
    colorAndMarkings?: string;

    @ApiProperty({ example: 'None', description: 'Allergies', required: false })
    allergies?: string;
}
