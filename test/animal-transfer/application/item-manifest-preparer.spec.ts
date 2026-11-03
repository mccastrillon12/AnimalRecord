import { ItemManifestObserver } from '../../../src/context/animal-transfer/application/item-manifest-observer';
import { ItemManifestPreparer } from '../../../src/context/animal-transfer/application/item-manifest-preparer';
import { OwnershipArchiveSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { itemManifestFixture } from '../fixtures/item-manifest.fixture';

async function setup(count = 3, files = true) {
  const t = await itemManifestFixture(count, files);
  const observer = new ItemManifestObserver(t.f.store, t.keyFromUrl);
  const observed = jest.spyOn(observer, 'observe');
  const pages = jest.spyOn(t.f.store, 'readManifestPage');
  const preparer = new ItemManifestPreparer(t.f.store, observer);
  return { ...t, observer, observed, pages, preparer };
}
describe('Observed manifest preparation on simulated Mongo, no infrastructure or permissions', () => {
  it('persists only the observed digest and the four original fences in one transaction', async () => {
    const t = await setup(),
      before = structuredClone(t.f.state.db),
      expected = t.complete();
    const receipt = await t.preparer.prepare(t.input);
    expect(receipt).toEqual({
      transferId: t.input.selector.transferId,
      itemId: t.input.selector.itemId,
      archiveId: t.archive.id,
      manifestHash: expected.manifestHash,
      entryCount: 3,
      fileCount: 3,
      replayed: false,
      reservation: 'FENCED_AT_PREPARATION',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    const header = t.f.state.db.archives[0];
    expect(header).toEqual({ ...before.archives[0], manifestDigest: expected });
    expect((header.manifestDigest as { reservation: string }).reservation).toBe(
      'OBSERVED_ONLY',
    );
    const writes = t.f.calls.filter((c) => c.method === 'updateOne');
    expect(writes.map((c) => c.role)).toEqual([
      'requests',
      'items',
      'claims',
      'controls',
      'archives',
    ]);
    expect(writes.every((c) => c.session === t.f.sessions.at(-1))).toBe(true);
    expect(Object.keys(writes.at(-1)!.update!.$set as object)).toEqual([
      'manifestDigest',
    ]);
    expect(writes.at(-1)!.filter).toMatchObject({
      id: t.archive.id,
      definitionHash: t.archive.definitionHash,
      'reservation.epoch': 1,
      'reservation.bindingHash':
        expected.binding.observedSeal.reservationBindingHash,
      'capture.phase': 'COMPLETE',
      'capture.revision': 3,
      'capture.entryCount': 3,
      expectedEntryCount: 3,
      expectedFileCount: 3,
      manifestDigest: { $exists: false },
      evidenceConsumption: { $exists: false },
    });
    expect(
      t.f.calls
        .filter((c) => c.role === 'entries' || c.role === 'files')
        .every((c) => c.session !== t.f.sessions.at(-1)),
    ).toBe(true);
    for (const role of [
      'animals',
      'periods',
      'entries',
      'files',
      'events',
    ] as const)
      expect(t.f.state.db[role]).toEqual(before[role]);
    expect(t.f.state.db.requests[0].version).toBe(2);
    expect(t.f.state.db.items[0].status).toBe('PROCESSING');
    expect(t.f.capture.captureBatch).not.toHaveBeenCalled();
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(JSON.stringify(receipt)).not.toMatch(
      /users\/|payload|Brownie|leaseToken|sourceKey|sha256/,
    );
  });
  it('probes an empty slot without fences, row reads or fabricated evidence', async () => {
    const t = await setup(),
      before = structuredClone(t.f.state.db);
    expect(await t.f.store.resumeManifestDigest(t.input)).toBeNull();
    expect(t.f.state.db).toEqual(before);
    expect(t.f.state.writes).toBe(0);
    expect(t.pages).not.toHaveBeenCalled();
  });
  it('propagates observer failure without writing a fence or a partial digest', async () => {
    const t = await setup(),
      before = structuredClone(t.f.state.db),
      failure = new Error('Observer failed');
    t.observed.mockRejectedValueOnce(failure);
    await expect(t.preparer.prepare(t.input)).rejects.toBe(failure);
    expect(t.f.state.db).toEqual(before);
    expect(t.f.state.writes).toBe(0);
  });
  it.each([
    'animal_ownership_archive_entries',
    'animal_ownership_archive_files',
  ])(
    'requires %s readiness again after traversal before confirming',
    async (collection) => {
      const t = await setup(),
        original = t.observed.getMockImplementation()!.bind(t.observer);
      t.observed.mockImplementationOnce(async (input) => {
        const result = await original(input);
        t.f.state.missingCollection = collection;
        return result;
      });
      await expect(t.preparer.prepare(t.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(t.f.state.db.archives[0].manifestDigest).toBeUndefined();
      expect(t.f.state.writes).toBe(0);
    },
  );
  it('does not leave a digest or fences if its confirmation snapshot loses before commit', async () => {
    const t = await setup(),
      original = t.observed.getMockImplementation()!.bind(t.observer);
    t.observed.mockImplementationOnce(async (input) => {
      const result = await original(input);
      t.f.state.beforeCommit = () => {
        t.f.state.db.controls[0].reservationEpoch = 3;
        t.f.state.epoch++;
      };
      return result;
    });
    await expect(t.preparer.prepare(t.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(t.f.state.db.archives[0].manifestDigest).toBeUndefined();
    expect(t.f.state.db.requests[0].captureStepRevision).toBeUndefined();
    expect(t.f.state.db.controls[0].reservationEpoch).toBe(3);
  });
  it('replays the same persisted digest with four fences and no new traversal or header replacement', async () => {
    const t = await setup(),
      first = await t.preparer.prepare(t.input);
    const header = structuredClone(t.f.state.db.archives[0]);
    t.observed.mockRejectedValue(new Error('Do not traverse on replay'));
    t.f.calls.length = 0;
    expect(await t.preparer.prepare(t.input)).toEqual({
      ...first,
      replayed: true,
    });
    expect(t.observed).toHaveBeenCalledTimes(1);
    expect(t.pages).toHaveBeenCalledTimes(5);
    expect(t.f.state.db.archives[0]).toEqual(header);
    expect(
      t.f.calls.filter((c) => c.method === 'updateOne').map((c) => c.role),
    ).toEqual(['requests', 'items', 'claims', 'controls']);
  });
  it.each([1, 2, 3, 4, 5])(
    'rolls back the digest and all fences on write %i failure',
    async (n) => {
      const t = await setup(),
        before = structuredClone(t.f.state.db);
      t.f.state.failAtWrite = n;
      await expect(t.preparer.prepare(t.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(t.f.state.db).toEqual(before);
      expect(t.f.state.db.controls[0].transferLock).toBeDefined();
    },
  );
  it.each(['requests', 'items', 'claims', 'controls', 'archives'])(
    'rejects a no-op %s fence/CAS without persisting the digest',
    async (role) => {
      const t = await setup(),
        before = structuredClone(t.f.state.db);
      t.f.state.noOp = `${role}.updateOne`;
      await expect(t.preparer.prepare(t.input)).rejects.toThrow('fence');
      expect(t.f.state.db).toEqual(before);
    },
  );
  it.each(['reply', 'session'] as const)(
    'reconciles %s observation failure after commit without another traversal',
    async (kind) => {
      const t = await setup();
      const original = t.observed.getMockImplementation()!.bind(t.observer);
      t.observed.mockImplementationOnce(async (input) => {
        const result = await original(input);
        if (kind === 'reply') t.f.state.loseReply = true;
        else t.f.state.endFailure = true;
        return result;
      });
      await expect(t.preparer.prepare(t.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(t.f.state.db.archives[0].manifestDigest).toBeDefined();
      const header = structuredClone(t.f.state.db.archives[0]);
      t.f.state.endFailure = false;
      t.observed.mockRejectedValue(
        new Error('Do not refix a committed digest'),
      );
      expect(await t.preparer.prepare(t.input)).toMatchObject({
        replayed: true,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(t.observed).toHaveBeenCalledTimes(1);
      expect(t.f.state.db.archives[0]).toEqual(header);
    },
  );
  it.each([
    'epoch',
    'claim',
    'request',
    'capture',
    'counts',
    'period',
    'consumed',
  ] as const)(
    'revalidates %s after traversal and refuses to persist stale evidence',
    async (kind) => {
      const t = await setup(),
        original = t.observed.getMockImplementation()!.bind(t.observer);
      t.observed.mockImplementationOnce(async (input) => {
        const result = await original(input);
        if (kind === 'epoch') t.f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'claim')
          t.f.state.db.claims[0].acceptanceOperationId = t.f.id(90);
        if (kind === 'request') t.f.state.db.requests[0].version = 3;
        if (kind === 'capture')
          (t.f.state.db.archives[0].capture as { revision: number }).revision++;
        if (kind === 'counts') t.f.state.db.archives[0].expectedFileCount = 4;
        if (kind === 'period') t.f.state.db.periods = [];
        if (kind === 'consumed')
          t.f.state.db.archives[0].evidenceConsumption = {};
        return result;
      });
      await expect(t.preparer.prepare(t.input)).rejects.toThrow();
      expect(t.f.state.db.archives[0].manifestDigest).toBeUndefined();
      expect(t.f.state.writes).toBe(0);
    },
  );
  it('rejects a different valid observation instead of replacing the winning digest', async () => {
    const t = await setup();
    await t.preparer.prepare(t.input);
    // Adversarial fixture mutation, not a supported write to a sealed entry.
    const entry = t.f.state.db.entries[0];
    (entry.payload as Record<string, unknown>).name =
      'Changed after observation';
    entry.contentHash = archiveHash({
      kind: entry.kind,
      payload: entry.payload,
      fileBindings: entry.fileBindings,
    });
    const another = await t.observer.observe(t.input),
      before = structuredClone(t.f.state.db);
    await expect(
      t.f.store.confirmManifestDigest(t.input, another),
    ).rejects.toThrow('cannot be replaced');
    expect(t.f.state.db).toEqual(before);
  });
  it.each(['null', 'empty', 'hash', 'extra'] as const)(
    'blocks %s persisted corruption before invoking the observer',
    async (kind) => {
      const t = await setup();
      await t.preparer.prepare(t.input);
      if (kind === 'null') t.f.state.db.archives[0].manifestDigest = null;
      if (kind === 'empty') t.f.state.db.archives[0].manifestDigest = {};
      const stored = t.f.state.db.archives[0].manifestDigest as Record<
        string,
        unknown
      >;
      if (kind === 'hash') stored.manifestHash = 'b'.repeat(64);
      if (kind === 'extra') stored.canCopy = true;
      const before = structuredClone(t.f.state.db);
      await expect(t.preparer.prepare(t.input)).rejects.toThrow();
      expect(t.observed).toHaveBeenCalledTimes(1);
      expect(t.f.state.db).toEqual(before);
    },
  );
  it.each([
    'binding',
    'hash',
    'counts',
    'permission',
    'extra',
    'emptyEntries',
    'emptyFiles',
    'primitive',
  ] as const)(
    'rejects inconsistent collector %s without writing, even with a recomputed outer hash',
    async (kind) => {
      const t = await setup(),
        raw = structuredClone(await t.observer.observe(t.input));
      const result = raw as unknown as Record<string, unknown>,
        binding = result.binding as Record<string, unknown>;
      if (kind === 'binding') {
        binding.itemId = t.f.id(90);
      }
      if (kind === 'hash') result.manifestHash = 'b'.repeat(64);
      if (kind === 'counts') {
        result.entryCount = 4;
        (binding.observedSeal as Record<string, unknown>).expectedEntryCount =
          4;
      }
      if (kind === 'binding' || kind === 'counts') {
        const identity = { ...binding };
        delete identity.observedSealHash;
        binding.observedSealHash = archiveHash({
          protocol: 'ITEM_COPY_PREPARATION_OBSERVATION_V1',
          ...identity,
        });
      }
      if (kind === 'permission') result.copyDispatch = 'AUTHORIZED';
      if (kind === 'extra') result.payload = { secret: true };
      if (kind === 'emptyEntries')
        result.entriesDigest = archiveHash([
          'ITEM_MANIFEST_DIGEST_V1',
          'ENTRIES',
        ]);
      if (kind === 'emptyFiles')
        result.filesDigest = archiveHash(['ITEM_MANIFEST_DIGEST_V1', 'FILES']);
      if (kind === 'primitive') result.entriesDigest = {};
      if (kind !== 'hash') {
        const definition = { ...result };
        delete definition.manifestHash;
        result.manifestHash = archiveHash(definition);
      }
      const before = structuredClone(t.f.state.db);
      await expect(
        Promise.resolve().then(() =>
          t.f.store.confirmManifestDigest(t.input, raw),
        ),
      ).rejects.toThrow();
      expect(t.f.state.db).toEqual(before);
      expect(t.f.state.writes).toBe(0);
    },
  );
  it('captures detached selector/seal and digest values before awaiting the confirmation', async () => {
    const t = await setup(),
      raw = structuredClone(await t.observer.observe(t.input)),
      input = structuredClone(t.input);
    const expected = raw.manifestHash,
      pending = t.f.store.confirmManifestDigest(input, raw);
    input.selector.itemId = t.f.id(90);
    input.expectedSealHash = 'b'.repeat(64);
    (raw as { manifestHash: string }).manifestHash = 'b'.repeat(64);
    (raw.binding.observedSeal as { archiveId: string }).archiveId = t.f.id(90);
    expect((await pending).manifestHash).toBe(expected);
    expect(t.f.state.db.archives[0].manifestDigest).toMatchObject({
      manifestHash: expected,
    });
  });
  it('rejects a caller JSON proof before probing or observing', async () => {
    const t = await setup(),
      resume = jest.spyOn(t.f.store, 'resumeManifestDigest');
    await expect(
      t.preparer.prepare({ ...t.input, manifestHash: 'a'.repeat(64) } as never),
    ).rejects.toThrow('Invalid');
    expect(resume).not.toHaveBeenCalled();
    expect(t.observed).not.toHaveBeenCalled();
  });
  it.each(['COPYING', 'READY'] as const)(
    'persists zero-file integrity for %s without claiming copy or business completion',
    async (state) => {
      const t = await setup(1, false);
      t.f.state.db.archives[0].state = state;
      const result = await t.preparer.prepare(t.input);
      expect(result).toMatchObject({
        fileCount: 0,
        replayed: false,
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(await t.preparer.prepare(t.input)).toEqual({
        ...result,
        replayed: true,
      });
      expect(t.f.state.db.archives[0].state).toBe(state);
    },
  );
  it('keeps observe read-only and permits existing historical preparation without changing the immutable digest', async () => {
    const t = await setup(),
      first = await t.preparer.prepare(t.input);
    const digest = structuredClone(t.f.state.db.archives[0].manifestDigest);
    t.f.state.writes = 0;
    expect((await t.observer.observe(t.input)).manifestHash).toBe(
      first.manifestHash,
    );
    expect(t.f.state.writes).toBe(0);
    await t.f.service.prepareHistoricalCopy({
      ...t.f.input,
      expectedSealHash: t.input.expectedSealHash,
    });
    expect(t.f.state.db.archives[0].manifestDigest).toEqual(digest);
    expect(await t.preparer.prepare(t.input)).toEqual({
      ...first,
      replayed: true,
    });
  });
  it('keeps the header field optional, without default, index or definition-hash migration', () => {
    expect(
      OwnershipArchiveSchema.path('manifestDigest').options.default,
    ).toBeUndefined();
    expect(
      OwnershipArchiveSchema.indexes().some(([key]) => 'manifestDigest' in key),
    ).toBe(false);
  });
});
