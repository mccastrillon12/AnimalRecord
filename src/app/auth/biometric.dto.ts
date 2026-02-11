import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleBiometricDto {
    @ApiProperty({ example: true, description: 'Enable or disable biometric authentication' })
    @IsBoolean()
    enable: boolean;
}
