import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'Unique user ID (UUID)' })
    id: string;

    @ApiProperty({ example: 'Alvaro', description: 'User first name' })
    name: string;

    @ApiProperty({ example: 'CC', description: 'Identification type' })
    identificationType: string;

    @ApiProperty({ example: '1234567890', description: 'Identification number' })
    identificationNumber: string;

    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'User country ID' })
    countryId: string;

    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'User city ID', required: false })
    cityId?: string;

    @ApiProperty({ example: 'user@example.com', description: 'User email', required: false })
    email?: string;

    @ApiProperty({ example: '+573001234567', description: 'User cell phone', required: false })
    cellPhone?: string;

    @ApiProperty({ example: 'TP-12345-VET', description: 'Professional license ID', required: false })
    professionalCard?: string;

    @ApiProperty({ example: ['DOG'], description: 'Animal types treated', required: false })
    animalTypes?: string[];

    @ApiProperty({ example: ['CONSULTATION'], description: 'Services offered', required: false })
    services?: string[];

    @ApiProperty({ example: true, description: 'Home delivery available', required: false })
    isHomeDelivery?: boolean;

    @ApiProperty({ example: ['VET'], description: 'User roles' })
    roles?: string[];

    @ApiProperty({ example: true, description: 'Is user verified?' })
    isVerified: boolean;
}
