import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreatePinDto {
    @ApiProperty({ example: '1234', description: '4-digit PIN' })
    @IsString()
    @IsNotEmpty()
    @Length(4, 4)
    pin: string;
}

export class ChangePinDto {
    @ApiProperty({ example: '1234', description: 'Old 4-digit PIN' })
    @IsString()
    @IsNotEmpty()
    @Length(4, 4)
    oldPin: string;

    @ApiProperty({ example: '5678', description: 'New 4-digit PIN' })
    @IsString()
    @IsNotEmpty()
    @Length(4, 4)
    newPin: string;
}

export class VerifyPinDto {
    @ApiProperty({ example: '1234', description: '4-digit PIN to verify' })
    @IsString()
    @IsNotEmpty()
    @Length(4, 4)
    pin: string;
}
