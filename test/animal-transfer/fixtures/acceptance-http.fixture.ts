import {
  ExecutionContext,
  Global,
  INestApplication,
  Module,
  type ModuleMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import type { Server } from 'node:http';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { configureAnimalRecordHttp } from '../../../src/main';
import { AnimalTransferController } from '../../../src/app/animal-transfer/animal-transfer.controller';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { NotificationModule } from '../../../src/app/notification/notification.module';
import { UserModule } from '../../../src/app/user/user.module';
import { TransferOtpModule } from '../../../src/app/animal-transfer/transfer-otp.module';
import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import type { AuthenticatedRequest } from '../../../src/app/shared/authenticated-request';
import { TransferOtp } from '../../../src/context/animal-transfer/application/transfer-otp';
import { TransferAcceptanceStart } from '../../../src/context/animal-transfer/application/transfer-acceptance-start';
import {
  TRANSFER_ACCEPTANCE_PROGRESS,
  TransferAcceptanceProgress,
} from '../../../src/context/animal-transfer/application/transfer-acceptance-execution';
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
  metadata: ModuleMetadata,
  configure?: (builder: TestingModuleBuilder) => void,
) {
  const builder = Test.createTestingModule(metadata)
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
    });
  configure?.(builder);
  const module = await builder.compile();
  const app = module.createNestApplication<INestApplication<Server>>();
  try {
    configureAnimalRecordHttp(app);
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

@Module({})
class SimulatedServicesModule {}

@Global()
@Module({
  providers: [
    {
      provide: getConnectionToken(),
      useValue: { models: {}, model: () => ({}) },
    },
  ],
  exports: [getConnectionToken()],
})
class SimulatedConnectionModule {}

@Module({})
class AcceptanceTestRuntime {}

async function startMountedAcceptance(
  fixture: ReturnType<typeof acceptanceStartStore>,
  store: MongoTransferRequests,
  history: AcceptanceHttpHistory,
  progress: TransferAcceptanceProgress,
) {
  const providers = [
    { provide: TransferAcceptanceStart, useValue: fixture.service },
    { provide: TRANSFER_ACCEPTANCE_PROGRESS, useValue: progress },
    { provide: PublishedOwnershipHistoryReader, useValue: history.reader },
    {
      provide: PublishedOwnershipHistoryDownloader,
      useValue: history.downloader,
    },
  ];
  const root = AppModule.withTransferAcceptance({
    module: AcceptanceTestRuntime,
    providers,
    exports: providers.map(({ provide }) => provide),
  });
  return startLocalHttp(
    fixture,
    { imports: [SimulatedConnectionModule, root] },
    (builder) => {
      // Keep the app's transfer composition and replace its external dependencies.
      for (const dependency of root.imports!.slice(0, -1)) {
        builder.overrideModule(dependency).useModule(SimulatedServicesModule);
      }
      builder.overrideModule(UserModule).useModule({
        module: SimulatedServicesModule,
        providers: [{ provide: SearchTransferRecipients, useValue: {} }],
        exports: [SearchTransferRecipients],
      });
      builder.overrideModule(TransferOtpModule).useModule({
        module: SimulatedServicesModule,
        providers: [{ provide: TransferOtp, useValue: {} }],
        exports: [TransferOtp],
      });
      for (const dependency of [OwnershipArchiveModule, NotificationModule]) {
        builder.overrideModule(dependency).useModule(SimulatedServicesModule);
      }
      builder.overrideProvider('TransferRequestStore').useValue(store);
    },
  );
}

export async function startAcceptanceHttp(
  fixture: ReturnType<typeof acceptanceStartStore>,
  runtime?: {
    history: AcceptanceHttpHistory;
    progress: TransferAcceptanceProgress;
  },
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
  const app = runtime
    ? await startMountedAcceptance(
        fixture,
        store,
        runtime.history,
        runtime.progress,
      )
    : await startLocalHttp(fixture, {
        controllers: [AnimalTransferController],
        providers: [
          TransferRequests,
          { provide: 'TransferRequestStore', useValue: store },
          {
            provide: TRANSFER_ACCEPTANCE_DECISION,
            useValue: fixture.service,
          },
          { provide: TransferOtp, useValue: {} },
          { provide: SearchTransferRecipients, useValue: {} },
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
