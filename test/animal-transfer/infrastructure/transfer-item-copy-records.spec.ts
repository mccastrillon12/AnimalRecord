import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import {
  ItemCopyRecordSchema,
  ITEM_COPY_RECORD_COLLECTION,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-item-copy-record.schema';
import { ItemCopyDeclarationInput } from '../../../src/context/animal-transfer/domain/transfer-item-copy-record';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  buildStagingCopyPreparation,
  ItemHistoricalByteObservation,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

async function setup(staging = false) {
  const f = await historicalCopyPreparationFixture();
  const store = new MongoTransferItemCapture(
    ...([
      f.models[0],
      f.models[1],
      f.models[2],
      f.models[9],
      f.models[4],
      f.models[5],
      f.models[12],
      f.models[13],
      f.models[14],
    ] as unknown as ConstructorParameters<typeof MongoTransferItemCapture>),
  );
  await store.prepareHistoricalCopy(f.input);
  if (staging) {
    const context = await store.readHistoricalCopy(f.input),
      h = context.file.historicalCopyIntent!;
    const payload = {
      intentId: h.id,
      intentDefinitionHash: h.definitionHash,
      bucket: h.bucket,
      key: h.destination.key,
      revision: { etag: 'synthetic-history', size: 12 },
      sha256: h.source.sha256,
    };
    const observation: ItemHistoricalByteObservation = {
      protocol: 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1',
      binding: h.binding,
      observation: payload,
      observationHash: archiveHash(payload),
      bytes: 'MATCH',
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    };
    buildStagingCopyPreparation(context, observation);
    await store.confirmHistoricalObservation(f.input, observation); // Simulated trusted metadata only, not storage evidence.
  }
  const declaration: ItemCopyDeclarationInput = {
    preparation: f.input,
    kind: staging ? 'RECIPIENT_STAGING' : 'HISTORICAL',
    attemptId: f.id(900),
    dispatcherInstanceId: f.id(901),
    origin: 'INITIAL',
    expectedGateRevision: 0,
  };
  const revoke = {
    selector: f.input.selector,
    requestId: f.id(902),
    evidenceRef: 'test:technical-stop',
  };
  f.state.writes = 0;
  f.calls.length = 0;
  return { ...f, recordStore: store, declaration, revoke };
}
async function opened(staging = false) {
  const f = await setup(staging);
  await f.recordStore.openCopyGate(f.input.selector);
  f.state.writes = 0;
  f.calls.length = 0;
  return f;
}
describe('Copy gates and INTENDED records, simulated transactions only', () => {
  it('reads an absent gate without fences and creates one with the original four fences', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    expect(await f.recordStore.readCopyGate(f.input.selector)).toBeNull();
    expect(f.state.writes).toBe(0);
    const receipt = await f.recordStore.openCopyGate(f.input.selector);
    expect(receipt).toMatchObject({
      state: 'OPEN',
      gateRevision: 0,
      replayed: false,
      reservation: 'FENCED_AT_PREPARATION',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    const writes = f.calls.filter((c) =>
      ['create', 'updateOne'].includes(c.method),
    );
    expect(writes.map((c) => c.role)).toEqual([
      'requests',
      'items',
      'claims',
      'controls',
      'copyRecords',
    ]);
    expect(writes.every((c) => c.session === f.sessions.at(-1))).toBe(true);
    for (const role of [
      'animals',
      'periods',
      'files',
      'archives',
      'events',
    ] as const)
      expect(f.state.db[role]).toEqual(before[role]);
    const gate = await f.recordStore.readCopyGate(f.input.selector);
    expect(gate?.identityIds).toEqual([receipt.gateId]);
    expect(Object.isFrozen(gate?.binding.observedSeal)).toBe(true);
    expect(f.state.db.requests[0].version).toBe(2);
  });
  it.each([false, true])(
    'declares an immutable initial attempt and advances the same gate (staging=%s)',
    async (staging) => {
      const f = await opened(staging),
        before = structuredClone(f.state.db);
      const receipt = await f.recordStore.declareCopyAttempt(f.declaration);
      expect(receipt).toMatchObject({
        attemptId: f.declaration.attemptId,
        gateRevision: 1,
        replayed: false,
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      const record = f.state.db.copyRecords.find((r) => r.row === 'ATTEMPT')!;
      expect(record).toMatchObject({
        state: 'INTENDED',
        ordinal: 1,
        gateId: receipt.gateId,
        identityIds: [f.declaration.attemptId],
        definition: {
          origin: 'INITIAL',
          kind: f.declaration.kind,
          definitionHash: receipt.attemptDefinitionHash,
          copyDispatch: 'NOT_AUTHORIZED',
        },
      });
      expect(record).not.toHaveProperty('authorizationId');
      const writes = f.calls.filter((c) =>
        ['create', 'updateOne'].includes(c.method),
      );
      expect(writes.map((c) => c.role)).toEqual([
        'requests',
        'items',
        'claims',
        'controls',
        'copyRecords',
        'copyRecords',
      ]);
      expect(writes.every((c) => c.session === f.sessions.at(-1))).toBe(true);
      expect(f.state.db.files).toEqual(before.files);
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
    },
  );
  it('replays opening as metadata and fences the same gate without duplicating it', async () => {
    const f = await opened(),
      gate = f.state.db.copyRecords[0];
    expect(await f.recordStore.openCopyGate(f.input.selector)).toMatchObject({
      gateId: gate.id,
      gateRevision: 1,
      replayed: true,
    });
    expect(f.state.db.copyRecords).toHaveLength(1);
  });
  it('requires an exact revision and reconciles declaration replay through a fresh gate read', async () => {
    const f = await opened(),
      first = await f.recordStore.declareCopyAttempt(f.declaration);
    const before = structuredClone(f.state.db);
    await expect(
      f.recordStore.declareCopyAttempt(f.declaration),
    ).rejects.toThrow('revision');
    expect(f.state.db).toEqual(before);
    const gate = (await f.recordStore.readCopyGate(f.input.selector))!;
    const again = await f.recordStore.declareCopyAttempt({
      ...f.declaration,
      expectedGateRevision: gate.revision,
    });
    expect(again).toMatchObject({
      attemptId: first.attemptId,
      attemptDefinitionHash: first.attemptDefinitionHash,
      replayed: true,
      gateRevision: 2,
    });
    expect(
      f.state.db.copyRecords.filter((r) => r.row === 'ATTEMPT'),
    ).toHaveLength(1);
  });
  it('shares the gate across historical/staging effects without duplicating initial ordinals', async () => {
    const f = await opened(true),
      first = await f.recordStore.declareCopyAttempt(f.declaration);
    const second = await f.recordStore.declareCopyAttempt({
      ...f.declaration,
      kind: 'HISTORICAL',
      attemptId: f.id(910),
      expectedGateRevision: 1,
    });
    expect(second.gateId).toBe(first.gateId);
    expect(
      f.state.db.copyRecords.filter((r) => r.row === 'ATTEMPT'),
    ).toHaveLength(2);
    const before = structuredClone(f.state.db);
    await expect(
      f.recordStore.declareCopyAttempt({
        ...f.declaration,
        attemptId: f.id(911),
        expectedGateRevision: 2,
      }),
    ).rejects.toThrow('initial attempt');
    expect(f.state.db).toEqual(before);
  });
  it('persists a technical tombstone before opening and never reopens or declares through it', async () => {
    const f = await setup();
    const stopped = await f.recordStore.revokeCopyGate(f.revoke);
    expect(stopped).toMatchObject({
      state: 'REVOKED',
      gateRevision: 0,
      replayed: false,
    });
    const before = structuredClone(f.state.db);
    await expect(f.recordStore.openCopyGate(f.input.selector)).rejects.toThrow(
      'revoked',
    );
    await expect(
      f.recordStore.declareCopyAttempt(f.declaration),
    ).rejects.toThrow('open copy gate');
    expect(f.state.db).toEqual(before);
    expect(f.state.db.controls[0].transferLock).toBeDefined();
    expect(
      await f.recordStore.revokeCopyGate({
        ...f.revoke,
        expectedGateRevision: 0,
      }),
    ).toMatchObject({ state: 'REVOKED', gateRevision: 1, replayed: true });
  });
  it('revokes a current gate with its exact revision while preserving prior INTENDED metadata', async () => {
    const f = await opened();
    await f.recordStore.declareCopyAttempt(f.declaration);
    const attempt = structuredClone(f.state.db.copyRecords[1]);
    await expect(f.recordStore.revokeCopyGate(f.revoke)).rejects.toThrow(
      'revision',
    );
    expect(
      await f.recordStore.revokeCopyGate({
        ...f.revoke,
        expectedGateRevision: 1,
      }),
    ).toMatchObject({ state: 'REVOKED', gateRevision: 2 });
    expect(f.state.db.copyRecords[1]).toEqual(attempt);
    const before = structuredClone(f.state.db);
    await expect(
      f.recordStore.revokeCopyGate({
        ...f.revoke,
        expectedGateRevision: 2,
        evidenceRef: 'test:different',
      }),
    ).rejects.toThrow('cannot be replaced');
    expect(f.state.db).toEqual(before);
  });
  it.each([1, 2, 3, 4, 5, 6])(
    'rolls back every gate/attempt write and fence on declaration write %i failure',
    async (n) => {
      const f = await opened(),
        before = structuredClone(f.state.db);
      f.state.failAtWrite = n;
      await expect(
        f.recordStore.declareCopyAttempt(f.declaration),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.state.db).toEqual(before);
    },
  );
  it.each([1, 2, 3, 4, 5])(
    'rolls back technical tombstone and fences on write %i failure',
    async (n) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.failAtWrite = n;
      await expect(
        f.recordStore.revokeCopyGate(f.revoke),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.state.db).toEqual(before);
    },
  );
  it.each(['requests', 'items', 'claims', 'controls', 'copyRecords'])(
    'refuses a no-op %s fence/CAS without partial attempts',
    async (role) => {
      const f = await opened(),
        before = structuredClone(f.state.db);
      f.state.noOp = `${role}.updateOne`;
      await expect(
        f.recordStore.declareCopyAttempt(f.declaration),
      ).rejects.toThrow('fence');
      expect(f.state.db).toEqual(before);
    },
  );
  it.each(['reply', 'session'])(
    'reconciles %s error after commit using gate metadata and exact declaration replay',
    async (kind) => {
      const f = await opened();
      if (kind === 'reply') f.state.loseReply = true;
      else f.state.endFailure = true;
      await expect(
        f.recordStore.declareCopyAttempt(f.declaration),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.state.db.copyRecords).toHaveLength(2);
      const attempt = structuredClone(f.state.db.copyRecords[1]);
      f.state.endFailure = false;
      const gate = (await f.recordStore.readCopyGate(f.input.selector))!;
      expect(
        await f.recordStore.declareCopyAttempt({
          ...f.declaration,
          expectedGateRevision: gate.revision,
        }),
      ).toMatchObject({ replayed: true, copyDispatch: 'NOT_AUTHORIZED' });
      expect(f.state.db.copyRecords[1]).toEqual(attempt);
    },
  );
  it.each(['epoch', 'claim', 'seal', 'actor', 'intent', 'lease'])(
    'rejects invalidated %s state before writing records',
    async (kind) => {
      const f = await opened();
      if (kind === 'epoch') f.state.db.controls[0].reservationEpoch = 3;
      if (kind === 'claim')
        f.state.db.claims[0].acceptanceOperationId = f.id(90);
      if (kind === 'seal')
        (f.state.db.archives[0].capture as { revision: number }).revision = 4;
      if (kind === 'intent') f.state.db.files[0].historicalCopyIntent = {};
      if (kind === 'lease') f.state.db.files[0].leaseToken = 'foreign';
      const input = structuredClone(f.declaration);
      if (kind === 'actor')
        (input.preparation.selector as { actorId: string }).actorId = f.actorId;
      const before = structuredClone(f.state.db);
      await expect(f.recordStore.declareCopyAttempt(input)).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
    },
  );
  it.each(['state', 'hash', 'binding', 'identityIds', 'extra', 'revision'])(
    'rejects a corrupt gate %s without repair',
    async (kind) => {
      const f = await opened(),
        raw = f.state.db.copyRecords[0];
      if (kind === 'state') raw.state = 'AUTHORIZED';
      if (kind === 'hash') raw.definitionHash = 'b'.repeat(64);
      if (kind === 'binding')
        (raw.binding as Record<string, unknown>).itemId = f.id(90);
      if (kind === 'identityIds') raw.identityIds = [];
      if (kind === 'extra') raw.remoteClosed = true;
      if (kind === 'revision') raw.revision = -1;
      const before = structuredClone(f.state.db);
      await expect(
        f.recordStore.readCopyGate(f.input.selector),
      ).rejects.toThrow();
      await expect(
        f.recordStore.declareCopyAttempt(f.declaration),
      ).rejects.toThrow();
      expect(f.state.db).toEqual(before);
    },
  );
  it.each(['SDK_RETRY', 'APPLICATION_RETRY'])(
    'rejects %s and caller-provided permission references without inventing a grant',
    async (origin) => {
      const f = await opened(),
        before = structuredClone(f.state.db);
      await expect(
        Promise.resolve().then(() =>
          f.recordStore.declareCopyAttempt({
            ...f.declaration,
            origin,
            previous: { authorizationId: f.id(920) },
          } as never),
        ),
      ).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
    },
  );
  it('rejects an injected authorized attempt instead of adopting its permission', async () => {
    const f = await opened();
    await f.recordStore.declareCopyAttempt(f.declaration);
    f.state.db.copyRecords[1].state = 'AUTHORIZED';
    f.state.db.copyRecords[1].authorizationId = f.id(920);
    const before = structuredClone(f.state.db);
    await expect(
      f.recordStore.declareCopyAttempt({
        ...f.declaration,
        expectedGateRevision: 1,
      }),
    ).rejects.toThrow('record identity');
    expect(f.state.db).toEqual(before);
  });
  it('prevents identity aliases between technical revocation and an intended attempt', async () => {
    const f = await opened();
    await f.recordStore.declareCopyAttempt(f.declaration);
    const before = structuredClone(f.state.db);
    await expect(
      f.recordStore.revokeCopyGate({
        ...f.revoke,
        requestId: f.declaration.attemptId,
        expectedGateRevision: 1,
      }),
    ).rejects.toThrow('already been used');
    expect(f.state.db).toEqual(before);
  });
  it.each(['missing', 'indexes', 'connection', 'provider'])(
    'requires dedicated record %s preflight without DDL or fallback',
    async (kind) => {
      const f = await setup();
      if (kind === 'missing')
        f.state.missingCollection = ITEM_COPY_RECORD_COLLECTION;
      if (kind === 'indexes') f.state.badIndex = ITEM_COPY_RECORD_COLLECTION;
      if (kind === 'connection') f.models[14].db = { ...f.connection };
      const store = kind === 'provider' ? f.store : f.recordStore;
      await expect(store.openCopyGate(f.input.selector)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.state.writes).toBe(0);
    },
  );
  it('does not overflow a technical gate revision or reset its identity', async () => {
    const f = await opened();
    f.state.db.copyRecords[0].revision = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(f.state.db);
    await expect(
      f.recordStore.openCopyGate(f.input.selector),
    ).rejects.toThrow();
    expect(f.state.db).toEqual(before);
  });
  it('captures input pins before transaction awaits', async () => {
    const f = await opened(),
      input = structuredClone(f.declaration);
    const result = f.recordStore.declareCopyAttempt(input);
    (input.preparation as { bucket: string }).bucket = 'mutated-bucket';
    (input as { attemptId: string }).attemptId = f.id(990);
    expect((await result).attemptId).toBe(f.declaration.attemptId);
  });
  it('rejects a synthetic conflict at commit without leaving gate or fences', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    f.state.beforeCommit = () => {
      f.state.epoch++;
    };
    await expect(
      f.recordStore.openCopyGate(f.input.selector),
    ).rejects.toMatchObject({ status: 503 });
    expect(f.state.db).toEqual(before);
  });
  it('declares only bounded rows and explicit indexes, without authorization state, TTL or startup DDL', () => {
    expect(ItemCopyRecordSchema.get('autoCreate')).toBe(false);
    expect(ItemCopyRecordSchema.get('autoIndex')).toBe(false);
    expect(ItemCopyRecordSchema.get('strict')).toBe('throw');
    expect(ItemCopyRecordSchema.indexes()).toHaveLength(4);
    expect(ItemCopyRecordSchema.path('state').options.enum).not.toContain(
      'AUTHORIZED',
    );
    expect(
      ItemCopyRecordSchema.indexes().some(
        ([, options]) => options.expireAfterSeconds !== undefined,
      ),
    ).toBe(false);
    expect(
      ItemCopyRecordSchema.path('identityIds').options.default,
    ).toBeUndefined();
    expect(
      Object.getOwnPropertyNames(MongoTransferItemCapture.prototype),
    ).not.toContain('authorizeCopyAttempt');
  });
});
