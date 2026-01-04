import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ITokenGenerator } from '../../domain/ITokenGenerator';
import { EnvironmentConfigService } from '../config/environment/environment.service';

@Injectable()
export class JwtTokenGenerator implements ITokenGenerator {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: EnvironmentConfigService
    ) { }

    generate(payload: any): string {
        return this.jwtService.sign(payload);
    }

    generateRefresh(payload: any): string {
        return this.jwtService.sign(payload, {
            secret: this.configService.getJwtRefreshSecret(),
            expiresIn: this.configService.getJwtRefreshExpirationTime() as any,
        });
    }
}
