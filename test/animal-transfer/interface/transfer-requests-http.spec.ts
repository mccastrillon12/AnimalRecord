import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Server } from 'http';
import * as request from 'supertest';
import { AnimalTransferController } from '../../../src/app/animal-transfer/animal-transfer.controller';
import { TransferRequests } from '../../../src/context/animal-transfer/application/transfer-requests';
import { SearchTransferRecipients } from '../../../src/context/user/application/search-transfer-recipients';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../../../src/app/shared/authenticated-request';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';
import { transferRequestFixture } from '../fixtures/transfer-request.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';

describe('Pending transfer requests HTTP with real service and simulated atomic persistence', () => {
  let app: INestApplication<Server>,
    f: ReturnType<typeof transferRequestFixture>;
  beforeEach(async () => {
    f = transferRequestFixture();
    const module = await Test.createTestingModule({
      controllers: [AnimalTransferController],
      providers: [
        { provide: TransferRequests, useValue: f.service },
        {
          provide: SearchTransferRecipients,
          useValue: { run: () => Promise.resolve({ items: [] }) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context
            .switchToHttp()
            .getRequest<
              AuthenticatedRequest & { headers: Record<string, string> }
            >();
          const actors: Record<string, string> = {
            'Bearer sender': otpActor,
            'Bearer recipient': otpOther,
            'Bearer other': f.id(90),
          };
          const actor = actors[req.headers.authorization];
          if (!actor) throw new UnauthorizedException();
          req.user = { id: actor };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  const url = '/animal-transfers';
  it('creates once, replays with 200, lists by participant and exposes only paginated identifying metadata', async () => {
    const body = await f.authorized();
    const created = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer sender')
      .set('Idempotency-Key', f.id(1))
      .send(body)
      .expect(201);
    const result = created.body as {
      id: string;
      status: string;
      version: number;
    };
    expect(result).toMatchObject({ status: 'PENDING', version: 1 });
    expect(created.headers['cache-control']).toBe('private, no-store');
    const replay = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer sender')
      .set('Idempotency-Key', f.id(1))
      .send(body)
      .expect(200);
    expect(replay.body).toEqual(created.body);
    expect(f.otp.store.consume).toHaveBeenCalledTimes(1);
    const incoming = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer recipient')
      .query({ direction: 'INCOMING' })
      .expect(200);
    expect((incoming.body as { items: unknown[] }).items).toEqual([
      created.body,
    ]);
    const detail = await request(app.getHttpServer())
      .get(`${url}/${result.id}`)
      .set('Authorization', 'Bearer recipient')
      .query({ limit: 1 })
      .expect(200);
    const page = detail.body as { items: object[]; nextCursor: string };
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeDefined();
    expect(JSON.stringify(detail.body)).not.toMatch(
      /authorization|proof|expectedOwner|bodyHash|diagnosis|password/,
    );
    await request(app.getHttpServer())
      .get(`${url}/${result.id}`)
      .set('Authorization', 'Bearer sender')
      .query({ cursor: page.nextCursor })
      .expect(400);
    await request(app.getHttpServer())
      .get(`${url}/${result.id}`)
      .set('Authorization', 'Bearer other')
      .expect(403);
    expect(f.db().outbox).toHaveLength(2);
    expect(f.db().events).toHaveLength(1);
    await request(app.getHttpServer())
      .post(`${url}/${result.id}/decisions`)
      .set('Authorization', 'Bearer recipient')
      .set('Idempotency-Key', f.id(2))
      .send({ expectedVersion: 1, acceptedAnimalIds: [f.id(100)] })
      .expect(409);
  });
  it('preserves /recipients and requires authentication before creation', async () => {
    await request(app.getHttpServer())
      .get(`${url}/recipients`)
      .set('Authorization', 'Bearer sender')
      .query({ q: 'Ana' })
      .expect(200);
    await request(app.getHttpServer()).post(url).send({}).expect(401);
    expect(f.otp.store.consume).not.toHaveBeenCalled();
  });
  it.each([
    'missing-key',
    'duplicate-animal',
    'self',
    'owner-override',
    'missing-proof',
  ])(
    'rejects %s without persisting a request or consuming the proof',
    async (change) => {
      const body = await f.authorized();
      if (change === 'duplicate-animal') body.animalIds.push(body.animalIds[0]);
      if (change === 'self') body.recipientId = otpActor;
      if (change === 'owner-override')
        Object.assign(body, { senderId: otpOther });
      if (change === 'missing-proof')
        Object.assign(body, { authorization: {} });
      const op = request(app.getHttpServer())
        .post(url)
        .set('Authorization', 'Bearer sender');
      if (change !== 'missing-key') op.set('Idempotency-Key', f.id(1));
      await op.send(body).expect(400);
      expect(f.db().requests).toHaveLength(0);
      expect(f.otp.state()!.status).toBe('VERIFIED');
    },
  );
  it('returns 409 for a changed intent under the same key and resolves a lost reply through an explicit replay', async () => {
    const body = await f.authorized();
    f.fault.lostReply = true;
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer sender')
      .set('Idempotency-Key', f.id(1))
      .send(body)
      .expect(503);
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer sender')
      .set('Idempotency-Key', f.id(1))
      .send(body)
      .expect(200);
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer sender')
      .set('Idempotency-Key', f.id(1))
      .send({ ...body, recipientId: f.id(90) })
      .expect(409);
    expect(f.db().requests).toHaveLength(1);
    expect(f.db().outbox).toHaveLength(2);
  });
  it.each([
    { direction: 'ALL' },
    { limit: 0 },
    { limit: 51 },
    { cursor: 'broken' },
    { status: 'ACCEPTED' },
  ])('rejects unsupported list query %j', async (query) => {
    await request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer sender')
      .query(query)
      .expect(400);
  });
  it('documents create/list/detail with idempotency, metadata-only responses and no acceptance operation', () => {
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    expect(spec.paths[url].post!.parameters).toContainEqual(
      expect.objectContaining({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
      }),
    );
    expect(spec.paths[`${url}/{id}`].get).toBeDefined();
    expect(
      spec.paths[`${url}/{id}/decisions`].post!.responses['200'],
    ).toBeDefined();
    expect(
      JSON.stringify(spec.components!.schemas!.TransferRequestResponseDto),
    ).not.toMatch(/proof|bodyHash|authorizationChallenge/);
  });
  it('lets only the recipient reject all, returns a replayable 200 and removes the request from the pending list', async () => {
    const body = await f.authorized(),
      created = await f.service.create(otpActor, f.id(1), body),
      path = `${url}/${created.request.id}/decisions`;
    const decide = () =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer recipient')
        .set('Idempotency-Key', f.id(2))
        .send({ expectedVersion: 1, acceptedAnimalIds: [] });
    const first = await decide().expect(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body).toMatchObject({
      status: 'REJECTED',
      version: 2,
      decidedAt: expect.any(String) as unknown,
    });
    expect((await decide().expect(200)).body).toEqual(first.body);
    const pending = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer recipient')
      .query({ status: 'PENDING' })
      .expect(200);
    expect(pending.body).toEqual({ items: [] });
    const rejected = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer recipient')
      .query({ status: 'REJECTED' })
      .expect(200);
    expect((rejected.body as { items: unknown[] }).items).toHaveLength(1);
    expect(JSON.stringify(first.body)).not.toMatch(
      /decisionOperation|decisionExpected|proof|bodyHash/,
    );
  });
  it.each(['sender', 'other', 'unauthenticated'] as const)(
    'rejects a decision by %s before mutation',
    async (actor) => {
      const created = await f.service.create(
        otpActor,
        f.id(1),
        await f.authorized(),
      );
      const op = request(app.getHttpServer())
        .post(`${url}/${created.request.id}/decisions`)
        .set('Idempotency-Key', f.id(2));
      if (actor !== 'unauthenticated')
        op.set('Authorization', `Bearer ${actor}`);
      await op
        .send({ expectedVersion: 1, acceptedAnimalIds: [] })
        .expect(actor === 'unauthenticated' ? 401 : 403);
      expect(f.db().requests[0].status).toBe('PENDING');
      expect(f.db().claims).toHaveLength(2);
    },
  );
  it.each([
    { acceptedAnimalIds: [] },
    { expectedVersion: 0, acceptedAnimalIds: [] },
    { expectedVersion: '1', acceptedAnimalIds: [] },
    { expectedVersion: 1, acceptedAnimalIds: ['invalid'] },
    { expectedVersion: 1, acceptedAnimalIds: [], recipientId: otpOther },
  ])('validates decision body %j', async (body) => {
    const created = await f.service.create(
      otpActor,
      f.id(1),
      await f.authorized(),
    );
    await request(app.getHttpServer())
      .post(`${url}/${created.request.id}/decisions`)
      .set('Authorization', 'Bearer recipient')
      .set('Idempotency-Key', f.id(2))
      .send(body)
      .expect(400);
    expect(f.db().requests[0].status).toBe('PENDING');
  });
});
