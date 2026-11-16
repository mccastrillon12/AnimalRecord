import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Response } from 'express';
import { PassThrough } from 'node:stream';
import { PublishedOwnershipHistoryDownloader } from '../../context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedOwnershipHistoryReader } from '../../context/animal-transfer/application/published-ownership-history-reader';
import { ITEM_MANIFEST_PAGE_SIZE } from '../../context/animal-transfer/domain/transfer-item-manifest-digest';
import { InvalidArgumentError } from '../../context/shared/domain/errors/InvalidArgumentError';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../shared/authenticated-request';

const hash = /^[a-f0-9]{64}$/;
const privateCache = 'private, no-store';

class HistoryPageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITEM_MANIFEST_PAGE_SIZE)
  limit = 20;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

class HistoryDetailQuery extends HistoryPageQuery {
  @IsOptional()
  @Matches(hash)
  publicationHash?: string;
}

class HistoryPeriodParams {
  @IsUUID()
  periodId: string;
}

class HistoryFileParams extends HistoryPeriodParams {
  @Matches(hash)
  entryId: string;

  @Matches(hash)
  fileId: string;
}

class HistoryFileQuery {
  @Matches(hash)
  publicationHash: string;
}

const encodeCursor = (parts: string[]) =>
  Buffer.from(parts.join(':')).toString('base64url');

function readCursor(
  token: string | undefined,
  scope: string[],
  payloadLength: number,
) {
  if (token === undefined) return;
  const parts = Buffer.from(token, 'base64url').toString('utf8').split(':');
  if (
    token !== encodeCursor(parts) ||
    parts.length !== scope.length + payloadLength ||
    scope.some((value, index) => parts[index] !== value)
  )
    throw new InvalidArgumentError('Invalid ownership history cursor');
  return parts.slice(scope.length);
}

/** Opt-in HTTP composition. The public transfer module does not register it. */
@Controller('animal-ownership-history')
@UseGuards(JwtAuthGuard)
export class OwnershipHistoryController {
  constructor(
    private readonly history: PublishedOwnershipHistoryReader,
    private readonly downloader: PublishedOwnershipHistoryDownloader,
  ) {}

  @Get()
  @Header('Cache-Control', privateCache)
  async list(
    @Request() req: AuthenticatedRequest,
    @Query() query: HistoryPageQuery,
  ) {
    const actorId = req.user.id;
    const scope = ['periods', actorId];
    const after = readCursor(query.cursor, scope, 1);
    const page = await this.history.list({
      actorId,
      limit: query.limit,
      ...(after && { after: { actorId, afterPeriodId: after[0] } }),
    });
    return {
      ...page,
      nextCursor:
        page.nextCursor &&
        encodeCursor([...scope, page.nextCursor.afterPeriodId]),
    };
  }

  @Get(':periodId')
  @Header('Cache-Control', privateCache)
  async detail(
    @Request() req: AuthenticatedRequest,
    @Param() params: HistoryPeriodParams,
    @Query() query: HistoryDetailQuery,
  ) {
    const actorId = req.user.id;
    const scope = ['entries', actorId, params.periodId];
    const after = readCursor(query.cursor, scope, 2);
    const page = await this.history.read({
      actorId,
      periodId: params.periodId,
      limit: query.limit,
      ...(query.publicationHash !== undefined && {
        publicationHash: query.publicationHash,
      }),
      ...(after && {
        after: { publicationHash: after[0], afterEntryId: after[1] },
      }),
    });
    return {
      ...page,
      nextCursor:
        page.nextCursor &&
        encodeCursor([
          ...scope,
          page.nextCursor.publicationHash,
          page.nextCursor.afterEntryId,
        ]),
    };
  }

  @Get(':periodId/entries/:entryId/files/:fileId')
  @Header('Cache-Control', privateCache)
  async download(
    @Request() req: AuthenticatedRequest,
    @Param() params: HistoryFileParams,
    @Query() query: HistoryFileQuery,
    @Res() response: Response,
  ) {
    const disconnected = new AbortController();
    const abort = () => disconnected.abort();
    response.once('close', abort);
    try {
      await this.downloader.download(
        {
          actorId: req.user.id,
          periodId: params.periodId,
          entryId: params.entryId,
          fileId: params.fileId,
          publicationHash: query.publicationHash,
        },
        (metadata) => {
          response.set({
            'Content-Length': String(metadata.contentLength),
            'Content-Type': metadata.contentType,
            'Content-Disposition': metadata.contentDisposition,
            'Cache-Control': metadata.cacheControl,
          });
          // Keep the HTTP response open for JSON errors before the first byte.
          const stream = new PassThrough();
          stream.pipe(response);
          return stream;
        },
        disconnected.signal,
      );
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.removeHeader('Content-Length');
      response.removeHeader('Content-Type');
      response.removeHeader('Content-Disposition');
      throw error;
    } finally {
      response.off('close', abort);
    }
  }
}
