import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LoginUseCase } from '../../context/auth/application/login.usecase';
import { RefreshTokenUseCase } from '../../context/auth/application/refresh-token.usecase';
import { VerifyUserEmail } from '../../context/user/application/verify/verify-user-email';
import { LoginDto } from './login.dto';
import { RefreshTokenDto } from './refresh-token.dto';
import { VerifyDto } from './verify.dto';
import { ResendCodeDto } from './resend-code.dto';
import { SocialLoginDto } from './social-login.dto';
import { SocialRegisterDto } from './social-register.dto';
import { ResendVerificationCodeUseCase } from '../../context/auth/application/resend-verification-code.usecase';
import { SocialCheckUseCase } from '../../context/auth/application/social-check.usecase';
import { SocialRegisterUseCase } from '../../context/auth/application/social-register.usecase';
import { HttpErrorDto } from '../shared/dto/http-error.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly loginUseCase: LoginUseCase,
        private readonly refreshTokenUseCase: RefreshTokenUseCase,
        private readonly verifyUserEmail: VerifyUserEmail,
        private readonly resendVerificationCodeUseCase: ResendVerificationCodeUseCase,
        private readonly socialCheckUseCase: SocialCheckUseCase,
        private readonly socialRegisterUseCase: SocialRegisterUseCase
    ) { }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'User login' })
    @ApiResponse({ status: 200, description: 'Login successful, returns access and refresh tokens.' })
    @ApiResponse({ status: 401, description: 'Invalid credentials.', type: HttpErrorDto })
    @ApiResponse({ status: 403, description: 'User not verified. Verification code sent.', type: HttpErrorDto })
    async login(@Body() loginDto: LoginDto) {
        return this.loginUseCase.run(loginDto.identifier, loginDto.password);
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Refresh access token' })
    @ApiResponse({ status: 200, description: 'Tokens refreshed successfully.' })
    @ApiResponse({ status: 403, description: 'Access Denied / Invalid Refresh Token.', type: HttpErrorDto })
    async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
        return this.refreshTokenUseCase.run(refreshTokenDto.refreshToken);
    }

    @Post('verify')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify user email' })
    @ApiResponse({ status: 200, description: 'Verification successful, returns tokens.' })
    @ApiResponse({ status: 400, description: 'Invalid code, expired code, or user already verified.', type: HttpErrorDto })
    @ApiResponse({ status: 404, description: 'User not found.', type: HttpErrorDto })
    async verify(@Body() verifyDto: VerifyDto) {
        return this.verifyUserEmail.run(verifyDto.email, verifyDto.code);
    }

    @Post('resend-code')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Resend verification code' })
    @ApiResponse({ status: 200, description: 'Verification code resent successfully.' })
    @ApiResponse({ status: 400, description: 'User already verified or not found.', type: HttpErrorDto })
    async resendCode(@Body() resendCodeDto: ResendCodeDto) {
        return this.resendVerificationCodeUseCase.run(resendCodeDto.identifier);
    }

    @Post('social/check')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Check Social Token. Returns Login or Need Register' })
    @ApiResponse({ status: 200, description: 'Check successful.', type: Object })
    @ApiResponse({ status: 401, description: 'Invalid token.', type: HttpErrorDto })
    async socialCheck(@Body() socialLoginDto: SocialLoginDto) {
        return this.socialCheckUseCase.run(socialLoginDto.provider, socialLoginDto.token);
    }

    @Post('social/register')
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Complete Registration with Pre-Auth Token' })
    @ApiResponse({ status: 201, description: 'Registration successful.', type: LoginDto })
    @ApiResponse({ status: 401, description: 'Invalid token.', type: HttpErrorDto })
    async socialRegister(@Body() socialRegisterDto: SocialRegisterDto) {
        return this.socialRegisterUseCase.run(socialRegisterDto);
    }
}
