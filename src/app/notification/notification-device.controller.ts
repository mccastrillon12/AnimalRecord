import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { NotificationDevices } from '../../context/notification/application/notification-devices';
import { InvalidArgumentError } from '../../context/shared/domain/errors/InvalidArgumentError';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../shared/authenticated-request';
import { HttpErrorDto } from '../shared/dto/http-error.dto';

export class DeviceInstallationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() installationId: string;
}
export class RegisterNotificationDeviceDto {
  @ApiProperty({ enum: ['FCM'] }) @IsIn(['FCM']) provider: 'FCM';
  @ApiProperty({ enum: ['ANDROID', 'IOS'] })
  @IsIn(['ANDROID', 'IOS'])
  platform: 'ANDROID' | 'IOS';
  @ApiProperty({
    description: 'Opaque provider token; never returned or logged',
    maxLength: 4096,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  token: string;
}
export class NotificationDeviceResponseDto {
  @ApiProperty({ format: 'uuid' }) installationId: string;
  @ApiProperty({ minimum: 1 }) revision: number;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) state: 'ACTIVE' | 'DISABLED';
  @ApiProperty() registeredToCurrentUser: boolean;
  @ApiProperty({ enum: ['FCM'] }) provider: 'FCM';
  @ApiProperty({ enum: ['ANDROID', 'IOS'] }) platform: 'ANDROID' | 'IOS';
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}
@Controller('notification-devices')
@ApiTags('notification-devices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
@ApiHeader({
  name: 'X-Installation-Key',
  required: true,
  description:
    'Installation credential: 32 random bytes in canonical base64url, stored privately on the device',
})
@ApiResponse({ status: 200, type: NotificationDeviceResponseDto })
@ApiResponse({ status: 400, type: HttpErrorDto })
@ApiResponse({ status: 401, type: HttpErrorDto })
@ApiResponse({ status: 404, type: HttpErrorDto })
@ApiResponse({ status: 409, type: HttpErrorDto })
@ApiResponse({ status: 503, type: HttpErrorDto })
export class NotificationDeviceController {
  constructor(private readonly devices: NotificationDevices) {}
  @Get(':installationId')
  @Header('Cache-Control', 'private, no-store')
  get(
    @Request() req: AuthenticatedRequest,
    @Param() param: DeviceInstallationDto,
    @Headers('X-Installation-Key') key: string,
  ) {
    return this.devices.get(req.user.id, param.installationId, key);
  }
  @Put(':installationId')
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description:
      'Quoted revision, e.g. "0" for first registration or "3" for replacement',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  put(
    @Request() req: AuthenticatedRequest,
    @Param() param: DeviceInstallationDto,
    @Headers('X-Installation-Key') key: string,
    @Headers('Idempotency-Key') operationId: string,
    @Headers('If-Match') ifMatch: string,
    @Body() body: RegisterNotificationDeviceDto,
  ) {
    return this.devices.register(
      req.user.id,
      param.installationId,
      key,
      operationId,
      ifMatch,
      body,
    );
  }
  @Delete(':installationId')
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Quoted current revision',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  remove(
    @Request() req: AuthenticatedRequest,
    @Param() param: DeviceInstallationDto,
    @Headers('X-Installation-Key') key: string,
    @Headers('Idempotency-Key') operationId: string,
    @Headers('If-Match') ifMatch: string,
    @Body() body: unknown,
  ) {
    if (
      body !== undefined &&
      (!body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length)
    )
      throw new InvalidArgumentError(
        'Device removal accepts no alternate account or push token',
      );
    return this.devices.unregister(
      req.user.id,
      param.installationId,
      key,
      operationId,
      ifMatch,
    );
  }
}
