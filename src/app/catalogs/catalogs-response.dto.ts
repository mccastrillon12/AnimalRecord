import { ApiProperty } from '@nestjs/swagger';

export class SpeciesResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;
}

export class BreedResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;

    @ApiProperty()
    speciesId: string;
}

export class HousingTypeResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;
}

export class AnimalPurposeResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;
}

export class TemperamentResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;
}

export class AdoptionSourceResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;
}
