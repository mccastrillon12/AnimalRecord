import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
  @ApiProperty({ enum: ['TRANSFER_REQUEST_SENT', 'TRANSFER_REQUEST_RECEIVED'] })
  type: 'TRANSFER_REQUEST_SENT' | 'TRANSFER_REQUEST_RECEIVED';
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
  @Patch(':id/read')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: NotificationResponseDto })
  @ApiResponse({ status: 404, type: HttpErrorDto })
  markRead(
    @Request() req: AuthenticatedRequest,
    @Param() param: NotificationIdDto,
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
        'Marking a notification read accepts no alternate user, timestamp or transfer decision',
      );
    return this.notifications.markRead(req.user.id, param.id);
  }
}
