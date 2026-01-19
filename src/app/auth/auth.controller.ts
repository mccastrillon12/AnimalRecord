import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LoginUseCase } from '../../context/auth/application/login.usecase';
import { RefreshTokenUseCase } from '../../context/auth/application/refresh-token.usecase';
import { VerifyUserEmail } from '../../context/user/application/verify/verify-user-email';
import { LoginDto } from './login.dto';
import { RefreshTokenDto } from './refresh-token.dto';
import { VerifyDto } from './verify.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly loginUseCase: LoginUseCase,
        private readonly refreshTokenUseCase: RefreshTokenUseCase,
        private readonly verifyUserEmail: VerifyUserEmail
    ) { }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'User login' })
    @ApiResponse({ status: 200, description: 'Login successful, returns access and refresh tokens.' })
    @ApiResponse({ status: 401, description: 'Invalid credentials.' })
    async login(@Body() loginDto: LoginDto) {
        return this.loginUseCase.run(loginDto.identifier, loginDto.password);
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Refresh access token' })
    @ApiResponse({ status: 200, description: 'Tokens refreshed successfully.' })
    @ApiResponse({ status: 403, description: 'Access Denied.' })
    async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
        return this.refreshTokenUseCase.run(refreshTokenDto.refreshToken);
    }

    @Post('verify')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify user email' })
    @ApiResponse({ status: 200, description: 'Verification successful, returns tokens.' })
    @ApiResponse({ status: 400, description: 'Invalid code or user already verified.' })
    async verify(@Body() verifyDto: VerifyDto) {
        return this.verifyUserEmail.run(verifyDto.email, verifyDto.code);
    }
}
