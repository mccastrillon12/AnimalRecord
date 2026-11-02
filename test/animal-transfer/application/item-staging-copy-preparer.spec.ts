import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ItemStagingCopyPreparer } from '../../../src/context/animal-transfer/application/item-staging-copy-preparer';
import { ItemHistoricalCopyObserver } from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import { ItemHistoricalObjectReader } from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { OwnershipArchiveFileSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { ExternalServiceError } from '../../../src/context/shared/domain/errors/ExternalServiceError';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

async function setup() {
  const f = await historicalCopyPreparationFixture();
  const bytes = Buffer.from('animal-bytes');
  f.input.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  await f.service.prepareHistoricalCopy(f.input);
  const remote = {
    versionId: 'history-v1',
    heads: 0,
    beforeConfirm: undefined as (() => void) | undefined,
  };
  const revision = () => ({
    etag: 'history',
    size: bytes.byteLength,
    versionId: remote.versionId,
  });
  const head: ItemHistoricalObjectReader['head'] = jest.fn((target) => {
    expect(f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
    remote.heads++;
    if (remote.heads % 2 === 0) remote.beforeConfirm?.();
    return Promise.resolve({ ...target, ...revision() });
  });
  const read: ItemHistoricalObjectReader['read'] = jest.fn(() => {
    const body = Readable.from([bytes]);
    return Promise.resolve({
      revision: revision(),
      body,
      close: () => {
        body.destroy();
      },
    });
  });
  const observer = new ItemHistoricalCopyObserver(f.store, { head, read });
  const observed = jest.spyOn(observer, 'observe');
  const preparer = new ItemStagingCopyPreparer(f.store, observer);
  f.calls.length = 0;
  f.state.writes = 0;
  return { ...f, preparer, observer, observed, head, read, remote };
}

describe('Atomic historical observation and staging preparation, simulated Mongo and streams only', () => {
  it('records both immutable fields with the original decision/control fences in one transaction', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    const result = await f.preparer.prepare(f.input);
    const file = f.state.db.files[0];
    expect(result).toMatchObject({
      replayed: false,
      observationHash: expect.any(String) as unknown,
      reservation: 'FENCED_AT_PREPARATION',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(file).toMatchObject({
      state: 'PENDING',
      historicalCopyIntent: before.files[0].historicalCopyIntent,
      historicalByteObservation: {
        observationHash: result.observationHash,
        bytes: 'MATCH',
      },
      stagingCopyIntent: {
        kind: 'RECIPIENT_STAGING',
        id: result.intentId,
        definitionHash: result.intentDefinitionHash,
        source: {
          key: before.files[0].historicalKey,
          revision: { versionId: 'history-v1' },
        },
        destination: {
          key: before.files[0].recipientStagingKey,
          ifNoneMatch: '*',
        },
        predecessor: { observationHash: result.observationHash },
        copyDispatch: 'NOT_AUTHORIZED',
      },
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
    expect(Object.keys(writes.at(-1)!.update!.$set as object)).toEqual([
      'historicalByteObservation',
      'stagingCopyIntent',
    ]);
    expect(f.observed).toHaveBeenCalledTimes(1);
    expect(f.state.db.requests[0].version).toBe(2);
    for (const role of ['animals', 'periods', 'archives', 'events'] as const)
      expect(f.state.db[role]).toEqual(before[role]);
    expect(file.leaseToken).toBeUndefined();
    expect(file.verified).toBeUndefined();
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /sourceKey|bucket|sha256|https:|leaseToken/,
    );
  });
  it('probes an unprepared slot without writes or fabricated evidence', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    expect(await f.store.resumeStagingCopy(f.input)).toBeNull();
    expect(f.state.db).toEqual(before);
    expect(f.state.writes).toBe(0);
    expect(f.head).not.toHaveBeenCalled();
  });
  it('replays a complete pair without reading objects again or replacing either field', async () => {
    const f = await setup(),
      first = await f.preparer.prepare(f.input);
    const file = structuredClone(f.state.db.files[0]);
    f.observed.mockRejectedValue(new Error('Replay must not observe again'));
    f.calls.length = 0;
    expect(await f.preparer.prepare(f.input)).toEqual({
      ...first,
      replayed: true,
    });
    expect(f.observed).toHaveBeenCalledTimes(1);
    expect(f.state.db.files[0]).toEqual(file);
    expect(
      f.calls.filter((c) => c.method === 'updateOne').map((c) => c.role),
    ).toEqual(['requests', 'items', 'claims', 'controls']);
  });
  it.each([1, 2, 3, 4, 5])(
    'rolls back both fields and every fence on write %i failure',
    async (n) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.failAtWrite = n;
      await expect(f.preparer.prepare(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.state.db).toEqual(before);
      expect(f.state.db.controls[0].transferLock).toBeDefined();
    },
  );
  it.each(['requests', 'items', 'claims', 'controls', 'files'])(
    'rejects a no-op %s CAS without leaving a partial pair',
    async (role) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.noOp = `${role}.updateOne`;
      await expect(f.preparer.prepare(f.input)).rejects.toThrow('fence');
      expect(f.state.db).toEqual(before);
    },
  );
  it.each(['reply', 'session'])(
    'reconciles %s failure after commit through metadata replay with no new object read',
    async (kind) => {
      const f = await setup();
      f.remote.beforeConfirm = () => {
        if (kind === 'reply') f.state.loseReply = true;
        else f.state.endFailure = true;
      };
      await expect(f.preparer.prepare(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.state.db.files[0].stagingCopyIntent).toBeDefined();
      const file = structuredClone(f.state.db.files[0]);
      f.state.endFailure = false;
      f.observed.mockRejectedValue(
        new Error('Do not refix a committed preparation'),
      );
      expect(await f.preparer.prepare(f.input)).toMatchObject({
        replayed: true,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(f.state.db.files[0]).toEqual(file);
      expect(f.observed).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects a new observed revision instead of replacing the persisted pair', async () => {
    const f = await setup();
    await f.preparer.prepare(f.input);
    f.remote.versionId = 'history-v2';
    const another = await f.observer.observe(f.input);
    const before = structuredClone(f.state.db);
    await expect(
      f.store.confirmHistoricalObservation(f.input, another),
    ).rejects.toThrow('cannot be replaced');
    expect(f.state.db).toEqual(before);
  });
  it.each([
    'missingObservation',
    'missingIntent',
    'nullObservation',
    'corruptIntent',
  ])(
    'keeps a %s pair blocked without invoking the object reader',
    async (kind) => {
      const f = await setup();
      await f.preparer.prepare(f.input);
      if (kind === 'missingObservation')
        delete f.state.db.files[0].historicalByteObservation;
      if (kind === 'missingIntent')
        delete f.state.db.files[0].stagingCopyIntent;
      if (kind === 'nullObservation')
        f.state.db.files[0].historicalByteObservation = null;
      if (kind === 'corruptIntent') f.state.db.files[0].stagingCopyIntent = {};
      const before = structuredClone(f.state.db),
        calls = f.observed.mock.calls.length;
      await expect(f.preparer.prepare(f.input)).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.observed).toHaveBeenCalledTimes(calls);
    },
  );
  it.each(['epoch', 'claim', 'period', 'historical', 'stale'])(
    'revalidates %s after byte I/O and refuses to persist stale evidence',
    async (kind) => {
      const f = await setup();
      f.remote.beforeConfirm = () => {
        if (kind === 'epoch') f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'claim')
          f.state.db.claims[0].acceptanceOperationId = f.id(90);
        if (kind === 'period') f.state.db.periods[0].status = 'CLOSED';
        if (kind === 'historical')
          f.state.db.files[0].historicalCopyIntent = {};
        if (kind === 'stale')
          (f.state.db.archives[0].capture as { revision: number }).revision = 4;
      };
      await expect(f.preparer.prepare(f.input)).rejects.toThrow();
      expect(f.state.db.files[0].historicalByteObservation).toBeUndefined();
      expect(f.state.db.files[0].stagingCopyIntent).toBeUndefined();
      expect(f.state.writes).toBe(0);
    },
  );
  it.each([
    'binding',
    'hash',
    'intent',
    'key',
    'digest',
    'revision',
    'permission',
    'extra',
  ])(
    'denies a mismatched collector observation %s without writing',
    async (kind) => {
      const f = await setup();
      const raw = structuredClone(await f.observer.observe(f.input));
      const observation = raw as unknown as Record<string, unknown>;
      const binding = observation.binding as Record<string, unknown>;
      const payload = observation.observation as Record<string, unknown>;
      if (kind === 'binding') binding.itemId = f.id(90);
      if (kind === 'hash') observation.observationHash = 'b'.repeat(64);
      if (kind === 'intent') payload.intentDefinitionHash = 'b'.repeat(64);
      if (kind === 'key') payload.key = f.state.db.files[0].recipientStagingKey;
      if (kind === 'digest') payload.sha256 = 'b'.repeat(64);
      if (kind === 'revision')
        (payload.revision as Record<string, unknown>).size = 13;
      if (kind === 'permission') observation.copyDispatch = 'AUTHORIZED';
      if (kind === 'extra') observation.allowCopy = true;
      if (kind !== 'hash') observation.observationHash = archiveHash(payload);
      const before = structuredClone(f.state.db);
      await expect(
        Promise.resolve().then(() =>
          f.store.confirmHistoricalObservation(f.input, raw),
        ),
      ).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
    },
  );
  it('rejects a public MATCH payload and propagates read failure without saving evidence', async () => {
    const f = await setup();
    await expect(
      f.preparer.prepare({
        ...f.input,
        observation: { bytes: 'MATCH' },
      } as never),
    ).rejects.toThrow('Invalid');
    expect(f.observed).not.toHaveBeenCalled();
    f.observed.mockRejectedValue(new ExternalServiceError('Read failed'));
    await expect(f.preparer.prepare(f.input)).rejects.toThrow('Read failed');
    expect(f.state.writes).toBe(0);
  });
  it('captures observation values before awaiting the transaction', async () => {
    const f = await setup();
    const observation = structuredClone(await f.observer.observe(f.input));
    const expected = observation.observationHash;
    const result = f.store.confirmHistoricalObservation(f.input, observation);
    (observation as unknown as { observationHash: string }).observationHash =
      'b'.repeat(64);
    (observation.observation.revision as { etag: string }).etag = 'mutated';
    expect((await result).observationHash).toBe(expected);
    expect(f.state.db.files[0].historicalByteObservation).toMatchObject({
      observationHash: expected,
    });
  });
  it('does not revive a missing historical intent or create a lease for staging', async () => {
    const f = await setup();
    delete f.state.db.files[0].historicalCopyIntent;
    await expect(f.preparer.prepare(f.input)).rejects.toThrow(
      'persisted historical',
    );
    expect(f.observed).not.toHaveBeenCalled();
    expect(f.state.writes).toBe(0);
  });
  it('keeps staging fields optional with no defaults or new indexes', () => {
    for (const field of ['historicalByteObservation', 'stagingCopyIntent']) {
      expect(
        OwnershipArchiveFileSchema.path(field).options.default,
      ).toBeUndefined();
      expect(
        OwnershipArchiveFileSchema.indexes().some(([key]) => field in key),
      ).toBe(false);
    }
  });
});
