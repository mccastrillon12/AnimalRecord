import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';
import { Response } from 'express';
import {
  TransferOtp,
  TransferOtpThrottled,
} from '../../context/animal-transfer/application/transfer-otp';
import { InvalidArgumentError } from '../../context/shared/domain/errors/InvalidArgumentError';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../shared/authenticated-request';
import { HttpErrorDto } from '../shared/dto/http-error.dto';

export class TransferOtpIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id: string;
}
export class VerifyTransferOtpDto {
  @ApiProperty({ pattern: '^\\d{6}$', example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
export class TransferOtpChallengeDto {
  @ApiProperty({ format: 'uuid' }) challengeId: string;
  @ApiProperty({ enum: ['EMAIL', 'PHONE'] }) channel: 'EMAIL' | 'PHONE';
  @ApiProperty() maskedDestination: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty({ format: 'date-time' }) resendAvailableAt: string;
}
export class TransferOtpAuthorizationDto {
  @ApiProperty({ format: 'uuid' }) challengeId: string;
  @ApiProperty({ enum: ['ANIMAL_TRANSFER'] }) purpose: 'ANIMAL_TRANSFER';
  @ApiProperty({
    description: 'Opaque, single-use transfer authorization; not a login token',
  })
  proof: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}
@ApiTags('animal-transfers')
@Controller('animal-transfers/otp-challenges')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
@ApiResponse({ status: 400, type: HttpErrorDto })
@ApiResponse({ status: 401, type: HttpErrorDto })
@ApiResponse({ status: 409, type: HttpErrorDto })
@ApiResponse({
  status: 429,
  type: HttpErrorDto,
  description: 'Wait for Retry-After; no automatic resend',
})
@ApiResponse({ status: 502, type: HttpErrorDto })
export class TransferOtpController {
  constructor(private readonly otp: TransferOtp) {}
  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Send a transfer verification code to the registered OTP channel',
  })
  @ApiResponse({ status: 201, type: TransferOtpChallengeDto })
  issue(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.empty(body);
    return this.execute(res, () => this.otp.issue(req.user.id));
  }
  @Post(':id/resend')
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @ApiResponse({ status: 200, type: TransferOtpChallengeDto })
  resend(
    @Request() req: AuthenticatedRequest,
    @Param() param: TransferOtpIdDto,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.empty(body);
    return this.execute(res, () => this.otp.issue(req.user.id, param.id));
  }
  @Post(':id/verify')
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  @ApiResponse({ status: 200, type: TransferOtpAuthorizationDto })
  verify(
    @Request() req: AuthenticatedRequest,
    @Param() param: TransferOtpIdDto,
    @Body() body: VerifyTransferOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.execute(res, () =>
      this.otp.verify(req.user.id, param.id, body.code),
    );
  }
  private empty(body: unknown) {
    if (
      body !== undefined &&
      (!body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length)
    )
      throw new InvalidArgumentError(
        'Transfer verification does not accept an alternate user or destination',
      );
  }
  private async execute<T>(
    res: Response,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof TransferOtpThrottled)
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      throw error;
    }
  }
}
