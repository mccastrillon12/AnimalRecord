import {
  Controller,
  Get,
  Header,
  Query,
  Request,
  UseGuards,
  Body,
  Headers,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SearchTransferRecipients } from '../../context/user/application/search-transfer-recipients';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../shared/authenticated-request';
import { HttpErrorDto } from '../shared/dto/http-error.dto';
import {
  SearchTransferRecipientsDto,
  TransferRecipientPageResponseDto,
} from './search-transfer-recipients.dto';
import { TransferRequests } from '../../context/animal-transfer/application/transfer-requests';
import {
  CreateTransferRequestDto,
  TransferRequestDetailResponseDto,
  TransferRequestIdDto,
  TransferRequestListDto,
  TransferRequestListResponseDto,
  TransferRequestPageDto,
  TransferRequestResponseDto,
} from './transfer-request.dto';
import { ApiHeader } from '@nestjs/swagger';

@ApiTags('animal-transfers')
@Controller('animal-transfers')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class AnimalTransferController {
  constructor(
    private readonly recipients: SearchTransferRecipients,
    private readonly transfers: TransferRequests,
  ) {}

  @Get('recipients')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Search transfer recipients by name, excluding the sender',
  })
  @ApiResponse({ status: 200, type: TransferRecipientPageResponseDto })
  @ApiResponse({ status: 400, type: HttpErrorDto })
  @ApiResponse({ status: 401, type: HttpErrorDto })
  searchRecipients(
    @Request() req: AuthenticatedRequest,
    @Query() query: SearchTransferRecipientsDto,
  ): Promise<TransferRecipientPageResponseDto> {
    return this.recipients.run(
      req.user.id,
      query.q,
      query.searchBy,
      query.limit,
      query.cursor,
    );
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({ status: 201, type: TransferRequestResponseDto })
  @ApiResponse({
    status: 200,
    type: TransferRequestResponseDto,
    description: 'Replay of an existing request',
  })
  @ApiResponse({ status: 400, type: HttpErrorDto })
  @ApiResponse({ status: 403, type: HttpErrorDto })
  @ApiResponse({ status: 409, type: HttpErrorDto })
  @ApiResponse({ status: 503, type: HttpErrorDto })
  async create(
    @Request() req: AuthenticatedRequest,
    @Headers('Idempotency-Key') key: string,
    @Body() body: CreateTransferRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TransferRequestResponseDto> {
    const result = await this.transfers.create(req.user.id, key, body);
    response.status(result.replayed ? 200 : 201);
    return result.request;
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: TransferRequestListResponseDto })
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: TransferRequestListDto,
  ): Promise<TransferRequestListResponseDto> {
    return this.transfers.list(
      req.user.id,
      query.direction,
      query.limit,
      query.cursor,
    );
  }
  // Keep literal /recipients above /:id so the existing search route remains reachable.
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: TransferRequestDetailResponseDto })
  detail(
    @Request() req: AuthenticatedRequest,
    @Param() param: TransferRequestIdDto,
    @Query() query: TransferRequestPageDto,
  ): Promise<TransferRequestDetailResponseDto> {
    return this.transfers.detail(
      req.user.id,
      param.id,
      query.limit,
      query.cursor,
    );
  }
}
