import { MongoOwnershipArchiveRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-repository';
import { MongoOwnershipArchiveHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { MongoOwnershipArchiveReferencePlan } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-reference-plan';
import { MongoOwnershipArchiveMaterialization } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-materialization';
import { MongoOwnershipArchiveMediaRegistration } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-media-registration';
import { MongoAnimalOwnershipRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import { OwnershipArchivePreparer } from '../../../src/context/animal-transfer/application/ownership-archive-preparer';
import {
  ArchiveCaptureProgress,
  ArchiveHistoryProgress,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildArchiveReservation } from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import { OwnershipArchiveSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { metadataStore } from '../fixtures/metadata-revalidation-store.fixture';
import {
  historyClone as clone,
  historyUuid,
} from '../fixtures/ownership-archive-history.fixture';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';

function setup() {
  const s = metadataStore();
  const raw = new MongoOwnershipArchiveRepository(
    s.archives as never,
    s.entries as never,
    s.files as never,
    s.periods as never,
    s.controls as never,
  );
  const history = new MongoOwnershipArchiveHistory(
    s.archives as never,
    s.entries as never,
    s.files as never,
    s.periods as never,
    s.controls as never,
  );
  const plans = new MongoOwnershipArchiveReferencePlan(
    s.archives as never,
    s.entries as never,
    s.files as never,
    s.controls as never,
    s.periods as never,
  );
  const materialization = new MongoOwnershipArchiveMaterialization(
    s.archives as never,
    s.entries as never,
    s.files as never,
    s.controls as never,
    s.periods as never,
  );
  const registration = new MongoOwnershipArchiveMediaRegistration(
    s.archives as never,
    s.entries as never,
    s.files as never,
    s.registrations as never,
    s.controls as never,
    s.periods as never,
  );
  const ownership = new MongoAnimalOwnershipRepository(
    {} as never,
    s.controls as never,
    {} as never,
    {} as never,
  );
  return {
    ...s,
    raw,
    history,
    plans,
    materialization,
    registration,
    ownership,
  };
}
const capture: ArchiveCaptureProgress = {
  revision: 1,
  phase: 'COMPLETE',
  entryCount: 1,
};
const historyProgress: ArchiveHistoryProgress = {
  sourceArchiveId: historyUuid(99),
  sourceDefinitionHash: 'a'.repeat(64),
  expectedEntryCount: 1,
  expectedFileCount: 0,
  phase: 'IMPORTING',
  revision: 0,
  entryCount: 0,
};
const operations = [
  'create',
  'append',
  'capture checkpoint',
  'seal',
  'copy claim',
  'copy complete',
  'copy release',
  'ready',
  'history start',
  'history checkpoint',
  'plan start',
  'plan checkpoint',
  'materialization start',
  'materialization claim',
  'materialization complete',
  'materialization release',
  'materialized',
  'register',
  'metadata start',
] as const;
type Operation = (typeof operations)[number];
async function operate(s: ReturnType<typeof setup>, operation: Operation) {
  const archive = s.state.db.archives[0];
  const file = s.state.db.files[0];
  const id = archive.id;
  if (operation === 'create')
    return s.raw.create({ ...archive, state: 'COLLECTING' });
  if (operation === 'append') return s.raw.append(id, s.fixture.entries[0], []);
  if (operation === 'capture checkpoint')
    return s.raw.checkpointCapture(id, 0, capture);
  if (operation === 'seal') return s.raw.seal(id, s.fixture.entries.length);
  if (operation === 'copy claim')
    return s.raw.claimFile(id, 'token', '2026-10-26', '2026-10-27');
  if (operation === 'copy complete')
    return s.raw.completeFile(file.id, 'token', file.verified!);
  if (operation === 'copy release') return s.raw.releaseFile(file.id, 'token');
  if (operation === 'ready') return s.raw.markReadyIfComplete(id);
  if (operation === 'history start') {
    archive.state = 'COLLECTING';
    return s.history.start(id, historyProgress.sourceArchiveId);
  }
  if (operation === 'history checkpoint')
    return s.history.checkpoint(id, historyProgress, {
      ...historyProgress,
      revision: 1,
    });
  if (operation === 'plan start') return s.plans.start(id);
  if (operation === 'plan checkpoint') {
    const expected = { ...archive.referencePlan!, phase: 'PLANNING' as const };
    archive.referencePlan = expected;
    return s.plans.savePage(id, expected, [], {
      ...expected,
      revision: expected.revision + 1,
      phase: 'PLANNED',
    });
  }
  if (operation === 'materialization start')
    return s.materialization.start(id, archive.materialization!.protocol);
  if (operation === 'materialization claim')
    return s.materialization.claim(
      id,
      historyUuid(700),
      '2026-10-26',
      '2026-10-27',
    );
  if (operation === 'materialization complete')
    return s.materialization.complete(
      file.materialization!.intent,
      'token',
      file.materialization!.verified!,
    );
  if (operation === 'materialization release')
    return s.materialization.release(file.materialization!.intent, 'token');
  if (operation === 'materialized') return s.materialization.markComplete(id);
  if (operation === 'register') return s.registration.registerFile(id, file.id);
  return s.repository.start(historyUuid(701), id);
}

describe('All prepared-archive mutators keep their original reservation (optimistic double)', () => {
  it.each(operations)(
    '%s rejects a readquired reservation with the same transfer ID/time',
    async (operation) => {
      const s = setup();
      const archive = s.state.db.archives[0];
      await s.ownership.releaseTransferLock(
        archive.animalId,
        archive.transferId,
        1,
      );
      await s.ownership.acquireTransferLock({
        animalId: archive.animalId,
        ownerId: archive.ownerId,
        expectedOwnershipVersion: archive.ownershipVersion,
        transferId: archive.transferId,
        lockedAt: s.fixture.control.transferLock.lockedAt,
        expectedReservationEpoch: 2,
      });
      // Arrange only the protocol phase required to reach the fence.
      if (operation === 'history start') archive.state = 'COLLECTING';
      if (operation === 'plan checkpoint')
        archive.referencePlan!.phase = 'PLANNING';
      const before = clone(s.state.db);
      await expect(operate(s, operation)).rejects.toThrow();
      expect(s.state.db).toEqual(before);
    },
  );
  it.each(operations)(
    '%s does not retrofit a previous unbound archive',
    async (operation) => {
      const s = setup();
      delete s.state.db.archives[0].reservation;
      if (operation === 'history start')
        s.state.db.archives[0].state = 'COLLECTING';
      if (operation === 'plan checkpoint')
        s.state.db.archives[0].referencePlan!.phase = 'PLANNING';
      const before = clone(s.state.db);
      await expect(operate(s, operation)).rejects.toThrow();
      expect(s.state.db).toEqual(before);
    },
  );
  it('creates, captures, seals and completes a file-free new archive without S3 or changing original hashes', async () => {
    const s = setup();
    s.state.db.archives = [];
    s.state.db.entries = [];
    s.state.db.files = [];
    const storage = {
      keyFromUrl: jest.fn(),
      assertTransferSafe: jest.fn(),
      inspect: jest.fn(),
      copyAndVerify: jest.fn(),
    };
    const preparer = new OwnershipArchivePreparer(s.ownership, s.raw, storage);
    const archive = await preparer.begin(s.fixture.archive, true, 1);
    expect(archive.definitionHash).toBe(s.fixture.archive.definitionHash);
    expect(archive.reservation).toEqual(buildArchiveReservation(archive, 1));
    await preparer.append(archive.id, {
      kind: 'ANIMAL',
      data: { ...archiveAnimal, ownerId: archive.ownerId },
    });
    await s.raw.checkpointCapture(archive.id, 0, capture);
    await preparer.seal(archive.id, 1);
    await expect(preparer.copyBatch(archive.id)).resolves.toEqual({
      processed: 0,
      ready: true,
    });
    expect(storage.copyAndVerify).not.toHaveBeenCalled();
    expect(s.state.db.controls[0].reservationEpoch).toBe(1);
    expect(s.state.db.controls[0].archivePreparationRevision).toBeGreaterThan(
      0,
    );
  });
  it('creation and its control fence roll back together in the double', async () => {
    const s = setup();
    s.state.db.archives = [];
    const before = clone(s.state.db);
    s.archives.create.mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      s.raw.create({ ...s.fixture.archive, state: 'COLLECTING' }),
    ).rejects.toThrow('insert failed');
    expect(s.state.db).toEqual(before);
  });
  it.each(['legacy', 'different epoch'])(
    'creation cannot retrofit an existing %s header',
    async (problem) => {
      const s = setup();
      const stored = s.state.db.archives[0];
      if (problem === 'legacy') delete stored.reservation;
      if (problem === 'different epoch')
        s.state.db.controls[0].reservationEpoch = 3;
      const before = clone(s.state.db);
      await expect(
        s.raw.create({
          ...stored,
          reservation: buildArchiveReservation(
            stored,
            problem === 'legacy' ? 1 : 3,
          ),
        }),
      ).rejects.toThrow();
      expect(s.state.db).toEqual(before);
    },
  );
  it('an uncertain copy claim never starts S3 or blindly releases its durable token', async () => {
    const s = setup();
    s.state.db.archives[0].state = 'COPYING';
    s.state.db.files[0].state = 'PENDING';
    const storage = {
      keyFromUrl: jest.fn(),
      assertTransferSafe: jest.fn(),
      inspect: jest.fn(),
      copyAndVerify: jest.fn(),
    };
    const preparer = new OwnershipArchivePreparer(s.ownership, s.raw, storage);
    s.state.loseReply = true;
    await expect(preparer.copyBatch(s.fixture.archive.id, 1)).rejects.toThrow(
      'commit reply lost',
    );
    expect(storage.copyAndVerify).not.toHaveBeenCalled();
    expect(s.state.db.files[0].state).toBe('COPYING');
    expect(s.state.db.files[0].leaseToken).toBeDefined();
  });
  it('late S3 results cannot confirm or release the old work lease after exact ABA', async () => {
    const s = setup();
    const archive = s.state.db.archives[0];
    archive.state = 'COPYING';
    s.state.db.files[0].state = 'PENDING';
    const expected = clone(s.state.db.files[0].verified!);
    const storage = {
      keyFromUrl: jest.fn(),
      assertTransferSafe: jest.fn().mockResolvedValue(undefined),
      inspect: jest.fn(),
      copyAndVerify: jest.fn(async () => {
        await s.ownership.releaseTransferLock(
          archive.animalId,
          archive.transferId,
          1,
        );
        await s.ownership.acquireTransferLock({
          animalId: archive.animalId,
          ownerId: archive.ownerId,
          expectedOwnershipVersion: archive.ownershipVersion,
          transferId: archive.transferId,
          lockedAt: s.fixture.control.transferLock.lockedAt,
          expectedReservationEpoch: 2,
        });
        return expected;
      }),
    };
    const preparer = new OwnershipArchivePreparer(s.ownership, s.raw, storage);
    await expect(preparer.copyBatch(archive.id, 1)).rejects.toThrow(
      'original matching',
    );
    expect(s.state.db.files[0].state).toBe('COPYING');
    expect(s.state.db.files[0].leaseToken).toBeDefined();
    expect(s.state.db.controls[0].reservationEpoch).toBe(3);
    expect(s.state.db.archives[0].reservation!.epoch).toBe(1);
  });
  it('reconciles a lost creation reply only for the same immutable binding', async () => {
    const s = setup();
    s.state.db.archives = [];
    const archive = { ...s.fixture.archive, state: 'COLLECTING' as const };
    s.state.loseReply = true;
    await expect(s.raw.create(archive)).rejects.toThrow('commit reply lost');
    await expect(s.raw.create(archive)).resolves.toEqual(archive);
    expect(s.state.db.archives).toHaveLength(1);
  });
  it.each(['create', 'capture checkpoint'] as const)(
    '%s cannot commit a snapshot that lost to release',
    async (operation) => {
      const s = setup();
      const archive = s.state.db.archives[0];
      archive.state = 'COLLECTING';
      archive.capture = { revision: 0, phase: 'ANIMAL', entryCount: 0 };
      if (operation === 'create') s.state.db.archives = [];
      let release: Promise<boolean> | undefined;
      s.state.beforeArchiveSave = () => {
        s.state.beforeArchiveSave = undefined;
        release = s.ownership.releaseTransferLock(
          archive.animalId,
          archive.transferId,
          1,
        );
      };
      const action =
        operation === 'create'
          ? s.raw.create(archive)
          : s.raw.checkpointCapture(archive.id, 0, capture);
      await expect(action).rejects.toThrow();
      await expect(release).resolves.toBe(true);
      expect(s.state.db.controls[0].reservationEpoch).toBe(2);
      if (operation === 'create') expect(s.state.db.archives).toEqual([]);
      else expect(s.state.db.archives[0].capture!.revision).toBe(0);
    },
  );
  it('does not overflow the preparation fence', async () => {
    const s = setup();
    s.state.db.controls[0].archivePreparationRevision = Number.MAX_SAFE_INTEGER;
    const before = clone(s.state.db);
    await expect(
      s.raw.markReadyIfComplete(s.fixture.archive.id),
    ).rejects.toThrow();
    expect(s.state.db).toEqual(before);
  });
  it('adds no default, backfill, index, TTL or publication flag to existing headers', () => {
    const field = OwnershipArchiveSchema.path('reservation');
    expect(field.options.default).toBeUndefined();
    expect(field.options.required).not.toBe(true);
    expect(
      OwnershipArchiveSchema.indexes().every(
        ([, options]) => options.expireAfterSeconds === undefined,
      ),
    ).toBe(true);
    expect(OwnershipArchiveSchema.path('canCommit')).toBeUndefined();
  });
});
