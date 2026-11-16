import {
  AnimalMediaUploadSchema,
  MongoAnimalMediaUploadRepository,
} from '../../../src/context/animal-media/infrastructure/mongo-animal-media-upload-repository';
import { PromotionStoredCommand } from '../../../src/context/animal-media/domain/media-promotion-persistence';
import {
  promotionStoreFixture,
  PromotionTestRow,
} from '../fixtures/media-promotion-store.fixture';

type Stage = 'declaration' | 'intention' | 'authorization';
async function setup(stage: Stage = 'authorization') {
  const f = promotionStoreFixture();
  await f.repository.open(f.selection);
  if (stage !== 'declaration')
    await f.repository.apply(f.selection, 0, f.declare);
  if (stage === 'authorization')
    await f.repository.apply(f.selection, 1, f.intention);
  const command =
    stage === 'declaration'
      ? f.declare
      : stage === 'intention'
        ? f.intention
        : f.authorize;
  const revision = stage === 'declaration' ? 0 : stage === 'intention' ? 1 : 2;
  return {
    ...f,
    command,
    revision,
    uploads: new MongoAnimalMediaUploadRepository(f.models.uploads as never),
    run: () => f.repository.apply(f.selection, revision, command),
  };
}

describe('Promotion ticket CAS with simulated snapshots and real repository methods', () => {
  it('keeps the schema field optional, without default, TTL or a new index', () => {
    expect(
      AnimalMediaUploadSchema.path('mediaPromotionRevision').options.default,
    ).toBeUndefined();
    expect(
      AnimalMediaUploadSchema.indexes().some(
        ([keys]) => 'mediaPromotionRevision' in keys,
      ),
    ).toBe(false);
    expect(
      AnimalMediaUploadSchema.indexes().some(
        ([, options]) => options.expireAfterSeconds !== undefined,
      ),
    ).toBe(false);
  });

  it('fences declaration, intention and authorization in their own transaction without changing the definition', async () => {
    const f = await setup('declaration');
    expect(f.state().uploads[0]).not.toHaveProperty('mediaPromotionRevision');
    await f.run();
    const declared = f.state().records.find((r) => r.id === f.effectId)!.data;
    await f.repository.apply(f.selection, 1, f.intention);
    await f.repository.apply(f.selection, 2, f.authorize);
    expect(f.state().uploads[0]).toMatchObject({
      mediaPromotionRevision: 3,
      pinned: f.upload.pinned,
    });
    expect(
      f.state().records.find((r) => r.id === f.effectId)!.data,
    ).toMatchObject({
      definition: (declared as PromotionTestRow).definition,
      definitionHash: (declared as PromotionTestRow).definitionHash,
    });
    const writes = f.log.filter(
      (item) => item.kind === 'uploads' && item.method === 'updateOne',
    );
    expect(writes).toHaveLength(3);
    expect(writes.every((item) => item.session)).toBe(true);
    expect(writes[0].filter).toMatchObject({
      sealed: { $exists: false },
      legacy: { $exists: false },
      mediaPromotionRevision: { $exists: false },
      'pinned.versionId': { $exists: false },
    });
  });

  it.each(['declaration', 'intention', 'authorization'] as const)(
    'rolls back %s, all rows and all fences on a zero-match ticket CAS',
    async (stage) => {
      const f = await setup(stage),
        before = f.state();
      f.fail('uploads', 'updateOne', true);
      await expect(f.run()).rejects.toThrow('upload fence changed');
      expect(f.state()).toEqual(before);
    },
  );

  const mutations: Array<[string, (row: PromotionTestRow) => void]> = [
    [
      'owner',
      (r) => {
        r.ownerId = 'other';
      },
    ],
    [
      'animal',
      (r) => {
        r.animalId = 'other';
      },
    ],
    [
      'destination',
      (r) => {
        r.finalKey = String(r.finalKey).replace('profile_123', 'profile_124');
      },
    ],
    [
      'source key',
      (r) => {
        r.stagingKey = 'other';
      },
    ],
    [
      'mime',
      (r) => {
        r.mimeType = 'audio/mp4';
      },
    ],
    [
      'size',
      (r) => {
        r.size = 64;
      },
    ],
    [
      'etag',
      (r) => {
        (r.pinned as PromotionTestRow).etag = 'other';
      },
    ],
    [
      'version',
      (r) => {
        (r.pinned as PromotionTestRow).versionId = 'other';
      },
    ],
    [
      'digest',
      (r) => {
        (r.pinned as PromotionTestRow).sha256 = 'b'.repeat(64);
      },
    ],
    [
      'pin removed',
      (r) => {
        delete r.pinned;
      },
    ],
    [
      'seal',
      (r) => {
        r.sealed = { etag: 'final', size: 32 };
      },
    ],
    [
      'legacy',
      (r) => {
        r.legacy = { migrationId: 'other' };
      },
    ],
  ];
  describe.each(['intention', 'authorization'] as const)(
    '%s after ticket changed',
    (stage) => {
      it.each(mutations)(
        'rejects %s without refixing definition or partial writes',
        async (_field, change) => {
          const f = await setup(stage);
          f.change('uploads', (rows) => change(rows[0]));
          const before = f.state();
          await expect(f.run()).rejects.toThrow();
          expect(f.state()).toEqual(before);
        },
      );
    },
  );

  it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER, '1', true])(
    'rejects corrupt/exhausted ticket counter %j with rollback',
    async (value) => {
      const f = await setup();
      f.change('uploads', (rows) => {
        rows[0].mediaPromotionRevision = value;
      });
      const before = f.state();
      await expect(f.run()).rejects.toThrow();
      expect(f.state()).toEqual(before);
    },
  );

  it('treats absent and zero ticket counters as different CAS states', async () => {
    const f = await setup('declaration');
    f.change('uploads', (rows) => {
      rows[0].mediaPromotionRevision = 0;
    });
    await f.run();
    expect(
      f.log.filter(
        (item) => item.kind === 'uploads' && item.method === 'updateOne',
      )[0].filter,
    ).toHaveProperty('mediaPromotionRevision', 0);
    expect(f.state().uploads[0].mediaPromotionRevision).toBe(1);
  });

  it('a seal winning against a stale authorizer invalidates the entire tentative authorization', async () => {
    const f = await setup(),
      pause = f.pause('uploads');
    const before = f.state();
    const pending = f.run(),
      rejected = expect(pending).rejects.toThrow();
    await pause.entered;
    try {
      await f.uploads.seal(f.upload.finalKey, f.upload.pinned!.sha256, {
        etag: 'final',
        size: 32,
      });
    } finally {
      pause.resume();
    }
    await rejected;
    const after = f.state();
    expect(after.records).toEqual(before.records);
    expect(after.journals).toEqual(before.journals);
    expect(after.controls).toEqual(before.controls);
    expect(after.uploads[0].mediaPromotionRevision).toBe(
      before.uploads[0].mediaPromotionRevision,
    );
    expect(after.uploads[0].sealed).toEqual({ etag: 'final', size: 32 });
    expect(f.retries()).toBeGreaterThan(0);
  });

  it('a seal after authorization preserves prior uncertainty and permits late evidence only', async () => {
    const f = await setup();
    await f.run();
    const before = f.state().uploads[0];
    await f.uploads.seal(f.upload.finalKey, f.upload.pinned!.sha256, {
      etag: 'final',
      size: 32,
    });
    const retry: PromotionStoredCommand = {
      ...f.intention,
      attemptId: f.id(44),
      origin: 'SDK_RETRY',
      previousAttemptId: f.attemptId,
    };
    await expect(f.repository.apply(f.selection, 3, retry)).rejects.toThrow();
    await f.repository.revoke(f.selection, 3, f.audit);
    await f.repository.apply(f.selection, 4, {
      type: 'RECORD_RESPONSE',
      effectId: f.effectId,
      attemptId: f.attemptId,
      responseId: f.id(45),
      outcome: 'UNKNOWN',
      evidenceRef: 'test:late-after-seal',
    });
    expect(
      (await f.repository.read(f.selection, f.attemptId)).record,
    ).toHaveProperty('authorizationId', f.id(11));
    expect(f.state().uploads[0].mediaPromotionRevision).toBe(
      before.mediaPromotionRevision,
    );
  });

  it('a concurrent pin loser uses the existing immutable pin, not its losing candidate', async () => {
    const f = await setup();
    const losing = {
      ...f.upload.pinned!,
      etag: 'losing',
      sha256: 'b'.repeat(64),
    };
    const ticket = await f.uploads.pin(f.upload.finalKey, losing);
    expect(ticket.pinned).toEqual(f.upload.pinned);
    await f.run();
    expect(f.state().uploads[0].pinned).toEqual(f.upload.pinned);
  });
});
