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
import { startAcceptanceHttp } from '../fixtures/acceptance-http.fixture';
import { acceptanceStartStore } from '../fixtures/acceptance-start-store.fixture';
import { transferRequestFixture } from '../fixtures/transfer-request.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';

it('returns the persisted PROCESSING summary on a newly acknowledged local acceptance', async () => {
  const fixture = acceptanceStartStore(1);
  const http = await startAcceptanceHttp(fixture);
  const { expectedVersion, acceptedAnimalIds, operationId, transferId } =
    fixture.input;
  try {
    const started = await http
      .decide('recipient', operationId)
      .send({ expectedVersion, acceptedAnimalIds })
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(started.body).toMatchObject({
      id: transferId,
      status: 'PROCESSING',
      version: 2,
    });
    const { decidedAt } = started.body as { decidedAt: string };
    expect(new Date(decidedAt).toISOString()).toBe(decidedAt);
    const detail = await http.detail().expect(200);
    expect(detail.body).toMatchObject({
      request: started.body as Record<string, unknown>,
      items: [{ animalId: acceptedAnimalIds[0], status: 'PROCESSING' }],
    });
    expect(fixture.state.db.animals[0].ownerId).toBe(fixture.actorId);
    expect(fixture.state.db.events.map(({ type }) => type)).toEqual([
      'REQUEST_ACCEPTANCE_STARTED',
    ]);
  } finally {
    await http.close();
  }
});

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
    expect(page.items[0]).toMatchObject({
      animalId: f.id(100),
      animalName: 'Animal 1',
      animalCode: 'AR-1',
      animalBreed: 'Mestizo',
      animalSex: 'MALE',
      animalAge: { type: 'APPROXIMATE', minMonths: 0, maxMonths: 6 },
    });
    expect(page.nextCursor).toBeDefined();
    expect(JSON.stringify(detail.body)).not.toMatch(
      /authorization|proof|expectedOwner|bodyHash|birthDate|diagnosis|password/,
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
    const before = f.snapshot();
    const decision = await request(app.getHttpServer())
      .post(`${url}/${result.id}/decisions`)
      .set('Authorization', 'Bearer recipient')
      .set('Idempotency-Key', f.id(2))
      .send({ expectedVersion: 1, acceptedAnimalIds: [f.id(100)] })
      .expect(409);
    expect(decision.body).toMatchObject({
      message: 'Transfer acceptance is not enabled; no decisions were applied',
    });
    expect(f.snapshot()).toEqual(before);
  });
  it('reads a pre-existing item whose request only captured name and code', async () => {
    const { request: created } = await f.service.create(
      otpActor,
      f.id(1),
      await f.authorized(),
    );
    const [legacy] = f.db().items;
    delete legacy.animalBreed;
    delete legacy.animalSex;
    delete legacy.animalAge;
    const detail = await request(app.getHttpServer())
      .get(`${url}/${created.id}`)
      .set('Authorization', 'Bearer recipient')
      .query({ limit: 1 })
      .expect(200);
    expect(detail.body).toMatchObject({
      items: [
        {
          id: legacy._id,
          animalId: legacy.animalId,
          animalName: 'Animal 1',
          animalCode: 'AR-1',
          status: 'PENDING',
        },
      ],
    });
    const { items } = detail.body as { items: object[] };
    expect(Object.keys(items[0]).sort()).toEqual([
      'animalCode',
      'animalId',
      'animalName',
      'id',
      'status',
    ]);
  });
  it('returns signed previews for authorized items on each page of an existing request', async () => {
    const { request: created } = await f.service.create(
      otpActor,
      f.id(1),
      await f.authorized(),
    );
    const [first, second] = f.db().animals;
    const key = (owner: string, animal: string) =>
      `users/${owner}/animals/${animal}/profile_123.jpeg`;
    const file = (owner: string, animal: string) =>
      `https://s3.example.test/${key(owner, animal)}`;
    first.profilePictureUrl = file(otpActor, first.id);
    second.profilePictureUrl = file(otpActor, second.id);
    const detail = (actor: string) =>
      request(app.getHttpServer())
        .get(`${url}/${created.id}`)
        .set('Authorization', `Bearer ${actor}`);
    await detail('other').expect(403);
    expect(f.photoStorage.signAnimalMediaDownload).not.toHaveBeenCalled();
    const page1 = await detail('recipient')
      .query({ limit: 1 })
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(page1.body).toMatchObject({
      items: [
        {
          animalId: first.id,
          animalProfilePictureUrl: `${first.profilePictureUrl}?signature=synthetic`,
        },
      ],
    });
    expect(f.photoStorage.signAnimalMediaDownload.mock.calls).toEqual([
      [key(otpActor, first.id)],
    ]);
    const { nextCursor } = page1.body as { nextCursor: string };
    const page2 = await detail('recipient')
      .query({ limit: 1, cursor: nextCursor })
      .expect(200);
    expect(page2.body).toMatchObject({
      items: [
        {
          animalId: second.id,
          animalProfilePictureUrl: `${second.profilePictureUrl}?signature=synthetic`,
        },
      ],
    });

    f.db().animals[1].profilePictureUrl = file(otpActor, first.id);
    f.photoStorage.signAnimalMediaDownload.mockRejectedValueOnce(
      new Error('Synthetic signing unavailable'),
    );
    const stillReadable = await detail('recipient').expect(200);
    expect(stillReadable.body).not.toHaveProperty(
      'items.0.animalProfilePictureUrl',
    );
    expect(stillReadable.body).not.toHaveProperty(
      'items.1.animalProfilePictureUrl',
    );
    expect(f.photoStorage.signAnimalMediaDownload).toHaveBeenCalledTimes(3);

    Object.assign(f.db().requests[0], {
      status: 'PARTIALLY_ACCEPTED',
      version: 3,
    });
    f.db().items[0].status = 'ACCEPTED';
    f.db().items[1].status = 'REJECTED';
    const recipientPhoto = file(otpOther, first.id);
    Object.assign(f.db().animals[0], {
      ownerId: otpOther,
      profilePictureUrl: recipientPhoto,
    });
    const received = await detail('recipient').expect(200);
    expect(received.body).toMatchObject({
      items: [
        {
          status: 'ACCEPTED',
          animalProfilePictureUrl: `${recipientPhoto}?signature=synthetic`,
        },
        { status: 'REJECTED' },
      ],
    });
    expect(received.body).not.toHaveProperty('items.1.animalProfilePictureUrl');
    const sent = await detail('sender').expect(200);
    expect(sent.body).not.toHaveProperty('items.0.animalProfilePictureUrl');
    expect(f.photoStorage.signAnimalMediaDownload).toHaveBeenCalledTimes(4);
  });
  it('reads internally started PROCESSING metadata without exposing receipts or enabling public acceptance/rejection', async () => {
    const body = await f.authorized();
    const created = await f.service.create(otpActor, f.id(1), body);
    const row = f.db().requests[0];
    row.status = 'PROCESSING';
    row.version = 2;
    row.decidedAt = '2026-10-29T12:00:00.000Z';
    Object.assign(row, {
      acceptanceStart: { privateReceipt: 'internal' },
      captureStepRevision: 7,
    });
    Object.assign(f.db().items[0], {
      status: 'PROCESSING',
      captureArchiveId: f.id(70),
      captureReservationEpoch: 1,
      captureStepRevision: 7,
    });
    f.db().items[1].status = 'REJECTED';
    const before = f.snapshot();
    const detail = await request(app.getHttpServer())
      .get(`${url}/${created.request.id}`)
      .set('Authorization', 'Bearer recipient')
      .expect(200);
    expect(detail.body).toMatchObject({
      request: { status: 'PROCESSING', version: 2 },
      items: [{ status: 'PROCESSING' }, { status: 'REJECTED' }],
    });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /acceptanceStart|privateReceipt|captureArchive|captureReservation|captureStepRevision|operationId/,
    );
    const listed = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer recipient')
      .expect(200);
    expect(listed.body).toMatchObject({ items: [{ status: 'PROCESSING' }] });
    await request(app.getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer recipient')
      .query({ status: 'PROCESSING' })
      .expect(400);
    for (const ids of [[], [f.id(100)]])
      await request(app.getHttpServer())
        .post(`${url}/${created.request.id}/decisions`)
        .set('Authorization', 'Bearer recipient')
        .set('Idempotency-Key', f.id(2))
        .send({ expectedVersion: 2, acceptedAnimalIds: ids })
        .expect(409);
    expect(f.snapshot()).toEqual(before);
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
    expect(
      spec.components!.schemas!.TransferRequestItemResponseDto,
    ).toMatchObject({
      properties: {
        animalBreed: { type: 'string' },
        animalSex: { type: 'string' },
        animalAge: {
          oneOf: [
            { required: ['type', 'months'] },
            { required: ['type', 'minMonths', 'maxMonths'] },
          ],
        },
      },
    });
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
