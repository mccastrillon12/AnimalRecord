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
import { NotificationController } from '../../../src/app/notification/notification.controller';
import { Notifications } from '../../../src/context/notification/application/notifications';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../../../src/app/shared/authenticated-request';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';
import { notificationFixture } from '../fixtures/notification.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';

describe('Notification inbox HTTP with real service/adapter and simulated storage', () => {
  let app: INestApplication<Server>, f: ReturnType<typeof notificationFixture>;
  beforeEach(async () => {
    f = notificationFixture();
    const module = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [{ provide: Notifications, useValue: f.service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context
            .switchToHttp()
            .getRequest<
              AuthenticatedRequest & { headers: Record<string, string> }
            >();
          const actor =
            req.headers.authorization === 'Bearer actor'
              ? otpActor
              : req.headers.authorization === 'Bearer other'
                ? otpOther
                : undefined;
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
  it('loads the paginated inbox/count and marks only the notice read, preserving its first timestamp on replay', async () => {
    const count = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', 'Bearer actor')
      .expect(200);
    expect(count.body).toEqual({ count: 2 });
    expect(count.headers['cache-control']).toBe('private, no-store');
    const page = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', 'Bearer actor')
      .query({ limit: 2 })
      .expect(200);
    const body = page.body as {
      items: Array<{ id: string; transferId: string; readAt?: string }>;
      nextCursor: string;
    };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeDefined();
    expect(JSON.stringify(page.body)).not.toMatch(
      /internalPayload|private payload|userId|_id/,
    );
    expect(page.headers['cache-control']).toBe('private, no-store');
    const next = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', 'Bearer actor')
      .query({ limit: 2, cursor: body.nextCursor })
      .expect(200);
    expect((next.body as { items: unknown[] }).items).toHaveLength(1);
    const read = await request(app.getHttpServer())
      .patch(`/notifications/${f.id(100)}/read`)
      .set('Authorization', 'Bearer actor')
      .send({})
      .expect(200);
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect((read.body as { readAt: string }).readAt).toBeDefined();
    const replay = await request(app.getHttpServer())
      .patch(`/notifications/${f.id(100)}/read`)
      .set('Authorization', 'Bearer actor')
      .expect(200);
    expect(replay.body).toEqual(read.body);
    const refreshed = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', 'Bearer actor')
      .expect(200);
    expect(refreshed.body).toEqual({ count: 1 });
    await request(app.getHttpServer())
      .post(`/notifications/${f.id(100)}/accept`)
      .set('Authorization', 'Bearer actor')
      .send({})
      .expect(404);
  });
  it('returns only the authenticated user inbox and no distinction between another user notice and a missing notice', async () => {
    const other = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', 'Bearer other')
      .expect(200);
    expect(
      (other.body as { items: Array<{ id: string }> }).items.map((i) => i.id),
    ).toEqual([f.id(999)]);
    for (const id of [f.id(999), f.id(91)]) {
      const result = await request(app.getHttpServer())
        .patch(`/notifications/${id}/read`)
        .set('Authorization', 'Bearer actor')
        .send({})
        .expect(404);
      expect((result.body as { message: string }).message).toBe(
        'Notification not found',
      );
    }
    expect(f.rows.find((r) => r._id === f.id(999))!.readAt).toBeUndefined();
  });
  it('requires authentication before queries or writes on every endpoint', async () => {
    await request(app.getHttpServer()).get('/notifications').expect(401);
    await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/notifications/${f.id(100)}/read`)
      .send({})
      .expect(401);
    expect(f.calls).toEqual([]);
  });
  it.each([
    { limit: 0 },
    { limit: 51 },
    { cursor: 'invalid' },
    { userId: otpOther },
    { status: 'PENDING' },
  ])('rejects unsupported query %j', async (query) => {
    await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', 'Bearer actor')
      .query(query)
      .expect(400);
    expect(f.calls).toEqual([]);
  });
  it.each([
    { userId: otpOther },
    { readAt: '2020-01-01T00:00:00.000Z' },
    { decision: 'ACCEPTED' },
  ])(
    'rejects an alternate owner, timestamp or transfer decision %j',
    async (body) => {
      await request(app.getHttpServer())
        .patch(`/notifications/${f.id(100)}/read`)
        .set('Authorization', 'Bearer actor')
        .send(body)
        .expect(400);
      expect(f.calls).toEqual([]);
    },
  );
  it('rejects another actor cursor and malformed notification IDs before a write', async () => {
    const page = await f.service.list(otpActor, 1);
    f.calls.length = 0;
    await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', 'Bearer other')
      .query({ cursor: page.nextCursor })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/notifications/invalid/read')
      .set('Authorization', 'Bearer actor')
      .send({})
      .expect(400);
    expect(f.calls).toEqual([]);
  });
  it('returns sanitized 503 without concealing a failure behind an empty inbox or zero count', async () => {
    f.flags.readFailure = true;
    for (const path of ['/notifications', '/notifications/unread-count']) {
      const result = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer actor')
        .expect(503);
      expect(Object.keys(result.body as object).sort()).toEqual([
        'message',
        'path',
        'statusCode',
        'timestamp',
      ]);
      expect(JSON.stringify(result.body)).not.toMatch(
        /private|credentials|provider|URI/,
      );
    }
  });
  it('documents the three operations with owner authentication, optional read timestamp and no decisions', () => {
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    expect(Object.keys(spec.paths)).toEqual([
      '/notifications',
      '/notifications/unread-count',
      '/notifications/{id}/read',
    ]);
    expect(spec.paths['/notifications/{id}/read'].patch!.security).toEqual([
      { 'access-token': [] },
    ]);
    const schema = spec.components!.schemas!.NotificationResponseDto as {
      required: string[];
      properties: object;
    };
    expect(schema.required).not.toContain('readAt');
    expect(Object.keys(schema.properties)).not.toContain('userId');
  });
});
