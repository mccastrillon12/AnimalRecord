import { ApiProperty } from '@nestjs/swagger';

export class CountryResponseDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'Country UUID' })
    id: string;

    @ApiProperty({ example: 'Colombia', description: 'Country Name' })
    name: string;

    @ApiProperty({ example: 'CO', description: 'ISO 3166-1 alpha-2 code (for flags)' })
    isoCode: string;

    @ApiProperty({ example: '+57', description: 'Country dialing code' })
    dialCode: string;
}

export class DepartmentResponseDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'Department UUID' })
    id: string;

    @ApiProperty({ example: 'Antioquia', description: 'Department Name' })
    name: string;

    @ApiProperty({ example: '123e4567-country-uuid', description: 'Country UUID reference' })
    countryId: string;
}

export class CityResponseDto {
    @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174090', description: 'City UUID' })
    id: string;

    @ApiProperty({ example: 'Medellín', description: 'City Name' })
    name: string;

    @ApiProperty({ example: '123e4567-dept-uuid', description: 'Department UUID reference' })
    departmentId: string;
}
