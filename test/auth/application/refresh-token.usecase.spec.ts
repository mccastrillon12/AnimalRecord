import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException } from '@nestjs/common';
import { RefreshTokenUseCase } from '../../../src/context/auth/application/refresh-token.usecase';
import { UserRepository } from '../../../src/context/user/domain/userRepository';
import { IPasswordHasher } from '../../../src/context/shared/domain/IPasswordHasher';
import { ITokenGenerator } from '../../../src/context/shared/domain/ITokenGenerator';
import { EnvironmentConfigService } from '../../../src/context/shared/infrastructure/config/environment/environment.service';
import { UserId } from '../../../src/context/user/domain/userId';

// Mock factories
const mockUserRepository = () => ({
    findById: jest.fn(),
    update: jest.fn(),
});
const mockPasswordHasher = () => ({
    compare: jest.fn(),
    hash: jest.fn(),
});
const mockTokenGenerator = () => ({
    generate: jest.fn(),
    generateRefresh: jest.fn(),
});
const mockJwtService = () => ({
    verify: jest.fn(),
});
const mockConfigService = () => ({
    getJwtRefreshSecret: jest.fn().mockReturnValue('secret'),
});

describe('RefreshTokenUseCase', () => {
    let useCase: RefreshTokenUseCase;
    let userRepository: any;
    let passwordHasher: any;
    let tokenGenerator: any;
    let jwtService: any;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RefreshTokenUseCase,
                { provide: 'UserRepository', useFactory: mockUserRepository },
                { provide: 'IPasswordHasher', useFactory: mockPasswordHasher },
                { provide: 'ITokenGenerator', useFactory: mockTokenGenerator },
                { provide: JwtService, useFactory: mockJwtService },
                { provide: EnvironmentConfigService, useFactory: mockConfigService },
            ],
        }).compile();

        useCase = module.get<RefreshTokenUseCase>(RefreshTokenUseCase);
        userRepository = module.get('UserRepository');
        passwordHasher = module.get('IPasswordHasher');
        tokenGenerator = module.get('ITokenGenerator');
        jwtService = module.get(JwtService);
    });

    it('should throw ForbiddenException if token invalid', async () => {
        jwtService.verify.mockImplementation(() => { throw new Error(); });
        await expect(useCase.run('invalidToken')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if user not found', async () => {
        jwtService.verify.mockReturnValue({ sub: '123e4567-e89b-12d3-a456-426614174000' });
        userRepository.findById.mockResolvedValue(null);
        await expect(useCase.run('token')).rejects.toThrow(ForbiddenException);
    });

    it('should return new tokens on success', async () => {
        const mockUser = {
            id: { value: '123e4567-e89b-12d3-a456-426614174000' },
            email: { value: 'test@email.com' },
            refreshToken: 'hashedToken'
        };

        jwtService.verify.mockReturnValue({ sub: '123e4567-e89b-12d3-a456-426614174000' });
        userRepository.findById.mockResolvedValue(mockUser);
        passwordHasher.compare.mockResolvedValue(true);
        tokenGenerator.generate.mockReturnValue('newAccess');
        tokenGenerator.generateRefresh.mockReturnValue('newRefresh');
        passwordHasher.hash.mockResolvedValue('newHashedRefresh');

        const result = await useCase.run('validRefreshToken');

        expect(result).toEqual({ accessToken: 'newAccess', refreshToken: 'newRefresh' });
        expect(userRepository.update).toHaveBeenCalled();
    });
});
