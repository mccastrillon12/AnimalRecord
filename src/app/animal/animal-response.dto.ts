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

    @ApiProperty({ example: '2023-01-01', description: 'Birth date', required: false })
    birthDate?: string;

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

    @ApiProperty({ example: 'Finca', description: 'Housing type', required: false })
    housingType?: string;

    @ApiProperty({ example: 'Compañía / Mascota', description: 'Animal purpose', required: false })
    purpose?: string;

    @ApiProperty({ example: 'Cesárea', description: 'Birth type', required: false })
    birthType?: string;

    @ApiProperty({ example: 'Bajo peso', description: 'Birth condition', required: false })
    birthCondition?: string;

    @ApiProperty({ example: 'https://bucket.s3.region.amazonaws.com/users/.../profile_123.jpeg', description: 'Profile picture URL', required: false })
    profilePictureUrl?: string;

    @ApiProperty({ example: '2026-04-25T15:00:00.000Z', description: 'Creation date', required: false })
    createdAt?: string;

    @ApiProperty({ example: '2026-04-25T16:00:00.000Z', description: 'Last general update date (any field change)', required: false })
    updatedAt?: string;

    @ApiProperty({ example: true, description: 'Is the animal adopted?', required: false })
    isAdopted?: boolean;

    @ApiProperty({ example: 'Fundación', description: 'Where the animal was adopted from', required: false })
    adoptionSource?: string;

    @ApiProperty({ example: 'Fundación Amigos Peludos', description: 'Name of the adoption place', required: false })
    adoptionPlaceName?: string;

    @ApiProperty({ example: 'Microchip', description: 'Type of identification', required: false })
    identificationType?: string;

    @ApiProperty({ example: '900123456789012', description: 'Identification number', required: false })
    identificationNumber?: string;

    @ApiProperty({ example: 'ACCC – Asociación Club Canino Colombiano', description: 'Registration association', required: false })
    registrationAssociation?: string;

    @ApiProperty({ example: '2026-04-25T16:00:00.000Z', description: 'Last name change date', required: false })
    nameUpdatedAt?: string;

    @ApiProperty({ example: 'Concentrado', description: 'Feeding type', required: false })
    feedingType?: string;

    @ApiProperty({
        example: [
            { name: 'Max', date: '2026-01-15T10:00:00.000Z' },
            { name: 'Rocky', date: '2026-03-20T14:30:00.000Z' }
        ],
        description: 'History of all names (first entry is the original name at creation)',
        required: false,
        type: 'array',
        items: {
            type: 'object',
            properties: {
                name: { type: 'string', example: 'Max' },
                date: { type: 'string', example: '2026-01-15T10:00:00.000Z' }
            }
        }
    })
    nameHistory?: Array<{ name: string; date: string }>;

    @ApiProperty({ example: true, description: 'Is the animal active?', required: false })
    isActive?: boolean;
}
