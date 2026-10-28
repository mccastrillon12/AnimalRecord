import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'http';
import * as request from 'supertest';
import { AnimalController } from '../../../src/app/animal/animal.controller';
import { DiaryController } from '../../../src/app/diary/diary.controller';
import { DiaryAccessGuard } from '../../../src/app/diary/diary-access.guard';
import { JwtAuthGuard } from '../../../src/app/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../../../src/app/shared/authenticated-request';
import { HttpExceptionFilter } from '../../../src/app/shared/filters/http-exception.filter';
import { AnimalAccessPolicy } from '../../../src/context/animal/application/animal-access-policy';
import { AnimalCreator } from '../../../src/context/animal/application/creator/animal-creator';
import { AnimalFinderByOwner } from '../../../src/context/animal/application/finder-by-owner/animal-finder-by-owner';
import { AnimalFinderWithFilters } from '../../../src/context/animal/application/finder-with-filters/animal-finder-with-filters';
import { AnimalUpdater } from '../../../src/context/animal/application/updater/animal-updater';
import { GenerateAnimalProfilePictureUploadUrlUseCase } from '../../../src/context/animal/application/profile-picture/generate-animal-profile-picture-upload-url.usecase';
import { UpdateAnimalProfilePictureUseCase } from '../../../src/context/animal/application/profile-picture/update-animal-profile-picture.usecase';
import { Animal } from '../../../src/context/animal/domain/animal';
import { DiaryEntry } from '../../../src/context/diary/domain/diary-entry';
import { DiaryEntryFinder } from '../../../src/context/diary/application/diary-entry-finder';
import { DiaryEntryCreator } from '../../../src/context/diary/application/diary-entry-creator';
import { DiaryEntryUpdater } from '../../../src/context/diary/application/diary-entry-updater';
import { DiaryEntryDeleter } from '../../../src/context/diary/application/diary-entry-deleter';
import { DiaryAttachmentManager } from '../../../src/context/diary/application/diary-attachment-manager';
import { Uuid } from '../../../src/context/shared/domain/value-object/Uuid';
import { AnimalWriteCoordinator } from '../../../src/context/animal-transfer/application/animal-write-coordinator';
import { AnimalWriteInstance } from '../../../src/context/animal-transfer/application/animal-write-instance';
import { createWriteJournalFixture } from '../../animal-transfer/fixtures/animal-write-journal.fixture';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

