import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Request, Put, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
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
import { RequestPasswordResetUseCase } from '../../context/auth/application/request-password-reset.usecase';
import { ResetPasswordUseCase } from '../../context/auth/application/reset-password.usecase';
import { ChangePasswordUseCase } from '../../context/auth/application/change-password.usecase';
import { CreateUserPinUseCase } from '../../context/auth/application/create-user-pin.usecase';
import { ChangeUserPinUseCase } from '../../context/auth/application/change-user-pin.usecase';
import { VerifyUserPinUseCase } from '../../context/auth/application/verify-user-pin.usecase';
import { CheckUserPinStatusUseCase } from '../../context/auth/application/check-user-pin-status.usecase';
import { RequestPasswordResetDto } from './request-password-reset.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { ChangePasswordDto } from './change-password.dto';
import { CreatePinDto, ChangePinDto, VerifyPinDto } from './pin.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly loginUseCase: LoginUseCase,
        private readonly refreshTokenUseCase: RefreshTokenUseCase,
        private readonly verifyUserEmail: VerifyUserEmail,
        private readonly resendVerificationCodeUseCase: ResendVerificationCodeUseCase,
        private readonly socialCheckUseCase: SocialCheckUseCase,
        private readonly socialRegisterUseCase: SocialRegisterUseCase,
        private readonly requestPasswordResetUseCase: RequestPasswordResetUseCase,
        private readonly resetPasswordUseCase: ResetPasswordUseCase,
        private readonly changePasswordUseCase: ChangePasswordUseCase,
        private readonly createUserPinUseCase: CreateUserPinUseCase,
        private readonly changeUserPinUseCase: ChangeUserPinUseCase,
        private readonly verifyUserPinUseCase: VerifyUserPinUseCase,
        private readonly checkUserPinStatusUseCase: CheckUserPinStatusUseCase
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

    @Post('forgot-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Request password reset' })
    @ApiResponse({ status: 200, description: 'If user exists, reset code sent.' })
    async forgotPassword(@Body() dto: RequestPasswordResetDto) {
        return this.requestPasswordResetUseCase.run(dto.identifier);
    }

    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reset password' })
    @ApiResponse({ status: 200, description: 'Password reset successful.' })
    @ApiResponse({ status: 400, description: 'Invalid or expired code.', type: HttpErrorDto })
    async resetPassword(@Body() dto: ResetPasswordDto) {
        return this.resetPasswordUseCase.run(dto.identifier, dto.code, dto.newPassword);
    }

    @Post('change-password')
    @ApiBearerAuth('access-token')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Change password (Authenticated)' })
    @ApiResponse({ status: 200, description: 'Password changed successfully.' })
    @ApiResponse({ status: 400, description: 'Invalid old password.', type: HttpErrorDto })
    async changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
        return this.changePasswordUseCase.run(req.user.id, dto.oldPassword, dto.newPassword);
    }

    @Post('pin')
    @ApiBearerAuth('access-token')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Create user PIN' })
    @ApiResponse({ status: 200, description: 'PIN created successfully.' })
    @ApiResponse({ status: 400, description: 'User already has a PIN.', type: HttpErrorDto })
    async createPin(@Request() req: any, @Body() dto: CreatePinDto) {
        return this.createUserPinUseCase.run(req.user.id, dto.pin);
    }

    @Put('pin')
    @ApiBearerAuth('access-token')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Change user PIN' })
    @ApiResponse({ status: 200, description: 'PIN changed successfully.' })
    @ApiResponse({ status: 400, description: 'Invalid old PIN or user has no PIN.', type: HttpErrorDto })
    async changePin(@Request() req: any, @Body() dto: ChangePinDto) {
        return this.changeUserPinUseCase.run(req.user.id, dto.oldPin, dto.newPin);
    }

    @Post('pin/verify')
    @ApiBearerAuth('access-token')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify user PIN' })
    @ApiResponse({ status: 200, description: 'PIN verified successfully (returns true).' })
    @ApiResponse({ status: 400, description: 'Invalid PIN or user has no PIN.', type: HttpErrorDto })
    async verifyPin(@Request() req: any, @Body() dto: VerifyPinDto) {
        return this.verifyUserPinUseCase.run(req.user.id, dto.pin);
    }

    @Get('pin/status')
    @ApiBearerAuth('access-token')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Check if user has a PIN set' })
    @ApiResponse({ status: 200, description: 'Returns { hasPin: boolean }.' })
    async checkPinStatus(@Request() req: any) {
        return this.checkUserPinStatusUseCase.run(req.user.id);
    }
}
