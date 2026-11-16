import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ItemHistoricalCopyObserver } from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import { ItemStagingCopyPreparer } from '../../../src/context/animal-transfer/application/item-staging-copy-preparer';
import { ItemSourceObservationPreparer } from '../../../src/context/animal-transfer/application/item-source-observation-preparer';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  buildItemStagingCopyIntent,
  captureItemArchiveFileDefinition,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  ItemHistoricalObjectReader,
  HistoricalReadTarget,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { OwnershipArchiveFileSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../src/context/shared/domain/errors/ExternalServiceError';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

async function setup(versioned = true) {
  const f = await historicalCopyPreparationFixture(),
    bytes = Buffer.from('animal-bytes');
  f.input.sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  await f.service.prepareHistoricalCopy(f.input);
  const file = await f.store.readHistoricalCopy(f.input);
  const remote = {
    fault: '',
    heads: 0,
    etag: 'staging',
    versionId: versioned ? 'staging-v1' : undefined,
    beforeHead: undefined as (() => void) | undefined,
    beforeConfirm: undefined as (() => void) | undefined,
  };
  const staged = (target: HistoricalReadTarget) =>
    target.key === file.file.recipientStagingKey;
  const revision = (target: HistoricalReadTarget) =>
    staged(target)
      ? {
          etag: remote.etag,
          size: bytes.byteLength,
          ...(remote.versionId === undefined
            ? {}
            : { versionId: remote.versionId }),
        }
      : target.key === file.file.sourceKey
        ? file.file.source
        : { etag: 'history', size: bytes.byteLength, versionId: 'history-v1' };
  const bodies: Readable[] = [];
  const head = jest.fn((target: HistoricalReadTarget) => {
    expect(f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
    remote.beforeHead?.();
    const value = { ...target, ...revision(target) };
    if (staged(target)) {
      remote.heads++;
      if (remote.fault === 'absent') return Promise.resolve(null);
      if (remote.fault === 'bucket') value.bucket = 'foreign';
      if (remote.fault === 'key') value.key = 'foreign';
      if (remote.fault === 'lateVersion' && remote.heads === 2)
        value.versionId = 'changed';
      if (remote.heads === 2) {
        remote.beforeConfirm?.();
        if (remote.fault === 'afterObservation') remote.versionId = 'later';
      }
    }
    return Promise.resolve(value);
  });
  const close = jest.fn(() => {
    bodies.at(-1)!.destroy();
    if (remote.fault === 'close' || remote.fault === 'digestAndClose')
      throw new Error('private close token');
  });
  const read = jest.fn(
    (
      target: HistoricalReadTarget,
      fixed: { etag: string; size: number; versionId?: string },
    ) => {
      expect(Object.isFrozen(fixed)).toBe(true);
      if (remote.fault === 'unavailable') throw new Error('private read token');
      const content = Buffer.from(bytes);
      if (remote.fault === 'digest' || remote.fault === 'digestAndClose')
        content[0] ^= 1;
      const body =
        remote.fault === 'stream'
          ? Readable.from(
              (function* () {
                yield content.subarray(0, 4);
                throw new Error('private stream token');
              })(),
            )
          : Readable.from([content.subarray(0, 4), content.subarray(4)]);
      bodies.push(body);
      return Promise.resolve({
        revision: {
          ...revision(target),
          ...(remote.fault === 'getRevision' ? { etag: 'foreign' } : {}),
        },
        body,
        close,
      });
    },
  );
  const reader: ItemHistoricalObjectReader = { head, read };
  const observer = new ItemHistoricalCopyObserver(f.store, reader);
  const preparer = new ItemStagingCopyPreparer(f.store, observer);
  await preparer.prepare(f.input); // Persist the historical observation and staging intent; never copy bytes.
  head.mockClear();
  read.mockClear();
  close.mockClear();
  bodies.length = 0;
  const observed = jest.spyOn(observer, 'observeStaging');
  f.calls.length = 0;
  f.state.writes = 0;
  return {
    ...f,
    observer,
    preparer,
    reader,
    head,
    read,
    close,
    remote,
    bodies,
    observed,
  };
}

describe('Staging destination bytes and persisted observation, local doubles only', () => {
  it.each([true, false])(
    'observes only the staging destination of the persisted predecessor chain (versioned=%s)',
    async (versioned) => {
      const f = await setup(versioned),
        before = structuredClone(f.state.db);
      const context = await f.store.readStagingCopy(f.input),
        intent = context.file.stagingCopyIntent!;
      expect(await f.store.resumeStagingObservation(f.input)).toBeNull();
      const result = await f.observer.observeStaging(f.input);
      expect(result).toMatchObject({
        protocol: 'ITEM_STAGING_BYTE_OBSERVATION_V1',
        binding: intent.binding,
        observation: {
          intentId: intent.id,
          intentDefinitionHash: intent.definitionHash,
          bucket: intent.bucket,
          key: intent.destination.key,
          sha256: intent.source.sha256,
          revision: { etag: 'staging', size: 12 },
        },
        bytes: 'MATCH',
        reservation: 'OBSERVED_ONLY',
        provenance: 'NOT_ASSESSED',
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(result.observation.revision.versionId).toBe(
        versioned ? 'staging-v1' : undefined,
      );
      expect(f.head.mock.calls.map(([t]) => t.key)).toEqual([
        intent.destination.key,
        intent.destination.key,
      ]);
      expect(f.read.mock.calls[0]).toEqual([
        { bucket: intent.bucket, key: intent.destination.key },
        result.observation.revision,
      ]);
      expect(result.observationHash).toBe(archiveHash(result.observation));
      expect(Object.isFrozen(result.observation.revision)).toBe(true);
      expect(Object.isFrozen(result.binding.observedSeal)).toBe(true);
      expect(f.bodies[0].destroyed).toBe(true);
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
    },
  );
  it('persists staging evidence with all original fences and leaves predecessors/definitions unchanged', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    const oldContext = await f.store.readStagingCopy(f.input);
    const result = await f.preparer.prepareObservation(f.input);
    const file = f.state.db.files[0];
    expect(result).toMatchObject({
      replayed: false,
      intentId: oldContext.file.stagingCopyIntent!.id,
      reservation: 'FENCED_AT_PREPARATION',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(file).toEqual({
      ...before.files[0],
      stagingByteObservation: expect.objectContaining({
        observationHash: result.observationHash,
        reservation: 'OBSERVED_ONLY',
      }) as unknown,
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
      stagingByteObservation: file.stagingByteObservation,
    });
    const current = await f.store.readStagingCopy(f.input);
    expect(
      captureItemArchiveFileDefinition(current.snapshot.archive!, current.file),
    ).toEqual(
      captureItemArchiveFileDefinition(
        oldContext.snapshot.archive!,
        oldContext.file,
      ),
    );
    for (const role of [
      'animals',
      'periods',
      'archives',
      'entries',
      'events',
    ] as const)
      expect(f.state.db[role]).toEqual(before[role]);
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/bucket|sha256|Key|leaseToken/);
  });
  it.each([
    'missingHistory',
    'missingIntent',
    'corruptHistory',
    'corruptIntent',
    'predecessorHash',
    'historicalIntent',
  ])(
    'blocks a %s predecessor chain before staging I/O or fences',
    async (kind) => {
      const f = await setup();
      if (kind === 'missingHistory')
        delete f.state.db.files[0].historicalByteObservation;
      if (kind === 'missingIntent')
        delete f.state.db.files[0].stagingCopyIntent;
      if (kind === 'corruptHistory')
        f.state.db.files[0].historicalByteObservation = null;
      if (kind === 'corruptIntent') f.state.db.files[0].stagingCopyIntent = {};
      if (kind === 'historicalIntent')
        f.state.db.files[0].historicalCopyIntent = {};
      if (kind === 'predecessorHash') {
        const intent = f.state.db.files[0].stagingCopyIntent as {
          predecessor: { observationHash: string };
        };
        intent.predecessor.observationHash = 'b'.repeat(64);
      }
      const before = structuredClone(f.state.db);
      await expect(f.preparer.prepareObservation(f.input)).rejects.toThrow();
      await expect(f.observer.observeStaging(f.input)).rejects.toThrow();
      expect(f.head).not.toHaveBeenCalled();
      expect(f.state.writes).toBe(0);
      expect(f.state.db).toEqual(before);
    },
  );
  it.each([
    'binding',
    'hash',
    'intent',
    'key',
    'digest',
    'size',
    'etag',
    'protocol',
    'permission',
    'extra',
  ])(
    'denies collector %s even with a recomputed staging observation hash',
    async (kind) => {
      const f = await setup(),
        raw = structuredClone(await f.observer.observeStaging(f.input));
      const copy = raw as unknown as Record<string, unknown>,
        payload = copy.observation as Record<string, unknown>;
      if (kind === 'binding')
        (copy.binding as Record<string, unknown>).itemId = f.id(90);
      if (kind === 'hash') copy.observationHash = 'b'.repeat(64);
      if (kind === 'intent') payload.intentDefinitionHash = 'b'.repeat(64);
      if (kind === 'key') payload.key = f.state.db.files[0].historicalKey;
      if (kind === 'digest') payload.sha256 = 'b'.repeat(64);
      if (kind === 'size')
        (payload.revision as Record<string, unknown>).size = 13;
      if (kind === 'etag')
        (payload.revision as Record<string, unknown>).etag = '';
      if (kind === 'protocol')
        copy.protocol = 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1';
      if (kind === 'permission') copy.copyDispatch = 'AUTHORIZED';
      if (kind === 'extra') copy.allowCopy = true;
      if (kind !== 'hash') copy.observationHash = archiveHash(payload);
      const before = structuredClone(f.state.db);
      await expect(
        Promise.resolve().then(() =>
          f.store.confirmStagingObservation(f.input, raw),
        ),
      ).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
    },
  );
  it.each(['absent', 'bucket', 'key', 'getRevision', 'digest', 'lateVersion'])(
    'rejects staging %s without persisting evidence',
    async (fault) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.remote.fault = fault;
      await expect(
        f.preparer.prepareObservation(f.input),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
      if (['getRevision', 'digest', 'lateVersion'].includes(fault))
        expect(f.close).toHaveBeenCalledTimes(1);
      else expect(f.read).not.toHaveBeenCalled();
    },
  );
  it.each(['stream', 'close', 'unavailable', 'digestAndClose'])(
    'preserves staging %s failure and closes every returned stream',
    async (fault) => {
      const f = await setup();
      f.remote.fault = fault;
      const error: unknown = await f.preparer
        .prepareObservation(f.input)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(
        fault === 'digestAndClose' ? ConflictError : ExternalServiceError,
      );
      expect(String(error)).not.toMatch(/private|token/);
      if (fault !== 'unavailable') {
        expect(f.close).toHaveBeenCalledTimes(1);
        expect(f.bodies[0].destroyed).toBe(true);
      }
      expect(f.state.writes).toBe(0);
    },
  );
  it('detaches caller and context pins before the first staging reader await', async () => {
    const f = await setup(),
      input = structuredClone(f.input),
      context = await f.store.readStagingCopy(f.input);
    const intent = structuredClone(context.file.stagingCopyIntent!);
    jest.spyOn(f.store, 'readStagingCopy').mockResolvedValue(context);
    f.remote.beforeHead = () => {
      context.file.stagingCopyIntent = {} as never;
      context.file.recipientStagingKey = 'foreign';
    };
    const pending = f.observer.observeStaging(f.input);
    f.input.bucket = 'mutated-bucket';
    f.input.selector.itemId = f.id(90);
    expect((await pending).observation).toMatchObject({
      bucket: input.bucket,
      key: intent.destination.key,
      intentDefinitionHash: intent.definitionHash,
    });
  });
  it.each([1, 2, 3, 4, 5])(
    'rolls back staging evidence and every fence on write %i failure',
    async (n) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.failAtWrite = n;
      await expect(
        f.preparer.prepareObservation(f.input),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.state.db).toEqual(before);
    },
  );
  it.each(['requests', 'items', 'claims', 'controls', 'files'])(
    'rejects a no-op %s fence/CAS',
    async (role) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.noOp = `${role}.updateOne`;
      await expect(f.preparer.prepareObservation(f.input)).rejects.toThrow(
        'fence',
      );
      expect(f.state.db).toEqual(before);
    },
  );
  it('replays persisted staging evidence without reading objects or replacing predecessors', async () => {
    const f = await setup(),
      first = await f.preparer.prepareObservation(f.input);
    const file = structuredClone(f.state.db.files[0]);
    f.calls.length = 0;
    f.observed.mockRejectedValue(new Error('No new object read on replay'));
    expect(await f.preparer.prepareObservation(f.input)).toEqual({
      ...first,
      replayed: true,
    });
    expect(f.observed).toHaveBeenCalledTimes(1);
    expect(f.state.db.files[0]).toEqual(file);
    expect(
      f.calls.filter((c) => c.method === 'updateOne').map((c) => c.role),
    ).toEqual(['requests', 'items', 'claims', 'controls']);
    expect(await f.preparer.prepare(f.input)).toMatchObject({
      replayed: true,
      intentId: first.intentId,
    });
  });
  it.each(['reply', 'session'])(
    'reconciles application %s failure after commit without another staging read',
    async (kind) => {
      const f = await setup();
      f.remote.beforeConfirm = () => {
        if (kind === 'reply') f.state.loseReply = true;
        else f.state.endFailure = true;
      };
      await expect(
        f.preparer.prepareObservation(f.input),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.state.db.files[0].stagingByteObservation).toBeDefined();
      const file = structuredClone(f.state.db.files[0]);
      f.state.endFailure = false;
      f.observed.mockRejectedValue(new Error('No repeated object read'));
      expect(await f.preparer.prepareObservation(f.input)).toMatchObject({
        replayed: true,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(f.state.db.files[0]).toEqual(file);
      expect(f.observed).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['epoch', 'claim', 'seal', 'history', 'intent', 'lease'])(
    'refuses stale staging evidence after %s changes during object I/O',
    async (kind) => {
      const f = await setup();
      f.remote.beforeConfirm = () => {
        if (kind === 'epoch') f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'claim')
          f.state.db.claims[0].acceptanceOperationId = f.id(90);
        if (kind === 'seal')
          (f.state.db.archives[0].capture as { revision: number }).revision = 4;
        if (kind === 'history')
          f.state.db.files[0].historicalByteObservation = {};
        if (kind === 'intent') f.state.db.files[0].stagingCopyIntent = {};
        if (kind === 'lease') f.state.db.files[0].leaseToken = 'foreign';
      };
      await expect(f.preparer.prepareObservation(f.input)).rejects.toThrow();
      expect(f.state.db.files[0].stagingByteObservation).toBeUndefined();
      expect(f.state.writes).toBe(0);
    },
  );
  it('refuses a newer observed revision instead of replacing the committed staging observation', async () => {
    const f = await setup();
    await f.preparer.prepareObservation(f.input);
    f.remote.versionId = 'staging-v2';
    const newer = await f.observer.observeStaging(f.input),
      before = structuredClone(f.state.db);
    await expect(
      f.store.confirmStagingObservation(f.input, newer),
    ).rejects.toThrow('cannot be replaced');
    expect(f.state.db).toEqual(before);
  });
  it('keeps source evidence independent and preserves staging metadata during source preparation', async () => {
    const f = await setup();
    await f.preparer.prepareObservation(f.input);
    const staged = structuredClone(f.state.db.files[0].stagingByteObservation);
    const source = new ItemSourceObservationPreparer(f.store, f.observer);
    await source.prepare(f.input);
    expect(f.state.db.files[0].stagingByteObservation).toEqual(staged);
    expect(await f.preparer.prepareObservation(f.input)).toMatchObject({
      replayed: true,
    });
  });
  it.each(['null', 'hash', 'orphan'])(
    'blocks a persisted %s staging observation without repair or object I/O',
    async (kind) => {
      const f = await setup();
      await f.preparer.prepareObservation(f.input);
      if (kind === 'null') f.state.db.files[0].stagingByteObservation = null;
      if (kind === 'hash')
        (
          f.state.db.files[0].stagingByteObservation as {
            observationHash: string;
          }
        ).observationHash = 'b'.repeat(64);
      if (kind === 'orphan') {
        delete f.state.db.files[0].stagingCopyIntent;
        delete f.state.db.files[0].historicalByteObservation;
      }
      const before = structuredClone(f.state.db),
        calls = f.head.mock.calls.length;
      await expect(f.preparer.prepareObservation(f.input)).rejects.toThrow();
      await expect(f.service.prepareHistoricalCopy(f.input)).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.head).toHaveBeenCalledTimes(calls);
    },
  );
  it('captures collector values before opening a confirmation transaction', async () => {
    const f = await setup(),
      raw = structuredClone(await f.observer.observeStaging(f.input));
    const expected = raw.observationHash,
      pending = f.store.confirmStagingObservation(f.input, raw);
    (raw.observation.revision as { etag: string }).etag = 'mutated';
    expect((await pending).observationHash).toBe(expected);
  });
  it('keeps the evidence optional without defaults or indexes', () => {
    expect(
      OwnershipArchiveFileSchema.path('stagingByteObservation').options.default,
    ).toBeUndefined();
    expect(
      OwnershipArchiveFileSchema.indexes().some(
        ([key]) => 'stagingByteObservation' in key,
      ),
    ).toBe(false);
  });
  it('does not authorize retention or copying when staging changes after final HEAD', async () => {
    const f = await setup();
    f.remote.fault = 'afterObservation';
    expect(await f.preparer.prepareObservation(f.input)).toMatchObject({
      retention: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    const stored = f.state.db.files[0].stagingByteObservation as {
      observation: { revision: { versionId: string } };
    };
    expect(stored.observation.revision.versionId).toBe('staging-v1');
    expect(f.remote.versionId).toBe('later');
  });
  it('cannot substitute staging bytes for historical or source evidence', async () => {
    const f = await setup(),
      observed = await f.observer.observeStaging(f.input),
      context = await f.store.readStagingCopy(f.input);
    expect(() =>
      f.store.confirmHistoricalObservation(f.input, observed as never),
    ).toThrow('Historical byte');
    expect(() =>
      f.store.confirmSourceObservation(f.input, observed as never),
    ).toThrow('Source byte');
    expect(() =>
      buildItemStagingCopyIntent(
        context,
        context.file.historicalCopyIntent!,
        observed.observation,
      ),
    ).toThrow('identity');
    expect(f.state.writes).toBe(0);
  });
});
