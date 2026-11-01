import { TransferItemCapture } from '../../../src/context/animal-transfer/application/transfer-item-capture';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { OwnershipArchiveFileSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import {
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
  buildArchiveEntry,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { acceptanceStartStore } from '../fixtures/acceptance-start-store.fixture';
import { archiveAnimal } from '../fixtures/ownership-archive.fixture';

async function setup() {
  const f = acceptanceStartStore();
  const receipt = await f.service.start(f.input);
  const selected = receipt.binding.selected[0];
  const archive = f.state.db.archives.find(
    (a) => a.id === selected.archiveId,
  )! as unknown as OwnershipArchive;
  Object.assign(archive, {
    state: 'COPYING',
    capture: { revision: 3, phase: 'COMPLETE', entryCount: 1 },
    expectedEntryCount: 1,
    expectedFileCount: 1,
  });
  const store = new MongoTransferItemCapture(
    ...([
      f.models[0],
      f.models[1],
      f.models[2],
      f.models[9],
      f.models[4],
      f.models[5],
      f.models[12],
    ] as unknown as ConstructorParameters<typeof MongoTransferItemCapture>),
  );
  const capture = { captureBatch: jest.fn() };
  const service = new TransferItemCapture(store, capture);
  const selector = {
    actorId: f.recipientId,
    transferId: f.input.transferId,
    itemId: selected.itemId,
    decisionOperationId: f.input.operationId,
    expectedRequestVersion: 2,
    expectedCaptureRevision: 3,
  };
  const key = `users/${archive.ownerId}/animals/${archive.animalId}/profile/photo.jpg`;
  const built = buildArchiveEntry(
    archive,
    {
      kind: 'ANIMAL',
      data: {
        ...archiveAnimal,
        id: archive.animalId,
        ownerId: archive.ownerId,
        profilePictureUrl: `https://test/${key}`,
      },
    },
    (url) => url.slice(13),
  );
  const definition = {
    ...built.files[0],
    source: { etag: 'source', size: 12, versionId: 'v1' },
  };
  const file: ArchiveFile = {
    ...definition,
    definitionHash: archiveHash(definition),
    state: 'PENDING',
  };
  f.state.db.files.push(file as unknown as Record<string, unknown>);
  const observation = await service.inspectCopyPreparation(selector);
  const input = {
    selector,
    fileId: file.id,
    expectedFileDefinitionHash: file.definitionHash,
    expectedSealHash: observation.observedSealHash,
    bucket: 'test-archive-bucket',
    sourceSha256: 'a'.repeat(64),
  };
  f.state.writes = 0;
  f.calls.length = 0;
  return { ...f, service, store, capture, input };
}

describe('Historical intent persistence under the original item reservation, simulated Mongo only', () => {
  it('fences decision/item/claim/control and stores only the immutable intent in the same transaction', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    const result = await f.service.prepareHistoricalCopy(f.input);
    expect(result).toMatchObject({
      transferId: f.input.selector.transferId,
      itemId: f.input.selector.itemId,
      fileId: f.input.fileId,
      replayed: false,
      reservation: 'FENCED_AT_PREPARATION',
      copyDispatch: 'NOT_AUTHORIZED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    const stored = f.state.db.files[0].historicalCopyIntent as Record<
      string,
      unknown
    >;
    expect(result.intentId).toBe(stored.id);
    expect(result.intentDefinitionHash).toBe(stored.definitionHash);
    expect(stored).toMatchObject({
      kind: 'HISTORICAL',
      bucket: f.input.bucket,
      destination: { key: before.files[0].historicalKey, ifNoneMatch: '*' },
      copyDispatch: 'NOT_AUTHORIZED',
    });
    const writes = f.calls.filter((c) => c.method === 'updateOne');
    expect(writes.map((c) => c.role)).toEqual([
      'requests',
      'items',
      'claims',
      'controls',
      'files',
    ]);
    expect(writes.every((c) => c.session === f.sessions.at(-1))).toBe(true);
    const txCalls = f.sessions.at(-1)!.withTransaction.mock
      .calls as unknown[][];
    expect(txCalls[0][1]).toMatchObject({
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
    expect(f.state.db.files[0]).toEqual({
      ...before.files[0],
      historicalCopyIntent: stored,
    });
    for (const role of ['animals', 'periods', 'archives', 'events'] as const)
      expect(f.state.db[role]).toEqual(before[role]);
    expect(f.state.db.items[0].status).toBe('PROCESSING');
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /sourceKey|bucket|sha256|leaseToken|https:/,
    );
  });
  it('replays exactly without replacing its definition, reclaiming work or releasing its reservation', async () => {
    const f = await setup(),
      first = await f.service.prepareHistoricalCopy(f.input);
    const file = structuredClone(f.state.db.files[0]);
    f.calls.length = 0;
    expect(await f.service.prepareHistoricalCopy(f.input)).toEqual({
      ...first,
      replayed: true,
    });
    expect(f.state.db.files[0]).toEqual(file);
    expect(
      f.calls.filter((c) => c.method === 'updateOne').map((c) => c.role),
    ).toEqual(['requests', 'items', 'claims', 'controls']);
    expect(f.state.db.controls[0].transferLock).toBeDefined();
  });
  it.each(['bucket', 'digest', 'seal', 'corrupt', 'null'])(
    'does not replace the existing intention after %s changes',
    async (kind) => {
      const f = await setup();
      await f.service.prepareHistoricalCopy(f.input);
      const input = { ...f.input };
      if (kind === 'bucket') input.bucket = 'another-bucket';
      if (kind === 'digest') input.sourceSha256 = 'b'.repeat(64);
      if (kind === 'seal') {
        f.state.db.archives[0].expectedFileCount = 2;
        input.expectedSealHash = (
          await f.service.inspectCopyPreparation(input.selector)
        ).observedSealHash;
      }
      if (kind === 'corrupt')
        (
          f.state.db.files[0].historicalCopyIntent as Record<string, unknown>
        ).copyDispatch = 'AUTHORIZED';
      if (kind === 'null') f.state.db.files[0].historicalCopyIntent = null;
      const before = structuredClone(f.state.db),
        writes = f.state.writes;
      await expect(f.service.prepareHistoricalCopy(input)).rejects.toThrow(
        'cannot be replaced',
      );
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(writes);
    },
  );
  it.each([1, 2, 3, 4, 5])(
    'rolls back the complete preparation when write %i fails',
    async (n) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.failAtWrite = n;
      await expect(
        f.service.prepareHistoricalCopy(f.input),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.state.db).toEqual(before);
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
    },
  );
  it.each(['requests', 'items', 'claims', 'controls', 'files'])(
    'rejects a no-op %s CAS and rolls back other writes',
    async (role) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.noOp = `${role}.updateOne`;
      await expect(f.service.prepareHistoricalCopy(f.input)).rejects.toThrow(
        'fence',
      );
      expect(f.state.db).toEqual(before);
    },
  );
  it.each(['lostReply', 'endSession'])(
    'retains a committed intent after %s failure and reconciles by exact replay',
    async (kind) => {
      const f = await setup();
      if (kind === 'lostReply') f.state.loseReply = true;
      else f.state.endFailure = true;
      await expect(
        f.service.prepareHistoricalCopy(f.input),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.state.db.files[0].historicalCopyIntent).toBeDefined();
      f.state.endFailure = false;
      expect(await f.service.prepareHistoricalCopy(f.input)).toMatchObject({
        replayed: true,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
    },
  );
  it.each([
    'lease',
    'expiredLease',
    'verified',
    'materialized',
    'working',
    'ready',
    'missingFile',
    'foreignFile',
    'fileHash',
    'sealHash',
    'epoch',
    'claim',
    'closed',
    'consumed',
    'stale',
  ])(
    'rejects incompatible persisted %s without adoption or repair',
    async (kind) => {
      const f = await setup();
      if (kind === 'lease') f.state.db.files[0].leaseToken = 'old';
      if (kind === 'expiredLease')
        f.state.db.files[0].leaseUntil = '2000-01-01T00:00:00Z';
      if (kind === 'verified') f.state.db.files[0].verified = {};
      if (kind === 'materialized') f.state.db.files[0].materialization = {};
      if (kind === 'working') f.state.db.files[0].state = 'COPYING';
      if (kind === 'ready') f.state.db.archives[0].state = 'READY';
      if (kind === 'missingFile') f.state.db.files = [];
      if (kind === 'foreignFile') f.state.db.files[0].archiveId = f.id(90);
      if (kind === 'fileHash')
        f.input.expectedFileDefinitionHash = 'b'.repeat(64);
      if (kind === 'sealHash') f.input.expectedSealHash = 'b'.repeat(64);
      if (kind === 'epoch') f.state.db.controls[0].reservationEpoch = 3;
      if (kind === 'claim')
        f.state.db.claims[0].acceptanceOperationId = f.id(90);
      if (kind === 'closed') f.state.db.periods[0].status = 'CLOSED';
      if (kind === 'consumed') f.state.db.archives[0].evidenceConsumption = {};
      if (kind === 'stale') f.input.selector.expectedCaptureRevision = 2;
      const before = structuredClone(f.state.db);
      await expect(f.service.prepareHistoricalCopy(f.input)).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
    },
  );
  it('checks the recipient before reading the manifest', async () => {
    const f = await setup();
    f.input.selector.actorId = f.actorId;
    await expect(f.service.prepareHistoricalCopy(f.input)).rejects.toThrow(
      'recipient',
    );
    expect(f.calls.map((c) => c.method)).toEqual(['findById']);
  });
  it.each(['connection', 'collection', 'index'])(
    'requires existing same-client file %s prerequisites without DDL',
    async (kind) => {
      const f = await setup();
      if (kind === 'connection') f.models[12].db = { ...f.connection };
      if (kind === 'collection')
        f.state.missingCollection = 'animal_ownership_archive_files';
      if (kind === 'index') f.state.badIndex = 'animal_ownership_archive_files';
      await expect(
        f.service.prepareHistoricalCopy(f.input),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.calls).toEqual([]);
      expect(f.state.writes).toBe(0);
    },
  );
  it('rejects an invalid selector, extra permission fields or malformed file pin before storage', async () => {
    const f = await setup();
    for (const input of [
      { ...f.input, canCopy: true },
      { ...f.input, fileId: 'bad' },
      { ...f.input, selector: { ...f.input.selector, archiveId: f.id(90) } },
    ]) {
      expect(() => f.service.prepareHistoricalCopy(input)).toThrow('Invalid');
    }
    expect(f.calls).toEqual([]);
  });
  it('freezes the request before awaiting storage', async () => {
    const f = await setup();
    const result = f.service.prepareHistoricalCopy(f.input);
    f.input.bucket = 'another-bucket';
    f.input.selector.itemId = f.id(90);
    expect(await result).toMatchObject({ replayed: false });
    expect(f.state.db.files[0].historicalCopyIntent).toMatchObject({
      bucket: 'test-archive-bucket',
    });
  });
  it('aborts a preparation snapshot invalidated before commit without writing the intent', async () => {
    const f = await setup();
    f.state.beforeCommit = () => {
      f.state.db.controls[0].reservationEpoch = 3;
      f.state.epoch++;
    };
    await expect(
      f.service.prepareHistoricalCopy(f.input),
    ).rejects.toMatchObject({ status: 503 });
    expect(f.state.db.files[0].historicalCopyIntent).toBeUndefined();
    expect(f.state.db.requests[0].captureStepRevision).toBeUndefined();
  });
  it('keeps the new manifest field optional without defaults or new indexes', () => {
    expect(
      OwnershipArchiveFileSchema.path('historicalCopyIntent').options.default,
    ).toBeUndefined();
    expect(
      OwnershipArchiveFileSchema.indexes().some(
        ([key]) => 'historicalCopyIntent' in key,
      ),
    ).toBe(false);
  });
});
