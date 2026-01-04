import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { LoginUseCase } from '../../../src/context/auth/application/login.usecase';


// Mock factories
const mockUserRepository = () => ({
    findByEmail: jest.fn(),
    findByCellPhone: jest.fn(),
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

describe('LoginUseCase', () => {
    let useCase: LoginUseCase;
    let userRepository: any;
    let passwordHasher: any;
    let tokenGenerator: any;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                LoginUseCase,
                { provide: 'UserRepository', useFactory: mockUserRepository },
                { provide: 'IPasswordHasher', useFactory: mockPasswordHasher },
                { provide: 'ITokenGenerator', useFactory: mockTokenGenerator },
            ],
        }).compile();

        useCase = module.get<LoginUseCase>(LoginUseCase);
        userRepository = module.get('UserRepository');
        passwordHasher = module.get('IPasswordHasher');
        tokenGenerator = module.get('ITokenGenerator');
    });

    it('should throw UnauthorizedException if user not found', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        userRepository.findByCellPhone.mockResolvedValue(null);

        await expect(useCase.run('test@test.com', 'password')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password does not match', async () => {
        const mockUser = { password: 'hashedPassword' } as any;
        userRepository.findByEmail.mockResolvedValue(mockUser);
        passwordHasher.compare.mockResolvedValue(false);

        await expect(useCase.run('test@test.com', 'wrongPassword')).rejects.toThrow(UnauthorizedException);
    });

    it('should return tokens if login is successful', async () => {
        const mockUser = {
            id: { value: '123' },
            email: { value: 'test@test.com' },
            password: 'hashedPassword',
            toPrimitives: jest.fn().mockReturnValue({ id: '123' })
        } as any;

        userRepository.findByEmail.mockResolvedValue(mockUser);
        passwordHasher.compare.mockResolvedValue(true);
        tokenGenerator.generate.mockReturnValue('accessToken');
        tokenGenerator.generateRefresh.mockReturnValue('refreshToken');
        passwordHasher.hash.mockResolvedValue('hashedRefreshToken');

        const result = await useCase.run('test@test.com', 'password');

        expect(result).toEqual({ accessToken: 'accessToken', refreshToken: 'refreshToken' });
        expect(userRepository.update).toHaveBeenCalled();
        expect(mockUser.refreshToken).toBe('hashedRefreshToken');
    });
});
