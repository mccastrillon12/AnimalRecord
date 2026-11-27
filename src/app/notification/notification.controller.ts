import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Notifications } from '../../context/notification/application/notifications';
import {
  NOTIFICATION_TYPES,
  type NotificationRecord,
} from '../../context/notification/domain/notification';
import { InvalidArgumentError } from '../../context/shared/domain/errors/InvalidArgumentError';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../shared/authenticated-request';
import { HttpErrorDto } from '../shared/dto/http-error.dto';

export class NotificationPageDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
export class NotificationIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id: string;
}
export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) transferId: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES })
  type: NotificationRecord['type'];
  @ApiProperty({ type: [String] }) itemIds: string[];
  @ApiProperty() title: string;
  @ApiProperty() text: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiPropertyOptional({ format: 'date-time' }) readAt?: string;
}
export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items: NotificationResponseDto[];
  @ApiPropertyOptional() nextCursor?: string;
}
export class NotificationCountDto {
  @ApiProperty({ minimum: 0 }) count: number;
}

function isEmptyBody(body: unknown): boolean {
  return (
    body === undefined ||
    (body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0)
  );
}
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 400, type: HttpErrorDto })
@ApiResponse({ status: 401, type: HttpErrorDto })
@ApiResponse({ status: 503, type: HttpErrorDto })
export class NotificationController {
  constructor(private readonly notifications: Notifications) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: NotificationListResponseDto })
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: NotificationPageDto,
  ) {
    return this.notifications.list(req.user.id, query.limit, query.cursor);
  }
  @Get('unread-count')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: NotificationCountDto })
  count(@Request() req: AuthenticatedRequest) {
    return this.notifications.unreadCount(req.user.id);
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: NotificationResponseDto })
  @ApiResponse({ status: 404, type: HttpErrorDto })
  get(@Request() req: AuthenticatedRequest, @Param() param: NotificationIdDto) {
    return this.notifications.get(req.user.id, param.id);
  }
  @Patch('read-all')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 204,
    description: 'All eligible notifications marked read',
  })
  markAllRead(
    @Request() req: AuthenticatedRequest,
    @Headers('Idempotency-Key') operationId: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!isEmptyBody(body))
      throw new InvalidArgumentError(
        'Marking all notifications read accepts an empty body',
      );
    return this.notifications.markAllRead(req.user.id, operationId);
  }
  @Patch(':id/read')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: NotificationResponseDto })
  @ApiResponse({ status: 404, type: HttpErrorDto })
  markRead(
    @Request() req: AuthenticatedRequest,
    @Param() param: NotificationIdDto,
    @Body() body: unknown,
  ) {
    if (!isEmptyBody(body))
      throw new InvalidArgumentError(
        'Marking a notification read accepts no alternate user, timestamp or transfer decision',
      );
    return this.notifications.markRead(req.user.id, param.id);
  }
}
