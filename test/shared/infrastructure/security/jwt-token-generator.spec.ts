import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { JwtTokenGenerator } from '../../../../src/context/shared/infrastructure/security/jwt-token-generator';
import { EnvironmentConfigService } from '../../../../src/context/shared/infrastructure/config/environment/environment.service';

describe('JwtTokenGenerator', () => {
    let generator: JwtTokenGenerator;
    let jwtService: any;
    let configService: any;

    const mockJwtService = {
        sign: jest.fn(),
    };

    const mockConfigService = {
        getJwtRefreshSecret: jest.fn().mockReturnValue('refreshSecret'),
        getJwtRefreshExpirationTime: jest.fn().mockReturnValue('7d'),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                JwtTokenGenerator,
                { provide: JwtService, useValue: mockJwtService },
                { provide: EnvironmentConfigService, useValue: mockConfigService },
            ],
        }).compile();

        generator = module.get<JwtTokenGenerator>(JwtTokenGenerator);
        jwtService = module.get(JwtService);
        configService = module.get(EnvironmentConfigService);
    });

    it('should be defined', () => {
        expect(generator).toBeDefined();
    });

    describe('generate', () => {
        it('should generate an access token', () => {
            const payload = { sub: '123' };
            mockJwtService.sign.mockReturnValue('access_token');

            const result = generator.generate(payload);

            expect(result).toBe('access_token');
            expect(mockJwtService.sign).toHaveBeenCalledWith(payload);
        });
    });

    describe('generateRefresh', () => {
        it('should generate a refresh token', () => {
            const payload = { sub: '123' };
            mockJwtService.sign.mockReturnValue('refresh_token');

            const result = generator.generateRefresh(payload);

            expect(result).toBe('refresh_token');
            expect(mockJwtService.sign).toHaveBeenCalledWith(payload, {
                secret: 'refreshSecret',
                expiresIn: '7d',
            });
        });
    });
});
