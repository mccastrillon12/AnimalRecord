import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { UserAuthMethodEnum } from '../../context/user/domain/userAuthMethod';

export class SocialLoginDto {
    @ApiProperty({
        description: 'Social Provider',
        enum: UserAuthMethodEnum,
        example: 'GOOGLE'
    })
    @IsEnum(UserAuthMethodEnum)
    @IsNotEmpty()
    provider: string;

    @ApiProperty({
        description: 'Identity Token from Provider',
        example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjF.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJ...'
    })
    @IsString()
    @IsNotEmpty()
    token: string;
}
