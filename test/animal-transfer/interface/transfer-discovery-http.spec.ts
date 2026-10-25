import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Server } from 'http';
import * as request from 'supertest';
import { AnimalTransferController } from '../../../src/app/animal-transfer/animal-transfer.controller';
import { TransferRecipientPageResponseDto } from '../../../src/app/animal-transfer/search-transfer-recipients.dto';
import { AnimalTransferReasonResponseDto } from '../../../src/app/catalogs/animal-transfer-reason-response.dto';
import { CatalogsController } from '../../../src/app/catalogs/catalogs.controller';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../../../src/app/shared/authenticated-request';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';
import { CatalogsFinder } from '../../../src/context/catalogs/application/catalogs-finder';
import { CatalogsSeeder } from '../../../src/context/catalogs/application/catalogs-seeder';
import { INITIAL_ANIMAL_TRANSFER_REASONS } from '../../../src/context/catalogs/domain/animal-transfer-reason';
import { MongoCatalogsRepository } from '../../../src/context/catalogs/infrastructure/persistence/mongo/mongo-catalogs-repository';
import { SearchTransferRecipients } from '../../../src/context/user/application/search-transfer-recipients';
import { literalNamePattern } from '../../../src/context/user/infrastructure/persistence/mongo/mongo-transfer-recipient-search';

describe('Transfer discovery HTTP contract', () => {
  let app: INestApplication<Server>;
  const actorId = '123e4567-e89b-42d3-a456-426614174001';
  const recipients = [2, 3, 4].map((number) => ({
    id: `123e4567-e89b-42d3-a456-42661417400${number}`,
    name: 'Ana María',
    identificationType: 'CC',
    identificationNumber: `100${number}`,
  }));
  const search = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AnimalTransferController, CatalogsController],
      providers: [
        SearchTransferRecipients,
        CatalogsFinder,
        {
          provide: 'TransferRecipientSearch',
          useValue: { searchByName: search },
        },
        {
          provide: 'CatalogsRepository',
          useValue: {
            findAnimalTransferReasons: () =>
              Promise.resolve(INITIAL_ANIMAL_TRANSFER_REASONS),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<AuthenticatedRequest>().user = {
            id: actorId,
          };
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
  beforeEach(() => {
    jest.clearAllMocks();
    search.mockResolvedValue(recipients);
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns identification and a next-page cursor, excluding the authenticated sender in the query', async () => {
    const response = await request(app.getHttpServer())
      .get('/animal-transfers/recipients')
      .query({ q: ' Ana   María ', limit: 2 })
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const body = response.body as TransferRecipientPageResponseDto;
    expect(body.items).toEqual(recipients.slice(0, 2));
    expect(search).toHaveBeenCalledWith('Ana María', actorId, 3, undefined);
    search.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get('/animal-transfers/recipients')
      .query({ q: 'Ana', limit: 2, cursor: body.nextCursor })
      .expect(200);
    expect(search).toHaveBeenLastCalledWith(
      'Ana',
      actorId,
      3,
      recipients[1].id,
    );
  });

  it.each([
    { q: 'a' },
    { q: 'Ana', limit: 0 },
    { q: 'Ana', limit: 51 },
    { q: 'Ana', searchBy: 'IDENTIFICATION' },
    { q: 'Ana', searchBy: 'UNKNOWN' },
    { q: 'Ana', cursor: 'invalid' },
  ])(
    'rejects invalid or not-yet-enabled search parameters: %j',
    async (query) => {
      await request(app.getHttpServer())
        .get('/animal-transfers/recipients')
        .query(query)
        .expect(400);
      expect(search).not.toHaveBeenCalled();
    },
  );

  it('serves the five seeded dropdown options and Other does not require a comment', async () => {
    const response = await request(app.getHttpServer())
      .get('/catalogs/animal-transfer-reasons')
      .expect(200);
    const body = response.body as AnimalTransferReasonResponseDto[];
    expect(body).toHaveLength(5);
    expect(body.map((item) => item.name)).toEqual([
      'Compra / venta',
      'Adopción',
      'Regalo / donación',
      'Cambio de cuenta principal',
      'Otro',
    ]);
    expect(body.every((item) => !item.requiresComment)).toBe(true);
  });

  it('documents recipient fields, enum and dropdown in Swagger', () => {
    const api = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(
      api.paths['/animal-transfers/recipients']?.get?.security,
    ).toBeDefined();
    expect(
      JSON.stringify(api.components?.schemas?.TransferRecipientResponseDto),
    ).toContain('identificationNumber');
    expect(api.paths['/catalogs/animal-transfer-reasons']).toBeDefined();
  });
});

it('matches accented names literally without treating user input as regex syntax', () => {
  expect(new RegExp(literalNamePattern('Jose'), 'i').test('JOSÉ')).toBe(true);
  expect(new RegExp(literalNamePattern('María'), 'i').test('Maria')).toBe(true);
  expect(new RegExp(literalNamePattern('.*'), 'i').test('Ana')).toBe(false);
  expect(new RegExp(literalNamePattern('.*'), 'i').test('.*')).toBe(true);
});

it('seeds stable reason ids repeatedly without changing existing catalog customizations', async () => {
  const updateOne = jest
    .fn()
    .mockReturnValue({ exec: () => Promise.resolve({}) });
  const args = [
    ...Array<undefined>(9).fill(undefined),
    { updateOne },
  ] as unknown as ConstructorParameters<typeof MongoCatalogsRepository>;
  const repository = new MongoCatalogsRepository(...args);
  const seeder = new CatalogsSeeder(repository);
  await seeder.seedAnimalTransferReasons();
  await seeder.seedAnimalTransferReasons();
  expect(updateOne).toHaveBeenCalledTimes(10);
  for (const reason of INITIAL_ANIMAL_TRANSFER_REASONS) {
    const { id, ...fields } = reason;
    expect(updateOne).toHaveBeenCalledWith(
      { code: reason.code },
      { $setOnInsert: { _id: id, ...fields } },
      { upsert: true },
    );
  }
});
