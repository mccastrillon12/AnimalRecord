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
import { TransferOtpController } from '../../../src/app/animal-transfer/transfer-otp.controller';
import { TransferOtp } from '../../../src/context/animal-transfer/application/transfer-otp';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../../../src/app/shared/authenticated-request';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';
import { transferOtpFixture, otpActor } from '../fixtures/transfer-otp.fixture';

describe('Transfer OTP HTTP contract with real service/sender and simulated persistence/delivery', () => {
  let app: INestApplication<Server>;
  let f: ReturnType<typeof transferOtpFixture>;
  beforeEach(async () => {
    f = transferOtpFixture();
    const module = await Test.createTestingModule({
      controllers: [TransferOtpController],
      providers: [{ provide: TransferOtp, useValue: f.service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context
            .switchToHttp()
            .getRequest<
              AuthenticatedRequest & { headers: Record<string, string> }
            >();
          if (req.headers.authorization !== 'Bearer test')
            throw new UnauthorizedException();
          req.user = { id: otpActor };
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
  const url = '/animal-transfers/otp-challenges';
  it('creates and verifies without returning a code/hash/login token or writing account verification', async () => {
    const before = f.account.toPrimitives();
    const issued = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer test')
      .send({})
      .expect(201);
    const challenge = issued.body as {
      challengeId: string;
      channel: string;
      maskedDestination: string;
    };
    expect(challenge.channel).toBe('EMAIL');
    expect(challenge.maskedDestination).toBe('a***@example.com');
    expect(issued.headers['cache-control']).toBe('private, no-store');
    expect(f.email.sendVerificationCode).toHaveBeenCalledWith(
      'ana@example.com',
      f.code(),
      { purpose: 'ANIMAL_TRANSFER', expiresInMinutes: 15 },
    );
    const verified = await request(app.getHttpServer())
      .post(`${url}/${challenge.challengeId}/verify`)
      .set('Authorization', 'Bearer test')
      .send({ code: f.code() })
      .expect(200);
    expect(Object.keys(verified.body as object).sort()).toEqual([
      'challengeId',
      'expiresAt',
      'proof',
      'purpose',
    ]);
    expect(verified.headers['cache-control']).toBe('private, no-store');
    expect(f.account.toPrimitives()).toEqual(before);
    expect(f.users.update).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(`${url}/${challenge.challengeId}/verify`)
      .set('Authorization', 'Bearer test')
      .send({ code: f.code() })
      .expect(400);
  });
  it('rejects unauthenticated requests before preparing or sending a challenge', async () => {
    await request(app.getHttpServer()).post(url).send({}).expect(401);
    expect(f.store.put).not.toHaveBeenCalled();
    expect(f.sender.run).not.toHaveBeenCalled();
  });
  it.each([
    { email: 'other@example.com' },
    { actorId: otpActor },
    { destination: '+573001111111' },
  ])('refuses an alternate identity/destination %j', async (body) => {
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer test')
      .send(body)
      .expect(400);
    expect(f.sender.run).not.toHaveBeenCalled();
  });
  it('returns Retry-After and only resends after the server cooldown', async () => {
    const c = await f.service.issue(otpActor);
    const limited = await request(app.getHttpServer())
      .post(`${url}/${c.challengeId}/resend`)
      .set('Authorization', 'Bearer test')
      .send({})
      .expect(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(f.sender.run).toHaveBeenCalledTimes(1);
    f.advance(60000);
    await request(app.getHttpServer())
      .post(`${url}/${c.challengeId}/resend`)
      .set('Authorization', 'Bearer test')
      .send({})
      .expect(200);
    expect(f.sender.run).toHaveBeenCalledTimes(2);
  });
  it.each([
    { code: 123456 },
    { code: '12345' },
    { code: '123456', purpose: 'LOGIN' },
  ])('validates the verification body %j', async (body) => {
    const c = await f.service.issue(otpActor);
    await request(app.getHttpServer())
      .post(`${url}/${c.challengeId}/verify`)
      .set('Authorization', 'Bearer test')
      .send(body)
      .expect(400);
    expect(f.store.claimAttempt).not.toHaveBeenCalled();
  });
  it('sanitizes delivery failures instead of exposing provider secrets or claiming the code is usable', async () => {
    f.sender.run.mockRejectedValueOnce(
      new Error('secret raw code/credentials'),
    );
    const result = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', 'Bearer test')
      .send({})
      .expect(502);
    expect(JSON.stringify(result.body)).not.toMatch(
      /secret|credentials|code\/|hash/,
    );
    expect(f.state()!.status).toBe('DELIVERY_PENDING');
  });
  it('documents the three operations and an authorization separate from login', () => {
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    expect(Object.keys(spec.paths)).toEqual([
      url,
      `${url}/{id}/resend`,
      `${url}/{id}/verify`,
    ]);
    expect(spec.components!.schemas!.TransferOtpAuthorizationDto).toMatchObject(
      { properties: { purpose: { enum: ['ANIMAL_TRANSFER'] } } },
    );
  });
});
