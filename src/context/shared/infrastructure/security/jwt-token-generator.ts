import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ITokenGenerator } from '../../domain/ITokenGenerator';

@Injectable()
export class JwtTokenGenerator implements ITokenGenerator {
    constructor(private readonly jwtService: JwtService) { }

    generate(payload: any): string {
        return this.jwtService.sign(payload);
    }
}
