import {
  ExecutionContext,
  INestApplication,
  type ModuleMetadata,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import * as request from 'supertest';
import { AnimalTransferController } from '../../../src/app/animal-transfer/animal-transfer.controller';
import { OwnershipHistoryController } from '../../../src/app/animal-transfer/ownership-history.controller';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../src/app/shared/authenticated-request';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';
import { TransferOtp } from '../../../src/context/animal-transfer/application/transfer-otp';
import { PublishedOwnershipHistoryDownloader } from '../../../src/context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
import {
  TRANSFER_ACCEPTANCE_DECISION,
  TransferRequests,
} from '../../../src/context/animal-transfer/application/transfer-requests';
import { MongoTransferRequests } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-requests';
import { AnimalTransferReasonCode } from '../../../src/context/catalogs/domain/animal-transfer-reason';
import { SearchTransferRecipients } from '../../../src/context/user/application/search-transfer-recipients';
import type { acceptanceStartStore } from './acceptance-start-store.fixture';
import { acceptanceAt } from './transfer-acceptance-preparation.fixture';

async function startLocalHttp(
  fixture: Pick<
    ReturnType<typeof acceptanceStartStore>,
    'actorId' | 'recipientId'
  >,
  metadata: Pick<ModuleMetadata, 'controllers' | 'providers'>,
) {
  const module = await Test.createTestingModule(metadata)
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate(context: ExecutionContext) {
        const req = context
          .switchToHttp()
          .getRequest<
            AuthenticatedRequest & { headers: Record<string, string> }
          >();
        const actors: Record<string, string> = {
          'Bearer sender': fixture.actorId,
          'Bearer recipient': fixture.recipientId,
        };
        const id = actors[req.headers.authorization];
        if (!id) throw new UnauthorizedException();
        req.user = { id };
        return true;
      },
    })
    .compile();
  const app = module.createNestApplication<INestApplication<Server>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  try {
    await app.listen(0, '127.0.0.1');
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

export type AcceptanceHttpHistory = Readonly<{
  reader: PublishedOwnershipHistoryReader;
  downloader: PublishedOwnershipHistoryDownloader;
}>;

/** The production module never imports this HTTP composition. */
export async function startAcceptanceHttp(
  fixture: ReturnType<typeof acceptanceStartStore>,
  history?: AcceptanceHttpHistory,
) {
  const { models, connection, state } = fixture;
  Object.assign(state.db.requests[0], {
    senderName: 'Remitente de prueba',
    recipientName: 'Destinatario de prueba',
    reasonCode: AnimalTransferReasonCode.Other,
    reasonName: 'Otro',
    createdAt: acceptanceAt,
  });
  for (const [index, item] of state.db.items.entries())
    Object.assign(item, {
      animalName: `Animal ${index + 1}`,
      animalCode: `AR-${index + 1}`,
    });

  const store = new MongoTransferRequests(
    ...([
      models[0],
      models[1],
      models[2],
      models[16],
      models[17],
      models[10],
      models[11],
      { db: connection },
      models[3],
      models[4],
    ] as unknown as ConstructorParameters<typeof MongoTransferRequests>),
  );
  const app = await startLocalHttp(fixture, {
    controllers: [
      AnimalTransferController,
      ...(history ? [OwnershipHistoryController] : []),
    ],
    providers: [
      TransferRequests,
      { provide: 'TransferRequestStore', useValue: store },
      { provide: TRANSFER_ACCEPTANCE_DECISION, useValue: fixture.service },
      { provide: TransferOtp, useValue: {} },
      { provide: SearchTransferRecipients, useValue: {} },
      ...(history
        ? [
            {
              provide: PublishedOwnershipHistoryReader,
              useValue: history.reader,
            },
            {
              provide: PublishedOwnershipHistoryDownloader,
              useValue: history.downloader,
            },
          ]
        : []),
    ],
  });
  const path = `/animal-transfers/${fixture.input.transferId}`;
  return {
    close: () => app.close(),
    detail: () =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer recipient'),
    decide: (actor?: 'sender' | 'recipient', key?: string) => {
      const call = request(app.getHttpServer()).post(`${path}/decisions`);
      if (actor) call.set('Authorization', `Bearer ${actor}`);
      if (key) call.set('Idempotency-Key', key);
      return call;
    },
    history: (path: string, actor?: 'sender' | 'recipient') => {
      const call = request(app.getHttpServer()).get(
        `/animal-ownership-history${path}`,
      );
      if (actor) call.set('Authorization', `Bearer ${actor}`);
      return call;
    },
  };
}
