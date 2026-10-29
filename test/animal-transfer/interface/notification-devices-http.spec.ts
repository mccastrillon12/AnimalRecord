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
import { NotificationDeviceController } from '../../../src/app/notification/notification-device.controller';
import { NotificationDevices } from '../../../src/context/notification/application/notification-devices';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../../../src/app/shared/authenticated-request';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';
import { notificationDeviceFixture } from '../fixtures/notification-device.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';

describe('Notification installation HTTP, simulated transactions and no FCM', () => {
  let app: INestApplication<Server>,
    f: ReturnType<typeof notificationDeviceFixture>;
  beforeEach(async () => {
    f = notificationDeviceFixture();
    const module = await Test.createTestingModule({
      controllers: [NotificationDeviceController],
      providers: [{ provide: NotificationDevices, useValue: f.service }],
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
  const body = {
    provider: 'FCM',
    platform: 'ANDROID',
    token: 'synthetic-push-token-A',
  };
  const path = () => `/notification-devices/${f.installationId}`;
  function put(operation: string, revision: number, actor = 'actor') {
    return request(app.getHttpServer())
      .put(path())
      .set('Authorization', `Bearer ${actor}`)
      .set('X-Installation-Key', f.key)
      .set('Idempotency-Key', operation)
      .set('If-Match', `"${revision}"`);
  }
  it('registers, replays, inspects, rotates and disables without returning token, key or another account identity', async () => {
    const operation = f.nextOperation();
    const initial = await put(operation, 0).send(body).expect(200);
    expect(initial.body).toMatchObject({
      revision: 1,
      registeredToCurrentUser: true,
      state: 'ACTIVE',
    });
    expect(initial.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(initial.body)).not.toMatch(
      /token|Hash|userId|synthetic|Operation|key/,
    );
    expect((await put(operation, 0).send(body).expect(200)).body).toEqual(
      initial.body,
    );
    const inspected = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', 'Bearer other')
      .set('X-Installation-Key', f.key)
      .expect(200);
    expect(inspected.body).toMatchObject({
      revision: 1,
      registeredToCurrentUser: false,
    });
    await put(f.nextOperation(), 1)
      .send({ ...body, token: 'rotated-token' })
      .expect(200);
    const removal = f.nextOperation();
    const disabled = await request(app.getHttpServer())
      .delete(path())
      .set('Authorization', 'Bearer actor')
      .set('X-Installation-Key', f.key)
      .set('Idempotency-Key', removal)
      .set('If-Match', '"2"')
      .expect(200);
    expect(disabled.body).toMatchObject({
      revision: 3,
      state: 'DISABLED',
      registeredToCurrentUser: false,
    });
    expect(f.claims().size).toBe(0);
    expect(f.rows().get(f.installationId)).not.toHaveProperty('token');
    await put(operation, 0).send(body).expect(409);
  });
  it('supports a deliberate account switch and prevents delayed old-account deletes from affecting it', async () => {
    await put(f.nextOperation(), 0).send(body).expect(200);
    await put(f.nextOperation(), 1, 'other').send(body).expect(200);
    await request(app.getHttpServer())
      .delete(path())
      .set('Authorization', 'Bearer actor')
      .set('X-Installation-Key', f.key)
      .set('Idempotency-Key', f.nextOperation())
      .set('If-Match', '"1"')
      .expect(404);
    expect(f.rows().get(f.installationId)!.userId).toBe(otpOther);
  });
  it('requires login plus installation proof; UUID knowledge is not enough', async () => {
    await request(app.getHttpServer()).put(path()).send(body).expect(401);
    await request(app.getHttpServer()).get(path()).expect(401);
    await request(app.getHttpServer()).delete(path()).expect(401);
    await request(app.getHttpServer())
      .put(path())
      .set('Authorization', 'Bearer actor')
      .set('Idempotency-Key', f.nextOperation())
      .set('If-Match', '"0"')
      .send(body)
      .expect(400);
    expect(f.rows().size).toBe(0);
    await f.register();
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', 'Bearer other')
      .set('X-Installation-Key', Buffer.alloc(32, 8).toString('base64url'))
      .expect(404);
  });
  it.each([
    { userId: otpOther },
    { provider: 'APNS' },
    { platform: 'WEB' },
    { token: '' },
  ])('rejects unsupported fields %j', async (change) => {
    await put(f.nextOperation(), 0)
      .send({ ...body, ...change })
      .expect(400);
    expect(f.rows().size).toBe(0);
  });
  it('returns a sanitized conflict for a token assigned to another installation', async () => {
    await f.register(otpActor, f.id(11));
    const result = await put(f.nextOperation(), 0).send(body).expect(409);
    expect(JSON.stringify(result.body)).not.toContain(body.token);
    expect(f.rows().size).toBe(1);
  });
  it('does not accept a token or actor in a deletion body', async () => {
    await f.register();
    await request(app.getHttpServer())
      .delete(path())
      .set('Authorization', 'Bearer actor')
      .set('X-Installation-Key', f.key)
      .set('Idempotency-Key', f.nextOperation())
      .set('If-Match', '"1"')
      .send({ userId: otpOther })
      .expect(400);
    expect(f.rows().get(f.installationId)!.state).toBe('ACTIVE');
  });
  it('reports an uncertain outcome without automatic replay; the same operation resolves the persisted receipt', async () => {
    const operation = f.nextOperation();
    f.flags.lostReply = true;
    await put(operation, 0).send(body).expect(503);
    expect(f.find).not.toHaveBeenCalled();
    await put(operation, 0).send(body).expect(200);
    expect(f.claims().size).toBe(1);
  });
  it('documents installation credentials, revisions and response metadata without exposing a secret', () => {
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    const route = spec.paths['/notification-devices/{installationId}'];
    expect(route.get).toBeDefined();
    expect(route.delete).toBeDefined();
    expect(route.put!.parameters).toContainEqual(
      expect.objectContaining({
        name: 'If-Match',
        in: 'header',
        required: true,
      }),
    );
    expect(route.put!.parameters).toContainEqual(
      expect.objectContaining({
        name: 'X-Installation-Key',
        in: 'header',
        required: true,
      }),
    );
    expect(
      JSON.stringify(spec.components!.schemas!.NotificationDeviceResponseDto),
    ).not.toMatch(/token|keyHash|userId/);
  });
});
