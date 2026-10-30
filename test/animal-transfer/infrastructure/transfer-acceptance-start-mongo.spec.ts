import { acceptanceStartStore } from '../fixtures/acceptance-start-store.fixture';
import { acceptanceAt } from '../fixtures/transfer-acceptance-preparation.fixture';
import { archiveMedicalDocument } from '../fixtures/ownership-archive.fixture';
import { AcceptanceSelection } from '../../../src/context/animal-transfer/domain/transfer-acceptance-preparation';
import { TransferAcceptanceStartModule } from '../../../src/app/animal-transfer/transfer-acceptance-start.module';
import { AnimalTransferModule } from '../../../src/app/animal-transfer/animal-transfer.module';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { OwnershipArchiveCapture } from '../../../src/context/animal-transfer/application/ownership-archive-capture';
import { OwnershipArchive } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { assertArchiveReservationControl } from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import { AnimalOwnershipControl } from '../../../src/context/animal-transfer/domain/animal-ownership';

describe('Atomic acceptance start, Mongo driver simulated only', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(acceptanceAt)));
  afterEach(() => jest.useRealTimers());
  it('records a whole partial selection, exact reservations, capture headers and audit in one transaction', async () => {
    const f = acceptanceStartStore(),
      beforeAnimals = structuredClone(f.state.db.animals),
      beforePeriods = structuredClone(f.state.db.periods);
    const receipt = await f.service.start(f.input);
    expect(receipt).toMatchObject({
      requestVersion: 2,
      replayed: false,
      stableCut: 'NOT_ASSESSED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(f.state.db.requests[0]).toMatchObject({
      status: 'PROCESSING',
      version: 2,
      decidedAt: acceptanceAt,
    });
    expect(f.state.db.items.map((i) => i.status)).toEqual([
      'PROCESSING',
      'PROCESSING',
      'REJECTED',
    ]);
    expect(f.state.db.claims.map((c) => c._id)).toEqual([f.id(100), f.id(101)]);
    expect(
      f.state.db.claims.every(
        (c) => c.acceptanceOperationId === f.input.operationId,
      ),
    ).toBe(true);
    expect(f.state.db.archives).toHaveLength(2);
    for (const row of f.state.db.archives) {
      expect(row).toMatchObject({
        state: 'COLLECTING',
        capture: { revision: 0, phase: 'ANIMAL', entryCount: 0 },
      });
      const control = f.state.db.controls.find(
        (c) => c.animalId === row.animalId,
      )!;
      assertArchiveReservationControl(
        row as OwnershipArchive,
        control as AnimalOwnershipControl,
      );
      expect(control).toMatchObject({
        reservationEpoch: 1,
        archivePreparationRevision: 1,
        transferLock: { transferId: f.input.transferId },
      });
    }
    expect(f.state.db.events).toMatchObject([
      { type: 'REQUEST_ACCEPTANCE_STARTED', version: 2 },
    ]);
    expect(
      f.state.db.animals.map(({ transferRequestRevision, ...row }) => {
        void transferRequestRevision;
        return row;
      }),
    ).toEqual(beforeAnimals);
    expect(f.state.db.periods).toEqual(beforePeriods);
    expect(f.calls.every((c) => c.session === f.sessions[0])).toBe(true);
    const acquisition = f.calls.find(
      (c) => c.role === 'controls' && c.method === 'updateOne',
    )!;
    expect(acquisition.filter).toMatchObject({
      transferLock: { $exists: false },
      'activeWrites.0': { $exists: false },
      reservationEpoch: { $exists: false },
    });
    expect(JSON.stringify(acquisition.filter.$expr)).toContain('$$NOW');
    expect(f.sessions[0].withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
        timeoutMS: 15000,
      }),
    );
    expect(JSON.stringify(receipt)).not.toMatch(
      /Brownie|clinical|proof|token|nameHistory/,
    );
  });
  it.each(Array.from({ length: 17 }, (_, n) => n + 1))(
    'rolls back all business/lock/header changes at write %i',
    async (n) => {
      const f = acceptanceStartStore(),
        before = structuredClone(f.state.db);
      f.state.failAtWrite = n;
      await expect(f.service.start(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.state.db).toEqual(before);
      expect(f.sessions[0].endSession).toHaveBeenCalledTimes(1);
    },
  );
  it('accepts the full set without releasing any request claim', async () => {
    const f = acceptanceStartStore();
    f.state.db.requests[0].animalCount = 2;
    f.state.db.items.pop();
    f.state.db.claims.pop();
    const result = await f.service.start(f.input);
    expect(result.binding.rejectedItemIds).toEqual([]);
    expect(f.state.db.items.every((i) => i.status === 'PROCESSING')).toBe(true);
    expect(f.calls.some((c) => c.method === 'deleteMany')).toBe(false);
  });
  it('authorizes the recipient before loading dossier sources', async () => {
    const f = acceptanceStartStore();
    await expect(
      f.service.start({ ...f.input, actorId: f.actorId }),
    ).rejects.toThrow('recipient');
    expect(f.calls.map((c) => c.method)).toEqual(['findById']);
  });
  it.each(['reservation', 'participant', 'animal'] as const)(
    'fails closed on exhausted %s counters',
    async (kind) => {
      const f = acceptanceStartStore();
      if (kind === 'reservation')
        f.state.db.controls[0].reservationEpoch = Number.MAX_SAFE_INTEGER;
      if (kind === 'participant')
        f.state.db.users[0].transferRequestRevision = Number.MAX_SAFE_INTEGER;
      if (kind === 'animal')
        f.state.db.animals[0].transferRequestRevision = Number.MAX_SAFE_INTEGER;
      const before = structuredClone(f.state.db);
      await expect(f.service.start(f.input)).rejects.toThrow();
      expect(f.state.db).toEqual(before);
    },
  );
  it('rolls back every selected reservation if the second dossier has unnormalized medical work', async () => {
    const f = acceptanceStartStore();
    f.state.db.medical.push({
      ...archiveMedicalDocument(),
      animalIds: [f.id(101), f.id(102)],
      ownerId: f.actorId,
    });
    const before = structuredClone(f.state.db);
    await expect(f.service.start(f.input)).rejects.toThrow(
      'independent document',
    );
    expect(f.state.db).toEqual(before);
    expect(
      f.calls.some((c) => c.role === 'requests' && c.method === 'updateOne'),
    ).toBe(false);
  });
  it.each([
    'busy',
    'pending',
    'period',
    'inactive',
    'missing-claim',
    'outside-selection',
    'existing-header',
    'claim-marked',
    'unselected-claim-marked',
    'item-marked',
    'request-marked',
  ] as const)(
    'refuses %s without partial rejection or repair',
    async (kind) => {
      const f = acceptanceStartStore();
      if (kind === 'busy')
        f.state.db.controls[1].activeWrites = [{ token: 'private' }];
      if (kind === 'pending')
        f.state.db.medical.push({ animalIds: [f.id(101)], status: 'UNKNOWN' });
      if (kind === 'period')
        f.state.db.periods.push({
          ...f.state.db.periods[1],
          id: f.id(299),
          status: 'CLOSED',
        });
      if (kind === 'inactive') f.state.db.animals[1].isActive = false;
      if (kind === 'missing-claim') f.state.db.claims.pop();
      if (kind === 'outside-selection')
        f.input.acceptedAnimalIds.push(f.id(900));
      if (kind === 'existing-header')
        f.state.db.archives.push({
          id: f.id(999),
          periodId: f.id(200),
          transferId: f.input.transferId,
        });
      if (kind === 'claim-marked')
        f.state.db.claims[0].acceptanceOperationId = f.id(99);
      if (kind === 'unselected-claim-marked')
        f.state.db.claims[2].acceptanceOperationId = f.id(99);
      if (kind === 'item-marked')
        f.state.db.items[2].captureArchiveId = f.id(99);
      if (kind === 'request-marked')
        f.state.db.requests[0].acceptanceStart = {};
      const before = structuredClone(f.state.db);
      await expect(f.service.start(f.input)).rejects.toThrow();
      expect(f.state.db).toEqual(before);
    },
  );
  it('revalidates recipient existence in the same transaction', async () => {
    const f = acceptanceStartStore();
    f.state.db.users = [];
    await expect(f.service.start(f.input)).rejects.toThrow('recipient changed');
    expect(f.state.db.requests[0].status).toBe('PENDING');
  });
  it('reads every diary page and rejects an unsealed attachment after the first 100 records', async () => {
    const f = acceptanceStartStore();
    f.state.db.diary = Array.from({ length: 101 }, (_, n) => ({
      id: f.id(500 + n),
      animalId: f.id(100),
      title: 'Control',
      date: '2026-01-01',
      createdAt: acceptanceAt,
      updatedAt: acceptanceAt,
      attachments:
        n < 100
          ? []
          : [
              {
                id: f.id(900),
                url: `https://synthetic.invalid/users/${f.actorId}/animals/${f.id(100)}/diary/unsealed.jpeg`,
                fileName: 'photo',
                mimeType: 'image/jpeg',
                fileType: 'image',
                size: 12,
                createdAt: acceptanceAt,
              },
            ],
    }));
    await expect(f.service.start(f.input)).rejects.toThrow('unconfirmed');
    expect(
      f.calls.filter((c) => c.role === 'diary' && c.method === 'find'),
    ).toHaveLength(2);
    expect(f.state.db.archives).toEqual([]);
    expect(f.state.db.controls.every((c) => !c.transferLock)).toBe(true);
  });
  it.each([false, true])(
    'checks sealed media registry without S3 (sealed=%s)',
    async (sealed) => {
      const f = acceptanceStartStore(),
        key = `users/${f.actorId}/animals/${f.id(100)}/profile_photo.jpeg`;
      f.state.db.animals[0].profilePictureUrl = `https://synthetic.invalid/${key}`;
      if (sealed)
        f.state.db.media.push({
          finalKey: key,
          pinned: { sha256: 'a'.repeat(64) },
          sealed: { etag: 'synthetic', size: 12 },
        });
      if (sealed)
        expect((await f.service.start(f.input)).requestVersion).toBe(2);
      else
        await expect(f.service.start(f.input)).rejects.toThrow('unconfirmed');
      expect(
        f.calls
          .filter((c) => c.role === 'media')
          .every((c) => c.method === 'findOne'),
      ).toBe(true);
    },
  );
  it('reconciles a lost application response after simulated commit without any new writes', async () => {
    const f = acceptanceStartStore();
    f.state.loseReply = true;
    await expect(f.service.start(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.state.db.requests[0].status).toBe('PROCESSING');
    const before = structuredClone(f.state.db),
      count = f.calls.length;
    const replay = await f.service.start({
      ...f.input,
      acceptedAnimalIds: [...f.input.acceptedAnimalIds].reverse(),
    });
    expect(replay.replayed).toBe(true);
    expect(f.state.db).toEqual(before);
    expect(f.calls.slice(count).map((c) => c.method)).toEqual(['findById']);
    expect(replay.businessCommit).toBe('NOT_AUTHORIZED');
  });
  it.each([
    'selection',
    'operation',
    'version',
    'missing-binding',
    'corrupt-binding',
  ] as const)('refuses changed replay %s', async (kind) => {
    const f = acceptanceStartStore();
    await f.service.start(f.input);
    const input = {
      ...f.input,
      acceptedAnimalIds: [...f.input.acceptedAnimalIds],
    };
    if (kind === 'selection') input.acceptedAnimalIds.pop();
    if (kind === 'operation') input.operationId = f.id(99);
    if (kind === 'version') input.expectedVersion = 2;
    if (kind === 'missing-binding')
      delete f.state.db.requests[0].acceptanceStart;
    if (kind === 'corrupt-binding')
      (
        f.state.db.requests[0].acceptanceStart as {
          selected: unknown[];
        }
      ).selected.pop();
    const before = structuredClone(f.state.db);
    await expect(f.service.start(input)).rejects.toThrow('receipt');
    expect(f.state.db).toEqual(before);
  });
  it('retains the committed lock if session closing fails and does not treat a later receipt as a fence', async () => {
    const f = acceptanceStartStore();
    f.state.endFailure = true;
    await expect(f.service.start(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.state.db.controls[0].transferLock).toBeDefined();
    f.state.endFailure = false;
    delete f.state.db.controls[0].transferLock;
    f.state.db.controls[0].reservationEpoch = 2;
    expect((await f.service.start(f.input)).reservation).toBe(
      'RECORDED_AT_START',
    );
    expect(f.state.db.controls[0].transferLock).toBeUndefined();
  });
  it('never adopts an existing same-transfer lock, even without a header', async () => {
    const f = acceptanceStartStore();
    f.state.db.controls[0].transferLock = {
      transferId: f.input.transferId,
      lockedAt: acceptanceAt,
    };
    f.state.db.controls[0].reservationEpoch = 1;
    await expect(f.service.start(f.input)).rejects.toThrow('busy');
    expect(f.state.db.archives).toEqual([]);
  });
  it.each([
    'controls.updateOne',
    'items.updateOne',
    'claims.updateOne',
    'items.updateMany',
    'claims.deleteMany',
    'requests.updateOne',
  ] as const)('denies a no-op/short write on %s', async (target) => {
    const f = acceptanceStartStore(),
      before = structuredClone(f.state.db);
    f.state.noOp = target;
    await expect(f.service.start(f.input)).rejects.toThrow();
    expect(f.state.db).toEqual(before);
  });
  it('does not commit a stale transaction when an external writer advances the source snapshot', async () => {
    const f = acceptanceStartStore();
    f.state.beforeCommit = () => {
      f.state.db.animals[0].name = 'Changed';
      f.state.epoch++;
    };
    await expect(f.service.start(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.state.db.requests[0].status).toBe('PENDING');
    expect(f.state.db.animals[0].name).toBe('Changed');
    expect(f.state.db.controls.every((c) => !c.transferLock)).toBe(true);
  });
  it('allows only one simulated competing decision to commit; explicit same-operation reconciliation is read-only', async () => {
    const f = acceptanceStartStore();
    const results = await Promise.allSettled([
      f.service.start(f.input),
      f.service.start(f.input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.state.db.events).toHaveLength(1);
    expect((await f.service.start(f.input)).replayed).toBe(true);
  });
  it.each(['collection', 'index', 'binding'] as const)(
    'denies bad %s readiness before any business reads',
    async (kind) => {
      const f = acceptanceStartStore();
      if (kind === 'collection') f.state.missingCollection = 'diary_entries';
      if (kind === 'index') f.state.badIndex = 'animal_ownership_archives';
      if (kind === 'binding') f.models[7].db = { ...f.connection };
      await expect(f.service.start(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.calls).toEqual([]);
    },
  );
  it('captures immutable selection before I/O and never accepts a candidate as permission input', async () => {
    const f = acceptanceStartStore(),
      input = { ...f.input, acceptedAnimalIds: [...f.input.acceptedAnimalIds] };
    const pending = f.service.start(input);
    input.acceptedAnimalIds.push(f.id(900));
    expect((await pending).binding.selected).toHaveLength(2);
    expect(() =>
      f.service.start({ ...f.input, candidate: true } as AcceptanceSelection),
    ).toThrow('Invalid');
  });
  it('creates headers that the existing capture service can resume through its original fence without acquiring another lock', async () => {
    const f = acceptanceStartStore();
    await f.service.start(f.input);
    const archive = f.state.db.archives[0] as OwnershipArchive;
    const ownership = {
      findControl: jest.fn().mockResolvedValue(f.state.db.controls[0]),
      acquireTransferLock: jest.fn(),
      releaseTransferLock: jest.fn(),
    };
    const repository = { find: jest.fn().mockResolvedValue(archive) };
    const capture = new OwnershipArchiveCapture(
      ownership as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const definition = {
      id: archive.id,
      animalId: archive.animalId,
      ownerId: archive.ownerId,
      recipientId: archive.recipientId,
      periodId: archive.periodId,
      transferId: archive.transferId,
      ownershipVersion: archive.ownershipVersion,
    };
    expect(await capture.start(definition)).toEqual(archive);
    expect(ownership.acquireTransferLock).not.toHaveBeenCalled();
    expect(ownership.releaseTransferLock).not.toHaveBeenCalled();
    f.state.db.controls[0].reservationEpoch = 3;
    await expect(capture.start(definition)).rejects.toThrow(
      'original matching',
    );
  });
  it('keeps the start module outside the app graph, with explicit key resolver and no collection/index defaults', () => {
    const f = acceptanceStartStore();
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AnimalTransferModule),
    ).not.toContain(TransferAcceptanceStartModule);
    expect(() =>
      TransferAcceptanceStartModule.register(undefined as never),
    ).toThrow('pure');
    const registered = TransferAcceptanceStartModule.register(f.keys);
    expect(registered.exports).toHaveLength(1);
    expect(
      f.schemas.every(
        ([, s]) => s.path('acceptanceStart')?.options.default === undefined,
      ),
    ).toBe(true);
    expect(
      f.schemas
        .find(([role]) => role === 'claims')![1]
        .path('acceptanceOperationId'),
    ).toBeDefined();
  });
});
