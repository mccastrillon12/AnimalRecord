import {
  assertReservedEpoch,
  nextReservationEpoch,
  reservationEpochMatch,
} from '../../../src/context/animal-transfer/domain/reservation-epoch';
import { MongoAnimalOwnershipRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import { AnimalOwnershipControlSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { OwnershipArchiveMetadataRevalidationSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-metadata-revalidation.schema';
import { LegacyMediaMigrationSchema } from '../../../src/context/animal-media/infrastructure/mongo-legacy-media-migration-repository';
import { metadataStore } from '../fixtures/metadata-revalidation-store.fixture';
import {
  historyClone as clone,
  historyUuid,
} from '../fixtures/ownership-archive-history.fixture';

const runId = historyUuid(900);
function setup() {
  const s = metadataStore();
  const ownership = new MongoAnimalOwnershipRepository(
    {} as never,
    s.controls as never,
    {} as never,
    {} as never,
  );
  const { archive, control } = s.fixture;
  const lock = {
    animalId: archive.animalId,
    ownerId: archive.ownerId,
    expectedOwnershipVersion: archive.ownershipVersion,
    transferId: archive.transferId,
    lockedAt: control.transferLock.lockedAt,
  };
  return { ...s, ownership, lock };
}
async function observed() {
  const s = setup();
  await s.repository.start(runId, s.fixture.archive.id);
  while (s.state.db.runs[0].phase !== 'METADATA_OBSERVED')
    await s.repository.nextPage(runId, 100);
  await s.repository.startS3(runId);
  const page = await s.repository.s3Page(runId, 20);
  const receipts = page.items.map((item) => ({
    fileId: item.fileId,
    revision: clone(item.revision),
    sha256: item.intent.sha256,
  }));
  return { ...s, page, receipts };
}

describe('Reservation epochs (optimistic model double, not Mongo integration)', () => {
  it('distinguishes a missing legacy field from persisted zero and never resets it', () => {
    expect(reservationEpochMatch(undefined)).toEqual({ $exists: false });
    expect(reservationEpochMatch(0)).toBe(0);
    expect(nextReservationEpoch(undefined)).toBe(1);
    expect(nextReservationEpoch(1)).toBe(2);
    expect(() => assertReservedEpoch(undefined)).toThrow();
    expect(() => assertReservedEpoch(0)).toThrow();
    expect(assertReservedEpoch(1)).toBe(1);
  });
  it.each([null, -1, 1.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed epoch %s without a control mutation',
    async (value) => {
      expect(() => nextReservationEpoch(value as number)).toThrow();
      const s = setup();
      const before = clone(s.state.db);
      await expect(
        s.ownership.acquireTransferLock({
          ...s.lock,
          expectedReservationEpoch: value as number,
        }),
      ).rejects.toThrow();
      await expect(
        s.ownership.releaseTransferLock(
          s.lock.animalId,
          s.lock.transferId,
          value as number,
        ),
      ).rejects.toThrow();
      expect(s.state.db).toEqual(before);
    },
  );
  it('fails closed on exhaustion without overflowing or unlocking', async () => {
    const s = setup();
    s.state.db.controls[0].reservationEpoch = Number.MAX_SAFE_INTEGER;
    const before = clone(s.state.db);
    await expect(
      s.ownership.releaseTransferLock(
        s.lock.animalId,
        s.lock.transferId,
        Number.MAX_SAFE_INTEGER,
      ),
    ).rejects.toThrow('exhausted');
    expect(s.state.db).toEqual(before);
  });
  it('advances on both transitions and denies an old release after exact-ID/time reacquisition', async () => {
    const s = setup();
    const control = s.state.db.controls[0];
    delete control.transferLock;
    delete control.reservationEpoch;
    await expect(s.ownership.acquireTransferLock(s.lock)).resolves.toBe(true);
    expect(control.reservationEpoch).toBe(1);
    expect(
      (await s.ownership.findControl(s.lock.animalId))?.reservationEpoch,
    ).toBe(1);
    await expect(
      s.ownership.releaseTransferLock(s.lock.animalId, s.lock.transferId, 1),
    ).resolves.toBe(true);
    expect(control.reservationEpoch).toBe(2);
    await expect(
      s.ownership.acquireTransferLock({
        ...s.lock,
        expectedReservationEpoch: 2,
      }),
    ).resolves.toBe(true);
    expect(control.reservationEpoch).toBe(3);
    expect(control.transferLock).toEqual(s.fixture.control.transferLock);
    await expect(
      s.ownership.releaseTransferLock(s.lock.animalId, s.lock.transferId, 1),
    ).resolves.toBe(false);
    await expect(
      s.ownership.releaseTransferLock(s.lock.animalId, s.lock.transferId),
    ).resolves.toBe(false);
    expect(control.reservationEpoch).toBe(3);
    expect(control.transferLock).toBeDefined();
  });
  it('a legacy release only matches an absent epoch and fences a subsequent legacy call', async () => {
    const s = setup();
    delete s.state.db.controls[0].reservationEpoch;
    await expect(
      s.ownership.releaseTransferLock(s.lock.animalId, s.lock.transferId),
    ).resolves.toBe(true);
    expect(s.state.db.controls[0].reservationEpoch).toBe(1);
    await expect(s.ownership.acquireTransferLock(s.lock)).resolves.toBe(false);
    await expect(
      s.ownership.acquireTransferLock({
        ...s.lock,
        expectedReservationEpoch: 1,
      }),
    ).resolves.toBe(true);
    await expect(
      s.ownership.releaseTransferLock(s.lock.animalId, s.lock.transferId),
    ).resolves.toBe(false);
  });
  it('two acquisitions based on one observation cannot both win or adopt a committed retry', async () => {
    const s = setup();
    delete s.state.db.controls[0].transferLock;
    const request = { ...s.lock, expectedReservationEpoch: 1 };
    const results = await Promise.all([
      s.ownership.acquireTransferLock(request),
      s.ownership.acquireTransferLock(request),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(s.state.db.controls[0].reservationEpoch).toBe(2);
    await expect(s.ownership.acquireTransferLock(request)).resolves.toBe(false);
  });
  it.each(['writer', 'upload', 'reservation'])(
    'does not advance an epoch when %s prevents acquisition',
    async (problem) => {
      const s = setup();
      const control = s.state.db.controls[0];
      delete control.transferLock;
      if (problem === 'writer')
        control.activeWrites = [{ token: 'other', startedAt: 'before' }];
      if (problem === 'upload') control.uploadsValidUntil = '2999-01-01';
      if (problem === 'reservation')
        control.transferLock = { ...s.fixture.control.transferLock };
      const before = clone(s.state.db);
      await expect(
        s.ownership.acquireTransferLock({
          ...s.lock,
          expectedReservationEpoch: 1,
        }),
      ).resolves.toBe(false);
      expect(s.state.db).toEqual(before);
    },
  );
  it.each([false, true])(
    'invalidates Mongo and S3 evidence after ABA, terminal=%s',
    async (terminal) => {
      const s = await observed();
      if (terminal) await s.repository.confirmS3(s.page, s.receipts);
      const before = clone(s.state.db);
      await s.ownership.releaseTransferLock(
        s.lock.animalId,
        s.lock.transferId,
        1,
      );
      await s.ownership.acquireTransferLock({
        ...s.lock,
        expectedReservationEpoch: 2,
      });
      expect(s.state.db.controls[0].transferLock).toEqual(
        before.controls[0].transferLock,
      );
      expect(s.state.db.controls[0].archiveMaterializationRevision).toBe(
        before.controls[0].archiveMaterializationRevision,
      );
      await expect(s.repository.nextPage(runId, 20)).rejects.toThrow();
      await expect(
        s.repository.start(runId, s.fixture.archive.id),
      ).rejects.toThrow();
      await expect(s.repository.s3Page(runId, 20)).rejects.toThrow();
      await expect(s.repository.startS3(runId)).rejects.toThrow();
      await expect(
        s.repository.confirmS3(s.page, s.receipts),
      ).rejects.toThrow();
      expect(s.state.db.runs).toEqual(before.runs);
      await expect(
        s.repository.start(historyUuid(901), s.fixture.archive.id),
      ).rejects.toThrow();
      expect(s.state.db.runs).toEqual(before.runs); // A new run cannot adopt an archive from another epoch.
    },
  );
  it('a checkpoint snapshot losing to reservation release cannot commit on retry', async () => {
    const s = await observed();
    let release: Promise<boolean> | undefined;
    s.state.beforeSave = () => {
      s.state.beforeSave = undefined;
      release = s.ownership.releaseTransferLock(
        s.lock.animalId,
        s.lock.transferId,
        1,
      );
    };
    await expect(s.repository.confirmS3(s.page, s.receipts)).rejects.toThrow();
    await expect(release).resolves.toBe(true);
    expect(s.state.db.runs[0].s3Observation!.count).toBe(0);
    expect(s.state.db.controls[0].reservationEpoch).toBe(2);
  });
  it('a release after checkpoint leaves recorded history but makes terminal replay stale', async () => {
    const s = await observed();
    await s.repository.confirmS3(s.page, s.receipts);
    await s.ownership.releaseTransferLock(
      s.lock.animalId,
      s.lock.transferId,
      1,
    );
    expect(s.state.db.runs[0].s3Observation!.phase).toBe('S3_OBSERVED');
    await expect(s.repository.s3Page(runId, 20)).rejects.toThrow();
  });
  it('does not retrofit old runs or old locks with inferred epoch identity', async () => {
    const s = await observed();
    delete s.state.db.runs[0].reservationEpoch;
    const before = clone(s.state.db);
    await expect(s.repository.startS3(runId)).rejects.toThrow('stale');
    expect(s.state.db).toEqual(before);
    delete s.state.db.controls[0].reservationEpoch;
    await expect(
      s.repository.start(historyUuid(902), s.fixture.archive.id),
    ).rejects.toThrow();
  });
  it('declares optional fields without default/backfill or TTL', () => {
    for (const field of [
      AnimalOwnershipControlSchema.path('reservationEpoch'),
      OwnershipArchiveMetadataRevalidationSchema.path('reservationEpoch'),
      LegacyMediaMigrationSchema.path('reservationEpoch'),
    ]) {
      expect(field.options.default).toBeUndefined();
      expect(field.options.required).not.toBe(true);
    }
    for (const schema of [
      AnimalOwnershipControlSchema,
      OwnershipArchiveMetadataRevalidationSchema,
      LegacyMediaMigrationSchema,
    ]) {
      expect(
        schema
          .indexes()
          .every(([, options]) => options.expireAfterSeconds === undefined),
      ).toBe(true);
    }
  });
});
