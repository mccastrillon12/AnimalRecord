import {
  Controller,
  Get,
  Header,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
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

@ApiTags('animal-transfers')
@Controller('animal-transfers')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class AnimalTransferController {
  constructor(private readonly recipients: SearchTransferRecipients) {}

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
}
