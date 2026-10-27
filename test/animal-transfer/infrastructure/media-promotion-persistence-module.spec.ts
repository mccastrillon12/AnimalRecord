import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { createConnection } from 'mongoose';
import { MediaPromotionPersistenceModule } from '../../../src/app/animal-media/media-promotion-persistence.module';
import { MediaPromotionPersistence } from '../../../src/context/animal-media/domain/media-promotion-persistence';
import { MongoMediaPromotionPersistence } from '../../../src/context/animal-media/infrastructure/mongo-media-promotion-persistence';
import {
  MEDIA_PROMOTION_RECORD_MODEL,
  MediaPromotionRecordSchema,
} from '../../../src/context/animal-media/infrastructure/media-promotion-record.schema';
import { ANIMAL_MEDIA_UPLOAD_MODEL } from '../../../src/context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import {
  MongoAnimalWriteJournal,
  ANIMAL_WRITE_JOURNAL_MODEL,
  AnimalWriteJournalSchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipControlSchema,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { promotionFixture } from '../fixtures/media-promotion.fixture';
import { AnimalWriteJournal } from '../../../src/context/animal-transfer/domain/animal-write-journal';

const forbiddenCall = () => {
  throw new Error(
    'No connection/model creation or initialization is authorized',
  );
};
@Global()
@Module({
  providers: [
    {
      provide: getConnectionToken(),
      useValue: {
        models: Object.fromEntries(
          [
            MEDIA_PROMOTION_RECORD_MODEL,
            ANIMAL_MEDIA_UPLOAD_MODEL,
            ANIMAL_WRITE_JOURNAL_MODEL,
            AnimalOwnershipControlEntity.name,
          ].map((name) => [name, {}]),
        ),
        model: forbiddenCall,
        createCollection: forbiddenCall,
      },
    },
  ],
  exports: [getConnectionToken()],
})
class PromotionSimulatedConnectionModule {}
@Injectable()
class PromotionConsumer {
  constructor(
    @Inject('MediaPromotionPersistence')
    readonly port: MediaPromotionPersistence,
  ) {}
}
@Module({
  imports: [MediaPromotionPersistenceModule],
  providers: [PromotionConsumer],
})
class PromotionConsumerModule {}

describe('Explicit promotion persistence module/schema, without Mongo connections', () => {
  it('exports an injectable port without calling models or starting a connection', async () => {
    const module = await Test.createTestingModule({
      imports: [PromotionSimulatedConnectionModule, PromotionConsumerModule],
    }).compile();
    expect(module.get(PromotionConsumer).port).toBeInstanceOf(
      MongoMediaPromotionPersistence,
    );
    await module.close();
  });
  it('declares global identity/resource/ordinal indexes without TTL or automatic creation', () => {
    expect(MediaPromotionRecordSchema.get('autoCreate')).toBe(false);
    expect(MediaPromotionRecordSchema.get('autoIndex')).toBe(false);
    const indexes = MediaPromotionRecordSchema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [{ id: 1 }, expect.objectContaining({ unique: true })],
        [{ identityIds: 1 }, expect.objectContaining({ unique: true })],
        [{ operationId: 1, kind: 1, id: 1 }, expect.any(Object)],
        [
          { operationId: 1, uploadId: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { kind: 'EFFECT' },
          }),
        ],
        [
          { operationId: 1, bucket: 1, destinationKey: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { kind: 'EFFECT' },
          }),
        ],
        [
          { effectId: 1, ordinal: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { kind: 'ATTEMPT' },
          }),
        ],
      ]),
    );
    expect(
      indexes.every(([, options]) => options.expireAfterSeconds === undefined),
    ).toBe(true);
  });
  it('preserves optional fields as absent, and schema serialization does not minimize evidence', async () => {
    const connection = createConnection(); // Disconnected: no URI, connect or init.
    try {
      const model = connection.model(
        MEDIA_PROMOTION_RECORD_MODEL,
        MediaPromotionRecordSchema,
      );
      const s = promotionFixture();
      const doc = new model({
        id: s.id(30),
        identityIds: [s.id(30)],
        operationId: s.journal.id,
        protocol: 'MEDIA_PROMOTION_ROWS_V1',
        kind: 'OBSERVATION',
        gateRevision: 1,
        effectId: s.effectId,
        data: { finding: 'ABSENT', evidenceRef: 'read:absent', nested: {} },
      });
      expect(doc.validateSync()).toBeUndefined();
      const serialized = doc.toObject();
      expect(serialized.data).toHaveProperty('nested', {});
      for (const field of [
        'authorizationId',
        'attemptId',
        'ordinal',
        'uploadId',
      ])
        expect(serialized).not.toHaveProperty(field);
      expect(new model({ id: s.id(30) }).toObject()).not.toHaveProperty(
        'identityIds',
      );
      for (const field of [
        AnimalWriteJournalSchema.path('mediaPromotionProtocol'),
        AnimalWriteJournalSchema.path('mediaPromotionRevision'),
        AnimalOwnershipControlSchema.path('mediaPromotionRevision'),
      ])
        expect(field.options.default).toBeUndefined();
      expect(
        AnimalWriteJournalSchema.indexes().some(
          ([keys]) => 'mediaPromotionRevision' in keys,
        ),
      ).toBe(false);
    } finally {
      await connection.close();
    }
  });
  it('accepts opt-in only at new journal creation without granting callback permission', async () => {
    const create = jest.fn().mockResolvedValue([]),
      repository = new MongoAnimalWriteJournal({ create } as never);
    const journal: AnimalWriteJournal = {
      ...promotionFixture().journal,
      callback: 'NOT_STARTED',
      mediaPromotionProtocol: 'MEDIA_PROMOTION_ROWS_V1',
      claims: promotionFixture().journal.claims.map((c) => ({
        animalId: c.animalId,
        state: 'NOT_ATTEMPTED',
        updatedAt: c.updatedAt,
      })),
    };
    delete journal.callbackPermittedAt;
    await repository.create(journal);
    expect(create).toHaveBeenCalledWith([journal], { w: 'majority' });
    expect(journal).not.toHaveProperty('mediaPromotionRevision');
    expect(journal).not.toHaveProperty('callbackPermittedAt');
    for (const changed of [
      { ...journal, mediaPromotionRevision: 0 },
      { ...journal, mediaPromotionProtocol: 'OLD' },
      { ...journal, kind: 'ANIMAL_UPDATE' },
      { ...journal, issuesUploadUrl: true },
      { ...journal, claims: [...journal.claims, ...journal.claims] },
    ])
      await expect(
        repository.create(changed as AnimalWriteJournal),
      ).rejects.toThrow('Invalid initial');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
