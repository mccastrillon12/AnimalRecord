import { MODULE_METADATA } from '@nestjs/common/constants';
import { TransferItemCapture } from '../../../src/context/animal-transfer/application/transfer-item-capture';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { TransferItemCaptureModule } from '../../../src/app/animal-transfer/transfer-item-capture.module';
import { AnimalTransferModule } from '../../../src/app/animal-transfer/animal-transfer.module';
import { ItemCaptureInput } from '../../../src/context/animal-transfer/domain/transfer-item-capture';
import { acceptanceStartStore } from '../fixtures/acceptance-start-store.fixture';

async function setup() {
  const f = acceptanceStartStore(),
    receipt = await f.service.start(f.input),
    selected = receipt.binding.selected[0];
  const store = new MongoTransferItemCapture(
    ...([
      f.models[0],
      f.models[1],
      f.models[2],
      f.models[9],
      f.models[4],
      f.models[5],
    ] as unknown as ConstructorParameters<typeof MongoTransferItemCapture>),
  );
  const input: ItemCaptureInput = {
    actorId: f.recipientId,
    transferId: f.input.transferId,
    itemId: selected.itemId,
    decisionOperationId: f.input.operationId,
    expectedRequestVersion: 2,
    expectedCaptureRevision: 0,
  };
  const capture = {
    captureBatch: jest.fn(() => {
      const row = f.state.db.archives.find((a) => a.id === selected.archiveId)!;
      row.capture = { revision: 1, phase: 'DIARY', entryCount: 1 };
      f.state.epoch++;
      return Promise.resolve(row as never);
    }),
  };
  f.state.writes = 0;
  f.calls.length = 0;
  return {
    ...f,
    store,
    input,
    selected,
    capture,
    service: new TransferItemCapture(store, capture),
  };
}
describe('Per-item capture admission and progress, simulated transactions only', () => {
  it('fences request/item/claim/control before exactly one bound callback and returns only minimal observed progress', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db),
      result = await f.service.advance(f.input);
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
    expect(f.capture.captureBatch).toHaveBeenCalledWith(f.selected.archiveId, {
      definitionHash: before.archives[0].definitionHash,
      reservationEpoch: 1,
      revision: 0,
    });
    expect(result).toMatchObject({
      captureRevision: 1,
      phase: 'DIARY',
      entryCount: 1,
      stage: 'COLLECTING',
      callback: 'RETURNED',
      reservation: 'OBSERVED_ONLY',
      businessCommit: 'NOT_AUTHORIZED',
      stableCut: 'NOT_ASSESSED',
    });
    for (const role of ['requests', 'items', 'claims'] as const)
      expect(f.state.db[role][0].captureStepRevision).toBe(1);
    expect(f.state.db.controls[0].archivePreparationRevision).toBe(2);
    expect(f.state.db.controls[0].reservationEpoch).toBe(1);
    expect(f.state.db.requests[0].version).toBe(2);
    expect(f.state.db.animals).toEqual(before.animals);
    expect(f.state.db.periods).toEqual(before.periods);
    expect(f.state.db.events).toEqual(before.events);
    const writes = f.calls.filter((c) =>
      [
        'updateOne',
        'updateMany',
        'deleteMany',
        'create',
        'findOneAndUpdate',
      ].includes(c.method),
    );
    expect(writes.map((c) => c.role)).toEqual([
      'requests',
      'items',
      'claims',
      'controls',
    ]);
    expect(writes.every((c) => c.session === f.sessions[1])).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /Brownie|archiveId|definitionHash|token|nameHistory|proof/,
    );
  });
  it('does not invoke another page or write admission counters when the same expected revision is retried', async () => {
    const f = await setup();
    await f.service.advance(f.input);
    const before = structuredClone(f.state.db);
    expect(await f.service.advance(f.input)).toMatchObject({
      captureRevision: 1,
      callback: 'NOT_INVOKED',
    });
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
    expect(f.state.db).toEqual(before);
  });
  it('observes progress without writing a fence or invoking capture', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    expect(await f.service.observe(f.input)).toMatchObject({
      captureRevision: 0,
      reservation: 'OBSERVED_ONLY',
    });
    expect(f.state.db).toEqual(before);
    expect(f.state.writes).toBe(0);
  });
  it.each([1, 2, 3, 4])(
    'rolls back admission write %i without invoking work or releasing its reservation',
    async (n) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.failAtWrite = n;
      await expect(f.service.advance(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      expect(f.state.db).toEqual(before);
    },
  );
  it.each([
    'request',
    'recipient',
    'version',
    'operation',
    'item',
    'claim',
    'header',
    'epoch',
    'writers',
    'period',
    'cursor',
    'consumed',
    'legacy',
  ] as const)(
    'denies mismatched %s before work without repairs',
    async (kind) => {
      const f = await setup();
      if (kind === 'request') f.state.db.requests[0].status = 'PENDING';
      if (kind === 'recipient') f.state.db.requests[0].recipientId = f.actorId;
      if (kind === 'version') f.state.db.requests[0].version = 3;
      if (kind === 'operation')
        f.state.db.requests[0].decisionOperationId = f.id(90);
      if (kind === 'item') f.state.db.items[0].status = 'REJECTED';
      if (kind === 'claim')
        f.state.db.claims[0].acceptanceOperationId = f.id(90);
      if (kind === 'header') f.state.db.archives[0].ownerId = f.id(90);
      if (kind === 'epoch') f.state.db.controls[0].reservationEpoch = 3;
      if (kind === 'writers')
        f.state.db.controls[0].activeWrites = [{ token: 'private' }];
      if (kind === 'period') f.state.db.periods[0].status = 'UNKNOWN';
      if (kind === 'cursor') delete f.state.db.archives[0].capture;
      if (kind === 'consumed') f.state.db.archives[0].evidenceConsumption = {};
      if (kind === 'legacy') delete f.state.db.requests[0].acceptanceStart;
      const before = structuredClone(f.state.db);
      await expect(f.service.advance(f.input)).rejects.toThrow();
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      expect(f.state.db).toEqual(before);
    },
  );
  it('authorizes the recipient before loading associated sources', async () => {
    const f = await setup();
    await expect(
      f.service.advance({ ...f.input, actorId: f.actorId }),
    ).rejects.toThrow('recipient');
    expect(f.calls.map((c) => c.method)).toEqual(['findById']);
  });
  it.each(['requests', 'items', 'claims'] as const)(
    'denies exhausted %s admission fences',
    async (role) => {
      const f = await setup();
      f.state.db[role][0].captureStepRevision = Number.MAX_SAFE_INTEGER;
      const before = structuredClone(f.state.db);
      await expect(f.service.advance(f.input)).rejects.toThrow('exhausted');
      expect(f.state.db).toEqual(before);
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
    },
  );
  it('distinguishes missing counters from persisted zero when acquiring their fences', async () => {
    const f = await setup();
    for (const role of ['requests', 'items', 'claims'] as const)
      f.state.db[role][0].captureStepRevision = 0;
    await f.service.advance(f.input);
    expect(
      f.calls
        .filter(
          (c) =>
            ['requests', 'items', 'claims'].includes(c.role) &&
            c.method === 'updateOne',
        )
        .every((c) => c.filter.captureStepRevision === 0),
    ).toBe(true);
  });
  it('retains admitted counters and the reservation after a lost admission reply, without invoking a callback', async () => {
    const f = await setup();
    f.state.loseReply = true;
    await expect(f.service.advance(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.state.db.items[0].captureStepRevision).toBe(1);
    expect(f.state.db.controls[0].transferLock).toBeDefined();
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it('keeps callback errors sanitized and reconciles an already advanced cursor without rerunning it', async () => {
    const f = await setup(),
      run = f.capture.captureBatch.getMockImplementation()!;
    f.capture.captureBatch.mockImplementationOnce(async () => {
      await run();
      throw new Error('private token storage URL');
    });
    const error: unknown = await f.service
      .advance(f.input)
      .catch((e: unknown) => e);
    expect(String(error)).not.toMatch(/private|token|URL/);
    expect(f.state.db.controls[0].transferLock).toBeDefined();
    expect(await f.service.advance(f.input)).toMatchObject({
      callback: 'NOT_INVOKED',
      captureRevision: 1,
    });
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
  });
  it('never changes the admission snapshot into authority after an external control change before commit', async () => {
    const f = await setup();
    f.state.beforeCommit = () => {
      f.state.db.controls[0].reservationEpoch = 3;
      f.state.epoch++;
    };
    await expect(f.service.advance(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(f.state.db.items[0].captureStepRevision).toBeUndefined();
  });
  it('reports sealed capture without invoking copying or declaring ownership accepted', async () => {
    const f = await setup();
    f.state.db.archives[0].capture = {
      revision: 3,
      phase: 'COMPLETE',
      entryCount: 1,
    };
    f.state.db.archives[0].state = 'COPYING';
    expect(
      await f.service.advance({ ...f.input, expectedCaptureRevision: 3 }),
    ).toMatchObject({
      stage: 'CAPTURE_SEALED',
      callback: 'NOT_INVOKED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(f.state.db.items[0].status).toBe('PROCESSING');
  });
  it('rejects future revisions and selectors containing caller-supplied archive identities', async () => {
    const f = await setup();
    await expect(
      f.service.advance({ ...f.input, expectedCaptureRevision: 1 }),
    ).rejects.toThrow('progress');
    await expect(
      f.service.advance({
        ...f.input,
        archiveId: f.selected.archiveId,
      } as ItemCaptureInput),
    ).rejects.toThrow('Invalid');
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it.each([
    'requests.updateOne',
    'items.updateOne',
    'claims.updateOne',
    'controls.updateOne',
  ])('denies a no-op fence %s without invoking capture', async (target) => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    f.state.noOp = target;
    await expect(f.service.advance(f.input)).rejects.toThrow('fence');
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(f.state.db).toEqual(before);
  });
  it.each(['collection', 'index', 'connection'] as const)(
    'denies bad %s storage without reading associated business data',
    async (kind) => {
      const f = await setup();
      if (kind === 'collection')
        f.state.missingCollection = 'animal_ownership_archives';
      if (kind === 'index') f.state.badIndex = 'animal_ownership_controls';
      if (kind === 'connection') f.models[9].db = { ...f.connection };
      await expect(f.service.advance(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      expect(f.calls).toEqual([]);
    },
  );
  it('retains a committed admission if closing the session fails, without calling capture', async () => {
    const f = await setup();
    f.state.endFailure = true;
    await expect(f.service.advance(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(f.state.db.items[0].captureStepRevision).toBe(1);
    expect(f.state.db.controls[0].transferLock).toBeDefined();
  });
  it('captures the immutable selector before storage awaits and ignores later caller mutation', async () => {
    const f = await setup(),
      raw = { ...f.input };
    const result = f.service.advance(raw);
    raw.itemId = f.id(999);
    raw.expectedCaptureRevision = 9;
    expect(await result).toMatchObject({
      itemId: f.input.itemId,
      captureRevision: 1,
    });
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
  });
  it('does not report a successful observation if the original reserve is invalidated after the callback', async () => {
    const f = await setup(),
      run = f.capture.captureBatch.getMockImplementation()!;
    f.capture.captureBatch.mockImplementationOnce(async () => {
      const result = await run();
      f.state.db.controls[0].reservationEpoch = 3;
      return result;
    });
    await expect(f.service.advance(f.input)).rejects.toThrow(
      'original matching',
    );
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
    expect(f.state.db.items[0].status).toBe('PROCESSING');
    expect(f.state.db.controls[0].transferLock).toBeDefined();
  });
  it('preserves a recipient denial when ending its read session also fails', async () => {
    const f = await setup();
    f.state.endFailure = true;
    await expect(
      f.service.advance({ ...f.input, actorId: f.actorId }),
    ).rejects.toThrow('recipient');
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it('keeps the module outside the graph and requires explicit capture composition', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AnimalTransferModule),
    ).not.toContain(TransferItemCaptureModule);
    expect(() =>
      TransferItemCaptureModule.register(undefined as never),
    ).toThrow('explicit');
    expect(
      TransferItemCaptureModule.register({ captureBatch: jest.fn() }).exports,
    ).toEqual([TransferItemCapture]);
  });
});
