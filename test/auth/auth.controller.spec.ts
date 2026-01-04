import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../../src/app/auth/auth.controller';
import { LoginUseCase } from '../../src/context/auth/application/login.usecase';
import { RefreshTokenUseCase } from '../../src/context/auth/application/refresh-token.usecase';
import { LoginDto } from '../../src/app/auth/login.dto';
import { RefreshTokenDto } from '../../src/app/auth/refresh-token.dto';

describe('AuthController', () => {
    let controller: AuthController;
    let loginUseCase: any;
    let refreshTokenUseCase: any;

    const mockLoginUseCase = {
        run: jest.fn(),
    };

    const mockRefreshTokenUseCase = {
        run: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                { provide: LoginUseCase, useValue: mockLoginUseCase },
                { provide: RefreshTokenUseCase, useValue: mockRefreshTokenUseCase },
            ],
        }).compile();

        controller = module.get<AuthController>(AuthController);
        loginUseCase = module.get<LoginUseCase>(LoginUseCase);
        refreshTokenUseCase = module.get<RefreshTokenUseCase>(RefreshTokenUseCase);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('login', () => {
        it('should return tokens on success', async () => {
            const dto: LoginDto = { identifier: 'test@test.com', password: 'pass' };
            const expectedResult = { accessToken: 'access', refreshToken: 'refresh' };

            mockLoginUseCase.run.mockResolvedValue(expectedResult);

            const result = await controller.login(dto);

            expect(result).toEqual(expectedResult);
            expect(mockLoginUseCase.run).toHaveBeenCalledWith(dto.identifier, dto.password);
        });
    });

    describe('refresh', () => {
        it('should return new tokens', async () => {
            const dto: RefreshTokenDto = { refreshToken: 'oldRefresh' };
            const expectedResult = { accessToken: 'newAccess', refreshToken: 'newRefresh' };

            mockRefreshTokenUseCase.run.mockResolvedValue(expectedResult);

            const result = await controller.refresh(dto);

            expect(result).toEqual(expectedResult);
            expect(mockRefreshTokenUseCase.run).toHaveBeenCalledWith(dto.refreshToken);
        });
    });
});