describe('Animal ownership at HTTP boundaries', () => {
  let app: INestApplication<Server>;
  const ownerId = '123e4567-e89b-42d3-a456-426614174001';
  const otherOwner = '123e4567-e89b-42d3-a456-426614174002';
  const makeAnimal = (id: string, owner: string) =>
    Animal.fromPrimitives({
      id,
      ownerId: owner,
      name: 'Brownie',
      species: 'DOG',
      breed: 'Labrador',
      code: 'AR-C001',
      sex: 'MALE',
      reproductiveStatus: 'NEUTERED',
      hasChip: false,
      isAssociationMember: false,
      temperament: [],
      diagnosis: [],
    });
  const own = makeAnimal('123e4567-e89b-42d3-a456-426614174010', ownerId);
  const secondOwn = makeAnimal('123e4567-e89b-42d3-a456-426614174011', ownerId);
  const foreign = makeAnimal(
    '123e4567-e89b-42d3-a456-426614174012',
    otherOwner,
  );
  const entry = DiaryEntry.create(secondOwn.id.value, 'Control');
  const animals = [own, secondOwn, foreign];
  const update = jest.fn().mockResolvedValue(true);
  const filtered = jest.fn().mockResolvedValue([own]);
  const create = jest.fn();
  const uploadPicture = jest.fn();
  const confirmPicture = jest.fn<
    Promise<void>,
    Parameters<UpdateAnimalProfilePictureUseCase['run']>
  >();
  const findOwnershipControl = jest.fn().mockResolvedValue(null);
  const beginWrite = jest.fn().mockResolvedValue(true);
  const endWrite = jest.fn().mockResolvedValue(undefined);
  const journalFixture = createWriteJournalFixture();
  const recordUploadWindow = jest.fn().mockResolvedValue(true);
  const attachments = {
    generateUploadUrl: jest.fn(),
    confirmAttachment: jest.fn<
      Promise<void>,
      Parameters<DiaryAttachmentManager['confirmAttachment']>
    >(),
    deleteAttachment: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AnimalController, DiaryController],
      providers: [
        AnimalAccessPolicy,
        AnimalWriteCoordinator,
        { provide: 'AnimalWriteJournal', useValue: journalFixture.journal },
        { provide: AnimalWriteInstance, useValue: journalFixture.instance },
        AnimalUpdater,
        AnimalFinderByOwner,
        DiaryAccessGuard,
        DiaryEntryFinder,
        {
          provide: 'AnimalRepository',
          useValue: {
            findById: (id: Uuid) =>
              Promise.resolve(
                animals.find((a) => a.id.value === id.value) || null,
              ),
            findByOwner: (id: Uuid) =>
              Promise.resolve(
                animals.filter((a) => a.ownerId.value === id.value),
              ),
            update,
          },
        },
        {
          provide: 'DiaryRepository',
          useValue: { findById: () => Promise.resolve(entry) },
        },
        {
          provide: 'AnimalOwnershipRepository',
          useValue: {
            ensureCurrentOwnership: jest.fn(),
            findControl: findOwnershipControl,
            beginWrite: (input: Parameters<typeof journalFixture.acquire>[0]) =>
              journalFixture.acquire(
                input,
                () => beginWrite(input) as Promise<boolean>,
              ),
            endWrite,
            recordUploadWindow,
          },
        },
        { provide: AnimalCreator, useValue: { run: create } },
        { provide: AnimalFinderWithFilters, useValue: { run: filtered } },
        {
          provide: GenerateAnimalProfilePictureUploadUrlUseCase,
          useValue: { run: uploadPicture },
        },
        {
          provide: UpdateAnimalProfilePictureUseCase,
          useValue: { run: confirmPicture },
        },
        { provide: DiaryEntryCreator, useValue: { run: jest.fn() } },
        { provide: DiaryEntryUpdater, useValue: { run: jest.fn() } },
        { provide: DiaryEntryDeleter, useValue: { run: jest.fn() } },
        { provide: DiaryAttachmentManager, useValue: attachments },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<AuthenticatedRequest>().user = {
            id: ownerId,
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
    journalFixture.reset();
    beginWrite.mockResolvedValue(true);
    findOwnershipControl.mockImplementation((animalId: string) =>
      Promise.resolve({ animalId, ownerId, ownershipVersion: 1 }),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists only the current user animals and forces that owner on searches', async () => {
    const response = await request(app.getHttpServer())
      .get('/animals')
      .expect(200);
    expect(response.body).toHaveLength(2);
    await request(app.getHttpServer())
      .get('/animals/search?species=Canino')
      .expect(200);
    expect(filtered).toHaveBeenCalledWith(expect.objectContaining({ ownerId }));
  });

  it('rejects owner-filter and owner-route attempts to enumerate another account', async () => {
    await request(app.getHttpServer())
      .get(`/animals/search?ownerId=${otherOwner}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/animals/owner/${otherOwner}`)
      .expect(403);
    expect(filtered).not.toHaveBeenCalled();
  });

  it('allows own detail while refusing foreign detail and any foreign update', async () => {
    await request(app.getHttpServer())
      .get(`/animals/${own.id.value}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/animals/${foreign.id.value}`)
      .expect(403);
    await request(app.getHttpServer())
      .put(`/animals/${foreign.id.value}`)
      .send({ weight: 5 })
      .expect(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks ownership changes but accepts an unchanged legacy ownerId', async () => {
    await request(app.getHttpServer())
      .put(`/animals/${own.id.value}`)
      .send({ ownerId: otherOwner })
      .expect(400);
    expect(update).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .put(`/animals/${own.id.value}`)
      .send({ ownerId, weight: 5 })
      .expect(200);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('fails before mutation on journal preparation errors, retaining the existing HTTP error body', async () => {
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      journalFixture.journal.create.mockRejectedValueOnce(
        new Error('Mongo unavailable'),
      );
      const failure = await request(app.getHttpServer())
        .put(`/animals/${own.id.value}`)
        .send({ weight: 5 })
        .expect(500);
      expect(failure.body).toMatchObject({
        statusCode: 500,
        message: 'Internal server error',
      });
      expect(update).not.toHaveBeenCalled();
      expect(beginWrite).not.toHaveBeenCalled();
      journalFixture.journal.permitCallback.mockRejectedValueOnce(
        new ConflictError(
          'The animal write journal changed; refresh before retrying',
        ),
      );
      const conflict = await request(app.getHttpServer())
        .put(`/animals/${own.id.value}`)
        .send({ weight: 5 })
        .expect(409);
      expect(conflict.body).toMatchObject({
        message: 'The animal write journal changed; refresh before retrying',
      });
      expect(update).not.toHaveBeenCalled();
      expect(endWrite).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it('keeps PUT success and GET payloads unchanged even if post-callback journal evidence is unavailable', async () => {
    journalFixture.journal.settleCallback.mockRejectedValueOnce(
      new Error('Evidence unavailable'),
    );
    const success = await request(app.getHttpServer())
      .put(`/animals/${own.id.value}`)
      .send({ weight: 5 })
      .expect(200);
    expect(success.text).toBe('true'); // Preserve Nest's existing primitive response serialization.
    expect(update).toHaveBeenCalledTimes(1);
    const entry = [...journalFixture.entries.values()][0];
    expect(entry.kind).toBe('ANIMAL_UPDATE');
    const response = await request(app.getHttpServer())
      .get(`/animals/${own.id.value}`)
      .expect(200);
    expect(response.body).not.toHaveProperty('operationId');
    expect(response.body).not.toHaveProperty('journal');
    expect(journalFixture.journal.create.mock.calls).toHaveLength(1);
  });

  it('cannot create an animal for a different account', async () => {
    const data = foreign.toPrimitives();
    // Use only the existing creation contract.
    await request(app.getHttpServer())
      .post('/animals')
      .send({
        id: data.id,
        ownerId: otherOwner,
        name: data.name,
        species: data.species,
        breed: data.breed,
        sex: data.sex,
        reproductiveStatus: data.reproductiveStatus,
        hasChip: false,
        isAssociationMember: false,
        temperament: [],
        diagnosis: [],
      })
      .expect(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('denies both stages of foreign profile-picture upload before touching storage', async () => {
    await request(app.getHttpServer())
      .get(
        `/animals/${foreign.id.value}/profile-picture/upload-url?mimeType=image/jpeg&fileSize=100`,
      )
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/animals/${foreign.id.value}/profile-picture`)
      .send({ finalUrl: 'https://example.com/a.jpg' })
      .expect(403);
    expect(uploadPicture).not.toHaveBeenCalled();
    expect(confirmPicture).not.toHaveBeenCalled();
  });

  it.each(['get', 'put', 'delete'] as const)(
    'denies %s on a diary entry through a different owned animal',
    async (method) => {
      await request(app.getHttpServer())
        [method](`/animals/${own.id.value}/diary/${entry.id.value}`)
        .send({ title: 'Changed' })
        .expect(404);
    },
  );

  it('allows the correct diary route and rejects foreign diary and attachment operations', async () => {
    await request(app.getHttpServer())
      .get(`/animals/${secondOwn.id.value}/diary/${entry.id.value}`)
      .expect(200);
    const base = `/animals/${foreign.id.value}/diary`;
    await request(app.getHttpServer()).get(base).expect(403);
    await request(app.getHttpServer())
      .post(base)
      .send({ title: 'Test' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`${base}/${entry.id.value}/attachments/upload-url`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/${entry.id.value}/attachments`)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${base}/${entry.id.value}/attachments/file-id`)
      .expect(403);
    expect(attachments.generateUploadUrl).not.toHaveBeenCalled();
    expect(attachments.confirmAttachment).not.toHaveBeenCalled();
    expect(attachments.deleteAttachment).not.toHaveBeenCalled();
  });

  it('keeps reads available but returns 409 for writes while transfer processing holds the animal lock', async () => {
    findOwnershipControl.mockResolvedValue({
      animalId: own.id.value,
      ownerId,
      ownershipVersion: 1,
      transferLock: {
        transferId: '123e4567-e89b-42d3-a456-426614174099',
        lockedAt: '2026-10-25T12:00:00.000Z',
      },
    });

    await request(app.getHttpServer())
      .get(`/animals/${own.id.value}`)
      .expect(200);
    await request(app.getHttpServer())
      .put(`/animals/${own.id.value}`)
      .send({ weight: 5 })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/animals/${own.id.value}/diary`)
      .send({ title: 'Blocked' })
      .expect(409);
    await request(app.getHttpServer())
      .get(
        `/animals/${own.id.value}/profile-picture/upload-url?mimeType=image/jpeg&fileSize=100`,
      )
      .expect(409);

    expect(update).not.toHaveBeenCalled();
    expect(uploadPicture).not.toHaveBeenCalled();
  });

  it('links profile confirmation identity internally while preserving the success body', async () => {
    const finalUrl = 'https://example.com/profile.jpeg';
    await request(app.getHttpServer())
      .patch(`/animals/${own.id.value}/profile-picture`)
      .send({ finalUrl })
      .expect(200, { success: true, profilePictureUrl: finalUrl });
    const context = confirmPicture.mock.calls[0][2];
    const created = journalFixture.journal.create.mock.calls[0][0];
    expect(created).toMatchObject({
      callback: 'NOT_STARTED',
      mediaPromotionProtocol: 'MEDIA_PROMOTION_ROWS_V1',
    });
    expect(context).toEqual({
      operationId: created.id,
      instanceId: created.instanceId,
      animalId: own.id.value,
      ownerId,
      ownershipVersion: 1,
      kind: 'PROFILE_CONFIRM',
    });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('links diary confirmation identity internally and rejects client-supplied context', async () => {
    const dto = {
      attachmentId: '123e4567-e89b-42d3-a456-426614174050',
      finalUrl: 'https://example.com/attachment.jpg',
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      size: 32,
    };
    const url = `/animals/${secondOwn.id.value}/diary/${entry.id.value}/attachments`;
    await request(app.getHttpServer())
      .post(url)
      .send({ ...dto, context: {} })
      .expect(400);
    expect(attachments.confirmAttachment).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(url)
      .send(dto)
      .expect(201, JSON.parse(JSON.stringify(entry.toPrimitives())) as object);
    const context = attachments.confirmAttachment.mock.calls[0][7];
    const created = journalFixture.journal.create.mock.calls[0][0];
    expect(created.mediaPromotionProtocol).toBe('MEDIA_PROMOTION_ROWS_V1');
    expect(context).toMatchObject({
      operationId: created.id,
      instanceId: created.instanceId,
      animalId: secondOwn.id.value,
      ownerId,
      kind: 'ATTACHMENT_CONFIRM',
    });
  });

  it('documents separate staging/final URLs, confirmation availability and non-transfer upload conflicts', () => {
    const api = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const issue = api.paths['/animals/{id}/profile-picture/upload-url'].get!;
    const confirm = api.paths['/animals/{id}/profile-picture'].patch!;
    const diaryIssue =
      api.paths['/animals/{animalId}/diary/{entryId}/attachments/upload-url']
        .get!;
    const diaryConfirm =
      api.paths['/animals/{animalId}/diary/{entryId}/attachments'].post!;
    expect(issue.description).toContain(
      'finalUrl is available only after backend confirmation',
    );
    expect(diaryIssue.description).toContain('different keys');
    expect(confirm.responses).toHaveProperty('502');
    expect(diaryConfirm.responses).toHaveProperty('502');
    expect(JSON.stringify(confirm.responses['409'])).toContain(
      'not necessarily transfer',
    );
  });

  it('refuses a write when reservation wins after the permission check', async () => {
    beginWrite.mockResolvedValue(false);
    await request(app.getHttpServer())
      .put(`/animals/${own.id.value}`)
      .send({ weight: 5 })
      .expect(409);
    expect(update).not.toHaveBeenCalled();
    expect(endWrite).not.toHaveBeenCalled();
  });

  it('preserves upload responses and records their window before releasing the write', async () => {
    const response = {
      uploadUrl: 'https://example.com/put',
      finalUrl: 'https://example.com/file',
    };
    uploadPicture.mockResolvedValue(response);
    await request(app.getHttpServer())
      .get(
        `/animals/${own.id.value}/profile-picture/upload-url?mimeType=image/jpeg&fileSize=100`,
      )
      .expect(200, response);
    expect(recordUploadWindow).toHaveBeenCalledWith(
      own.id.value,
      expect.any(String),
      expect.any(String),
    );
    expect(recordUploadWindow.mock.invocationCallOrder[0]).toBeLessThan(
      endWrite.mock.invocationCallOrder[0],
    );
    attachments.generateUploadUrl.mockResolvedValue({
      ...response,
      attachmentId: 'file',
    });
    await request(app.getHttpServer())
      .get(
        `/animals/${secondOwn.id.value}/diary/${entry.id.value}/attachments/upload-url?mimeType=image/jpeg&fileSize=100`,
      )
      .expect(200, { ...response, attachmentId: 'file' });
    expect(recordUploadWindow).toHaveBeenCalledTimes(2);
  });
});
