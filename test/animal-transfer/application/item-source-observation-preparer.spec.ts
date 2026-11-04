import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ItemSourceObservationPreparer } from '../../../src/context/animal-transfer/application/item-source-observation-preparer';
import { ItemStagingCopyPreparer } from '../../../src/context/animal-transfer/application/item-staging-copy-preparer';
import { ItemHistoricalCopyObserver } from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import {
  ItemHistoricalObjectReader,
  captureSourceByteObservation,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import {
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { captureItemArchiveFileDefinition } from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import { OwnershipArchiveFileSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { ExternalServiceError } from '../../../src/context/shared/domain/errors/ExternalServiceError';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

async function setup(versioned = true) {
  const f = await historicalCopyPreparationFixture();
  const bytes = Buffer.from('animal-bytes');
  const file = f.state.db.files[0] as unknown as ArchiveFile;
  const archive = f.state.db.archives.find(
    (a) => a.id === file.archiveId,
  )! as unknown as OwnershipArchive;
  if (!versioned) {
    const definition = captureItemArchiveFileDefinition(archive, file);
    file.source = { etag: file.source.etag, size: file.source.size };
    file.definitionHash = archiveHash({ ...definition, source: file.source });
    f.input.expectedFileDefinitionHash = file.definitionHash;
  }
  f.input.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  await f.service.prepareHistoricalCopy(f.input);
  const remote = {
    heads: 0,
    beforeConfirm: undefined as (() => void) | undefined,
  };
  const revision = (key: string) =>
    key === file.sourceKey
      ? file.source
      : {
          etag: 'history',
          size: bytes.byteLength,
          versionId: 'history-v1',
        };
  const bodies: Readable[] = [];
  const head: ItemHistoricalObjectReader['head'] = jest.fn((target) => {
    expect(f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
    remote.heads++;
    if (remote.heads % 2 === 0) remote.beforeConfirm?.();
    return Promise.resolve({ ...target, ...revision(target.key) });
  });
  const read: ItemHistoricalObjectReader['read'] = jest.fn((target) => {
    const body = Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]);
    bodies.push(body);
    return Promise.resolve({
      revision: revision(target.key),
      body,
      close: () => {
        body.destroy();
      },
    });
  });
  const observer = new ItemHistoricalCopyObserver(f.store, { head, read });
  const observed = jest.spyOn(observer, 'observeSource');
  const preparer = new ItemSourceObservationPreparer(f.store, observer);
  f.calls.length = 0;
  f.state.writes = 0;
  return { ...f, preparer, observer, observed, head, read, remote, bodies };
}

describe('Source observation persistence under the original reservation, doubles only', () => {
  it.each([true, false])(
    'records the original source observation and fences atomically (versioned=%s)',
    async (versioned) => {
      const f = await setup(versioned),
        before = structuredClone(f.state.db);
      const result = await f.preparer.prepare(f.input);
      const file = f.state.db.files[0];
      expect(result).toMatchObject({
        replayed: false,
        observationHash: expect.any(String) as unknown,
        intentId: (file.historicalCopyIntent as { id: string }).id,
        reservation: 'FENCED_AT_PREPARATION',
        provenance: 'NOT_ASSESSED',
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(file).toMatchObject({
        state: 'PENDING',
        definitionHash: before.files[0].definitionHash,
        historicalCopyIntent: before.files[0].historicalCopyIntent,
        sourceByteObservation: {
          protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1',
          bytes: 'MATCH',
          observationHash: result.observationHash,
          reservation: 'OBSERVED_ONLY',
          observation: {
            key: before.files[0].sourceKey,
            revision: before.files[0].source,
            sha256: f.input.sourceSha256,
          },
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
      expect(writes.at(-1)!.update!.$set).toEqual({
        sourceByteObservation: file.sourceByteObservation,
      });
      for (const role of ['animals', 'periods', 'archives', 'events'] as const)
        expect(f.state.db[role]).toEqual(before[role]);
      for (const field of [
        'historicalByteObservation',
        'stagingCopyIntent',
        'leaseToken',
        'verified',
        'materialization',
      ])
        expect(file[field]).toBeUndefined();
      expect(f.state.db.requests[0].version).toBe(2);
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      expect(f.bodies[0].destroyed).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(
        /sourceKey|bucket|sha256|https:|leaseToken/,
      );
    },
  );
  it('probes an absent observation without fences or object reads', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    expect(await f.store.resumeSourceObservation(f.input)).toBeNull();
    expect(f.state.db).toEqual(before);
    expect(f.state.writes).toBe(0);
    expect(f.head).not.toHaveBeenCalled();
  });
  it('replays only persisted metadata without another object read or file replacement', async () => {
    const f = await setup(),
      first = await f.preparer.prepare(f.input);
    const file = structuredClone(f.state.db.files[0]);
    f.observed.mockRejectedValue(new Error('No repeated source read'));
    f.calls.length = 0;
    expect(await f.preparer.prepare(f.input)).toEqual({
      ...first,
      replayed: true,
    });
    expect(f.state.db.files[0]).toEqual(file);
    expect(f.observed).toHaveBeenCalledTimes(1);
    expect(
      f.calls.filter((c) => c.method === 'updateOne').map((c) => c.role),
    ).toEqual(['requests', 'items', 'claims', 'controls']);
  });
  it.each([1, 2, 3, 4, 5])(
    'rolls back evidence and all fences on write %i failure',
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
    'rejects a no-op %s CAS without committing evidence',
    async (role) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.noOp = `${role}.updateOne`;
      await expect(f.preparer.prepare(f.input)).rejects.toThrow('fence');
      expect(f.state.db).toEqual(before);
    },
  );
  it.each(['reply', 'session'])(
    'reconciles application %s failure after commit without reading source again',
    async (kind) => {
      const f = await setup();
      f.remote.beforeConfirm = () => {
        if (kind === 'reply') f.state.loseReply = true;
        else f.state.endFailure = true;
      };
      await expect(f.preparer.prepare(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.state.db.files[0].sourceByteObservation).toBeDefined();
      const file = structuredClone(f.state.db.files[0]);
      f.state.endFailure = false;
      f.observed.mockRejectedValue(
        new Error('Do not refix committed observation'),
      );
      expect(await f.preparer.prepare(f.input)).toMatchObject({
        replayed: true,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(f.state.db.files[0]).toEqual(file);
      expect(f.observed).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    'epoch',
    'claim',
    'period',
    'intent',
    'stale',
    'state',
    'lease',
    'source',
  ])(
    'revalidates %s after object I/O before writing evidence',
    async (kind) => {
      const f = await setup();
      f.remote.beforeConfirm = () => {
        if (kind === 'epoch') f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'claim')
          f.state.db.claims[0].acceptanceOperationId = f.id(90);
        if (kind === 'period') f.state.db.periods[0].status = 'CLOSED';
        if (kind === 'intent') f.state.db.files[0].historicalCopyIntent = {};
        if (kind === 'stale')
          (f.state.db.archives[0].capture as { revision: number }).revision = 4;
        if (kind === 'state') f.state.db.files[0].state = 'COPYING';
        if (kind === 'lease') f.state.db.files[0].leaseToken = 'foreign';
        if (kind === 'source')
          (f.state.db.files[0].source as { etag: string }).etag = 'foreign';
      };
      await expect(f.preparer.prepare(f.input)).rejects.toThrow();
      expect(f.state.db.files[0].sourceByteObservation).toBeUndefined();
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
    'version',
    'protocol',
    'permission',
    'extra',
  ])(
    'refuses mismatched collector %s even with a recomputed observation hash',
    async (kind) => {
      const f = await setup();
      const raw = structuredClone(await f.observer.observeSource(f.input));
      const copy = raw as unknown as Record<string, unknown>;
      const binding = copy.binding as Record<string, unknown>;
      const payload = copy.observation as Record<string, unknown>;
      if (kind === 'binding') binding.itemId = f.id(90);
      if (kind === 'hash') copy.observationHash = 'b'.repeat(64);
      if (kind === 'intent') payload.intentDefinitionHash = 'b'.repeat(64);
      if (kind === 'key') payload.key = f.state.db.files[0].historicalKey;
      if (kind === 'digest') payload.sha256 = 'b'.repeat(64);
      if (kind === 'revision')
        (payload.revision as Record<string, unknown>).etag = 'new';
      if (kind === 'version')
        delete (payload.revision as Record<string, unknown>).versionId;
      if (kind === 'protocol')
        copy.protocol = 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1';
      if (kind === 'permission') copy.copyDispatch = 'AUTHORIZED';
      if (kind === 'extra') copy.allowCopy = true;
      if (kind !== 'hash') copy.observationHash = archiveHash(payload);
      const before = structuredClone(f.state.db);
      await expect(
        Promise.resolve().then(() =>
          f.store.confirmSourceObservation(f.input, raw),
        ),
      ).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
    },
  );
  it.each(['null', 'hash', 'orphan', 'digest'])(
    'blocks persisted %s evidence without repair or object reads',
    async (kind) => {
      const f = await setup();
      await f.preparer.prepare(f.input);
      if (kind === 'null') f.state.db.files[0].sourceByteObservation = null;
      if (kind === 'orphan') delete f.state.db.files[0].historicalCopyIntent;
      const stored = f.state.db.files[0].sourceByteObservation as Record<
        string,
        unknown
      >;
      if (kind === 'hash') stored.observationHash = 'b'.repeat(64);
      if (kind === 'digest') {
        (stored.observation as Record<string, unknown>).sha256 = 'b'.repeat(64);
        stored.observationHash = archiveHash(stored.observation);
      }
      const before = structuredClone(f.state.db),
        calls = f.observed.mock.calls.length;
      await expect(f.preparer.prepare(f.input)).rejects.toThrow();
      await expect(f.service.prepareHistoricalCopy(f.input)).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.observed).toHaveBeenCalledTimes(calls);
    },
  );
  it('does not reconstruct a missing historical intent to observe source bytes', async () => {
    const f = await setup();
    delete f.state.db.files[0].historicalCopyIntent;
    await expect(f.preparer.prepare(f.input)).rejects.toThrow(
      'persisted historical',
    );
    expect(f.observed).not.toHaveBeenCalled();
    expect(f.state.writes).toBe(0);
  });
  it('captures caller and collector values before any transaction await', async () => {
    const f = await setup(),
      originalInput = structuredClone(f.input);
    const observation = structuredClone(
      await f.observer.observeSource(f.input),
    );
    const expected = observation.observationHash;
    const result = f.store.confirmSourceObservation(f.input, observation);
    (observation as unknown as { observationHash: string }).observationHash =
      'b'.repeat(64);
    (observation.observation.revision as { etag: string }).etag = 'mutated';
    f.input.bucket = 'mutated-bucket';
    f.input.selector.itemId = f.id(90);
    expect(await result).toMatchObject({
      itemId: originalInput.selector.itemId,
      observationHash: expected,
    });
    const stored = captureSourceByteObservation(
      f.state.db.files[0].sourceByteObservation as never,
    );
    expect(stored.observation.bucket).toBe(originalInput.bucket);
    expect(Object.isFrozen(stored.observation.revision)).toBe(true);
  });
  it('rejects MATCH input and preserves object-read errors without saving evidence', async () => {
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
    expect(f.state.db.files[0].sourceByteObservation).toBeUndefined();
  });
  it.each([true, false])(
    'preserves historical/staging contracts in either order (sourceFirst=%s)',
    async (sourceFirst) => {
      const f = await setup(),
        staging = new ItemStagingCopyPreparer(f.store, f.observer);
      if (sourceFirst) await f.preparer.prepare(f.input);
      const receipt = await staging.prepare(f.input);
      const historical = structuredClone(
        f.state.db.files[0].historicalByteObservation,
      );
      const intent = structuredClone(f.state.db.files[0].stagingCopyIntent);
      await f.preparer.prepare(f.input);
      expect(await staging.prepare(f.input)).toEqual({
        ...receipt,
        replayed: true,
      });
      expect(f.state.db.files[0].historicalByteObservation).toEqual(historical);
      expect(f.state.db.files[0].stagingCopyIntent).toEqual(intent);
      expect(f.state.db.files[0].sourceByteObservation).toBeDefined();
    },
  );
  it('rejects a synthetic write conflict at commit without leaking evidence or fences', async () => {
    const f = await setup(),
      observation = await f.observer.observeSource(f.input);
    const before = structuredClone(f.state.db);
    f.state.beforeCommit = () => {
      f.state.epoch++;
    };
    await expect(
      f.store.confirmSourceObservation(f.input, observation),
    ).rejects.toMatchObject({ status: 503 });
    expect(f.state.db).toEqual(before);
  });
  it('revalidates invalidation even when the observation is already persisted', async () => {
    const f = await setup();
    await f.preparer.prepare(f.input);
    f.state.db.controls[0].reservationEpoch = 3;
    const before = structuredClone(f.state.db);
    await expect(f.preparer.prepare(f.input)).rejects.toThrow();
    expect(f.state.db).toEqual(before);
    expect(f.observed).toHaveBeenCalledTimes(1);
  });
  it('keeps the optional evidence outside immutable definitions and schema defaults/indexes', async () => {
    const f = await setup();
    const context = await f.store.readHistoricalCopy(f.input);
    const before = captureItemArchiveFileDefinition(
      context.snapshot.archive!,
      context.file,
    );
    await f.preparer.prepare(f.input);
    const current = await f.store.readHistoricalCopy(f.input);
    expect(
      captureItemArchiveFileDefinition(current.snapshot.archive!, current.file),
    ).toEqual(before);
    expect(
      OwnershipArchiveFileSchema.path('sourceByteObservation').options.default,
    ).toBeUndefined();
    expect(
      OwnershipArchiveFileSchema.indexes().some(
        ([key]) => 'sourceByteObservation' in key,
      ),
    ).toBe(false);
  });
});
