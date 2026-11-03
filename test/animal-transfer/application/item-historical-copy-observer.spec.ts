import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ItemHistoricalCopyObserver } from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import {
  archiveHash,
  ArchiveFile,
  OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  buildItemStagingCopyIntent,
  captureItemArchiveFileDefinition,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  HistoricalReadTarget,
  ItemHistoricalObjectReader,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../src/context/shared/domain/errors/ExternalServiceError';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

async function setup(versioned = true, source = false) {
  const f = await historicalCopyPreparationFixture();
  const content = Buffer.from('animal-bytes');
  f.input.sourceSha256 = createHash('sha256').update(content).digest('hex');
  const file = f.state.db.files[0] as unknown as ArchiveFile;
  if (source && !versioned) {
    const archive = f.state.db.archives.find(
      (a) => a.id === file.archiveId,
    )! as unknown as OwnershipArchive;
    const definition = captureItemArchiveFileDefinition(archive, file);
    const original = { etag: file.source.etag, size: file.source.size };
    file.source = original;
    file.definitionHash = archiveHash({ ...definition, source: original });
    f.input.expectedFileDefinitionHash = file.definitionHash;
  }
  await f.service.prepareHistoricalCopy(f.input);
  const state = {
    fault: '',
    heads: 0,
    etag: source ? file.source.etag : 'historical-etag',
    versionId: source
      ? file.source.versionId
      : versioned
        ? 'historical-v1'
        : undefined,
    beforeHead: undefined as (() => void) | undefined,
  };
  const bodies: Readable[] = [];
  const close = jest.fn(() => {
    bodies.at(-1)!.destroy();
    if (['close', 'digestAndClose'].includes(state.fault))
      throw new Error('private close token');
  });
  const headers = () => ({
    etag: state.etag,
    size: content.byteLength,
    versionId: state.versionId,
  });
  const head = jest.fn((target: HistoricalReadTarget) => {
    state.beforeHead?.();
    state.heads++;
    if (state.fault === 'headUnavailable')
      throw new Error('private backend token');
    if (
      state.fault === 'absent' ||
      (state.fault === 'removed' && state.heads === 2)
    )
      return Promise.resolve(null);
    const value = { ...target, ...headers() };
    if (state.fault === 'foreignBucket') value.bucket = 'foreign-bucket';
    if (state.fault === 'foreignKey') value.key = 'foreign-key';
    if (state.fault === 'size') value.size++;
    if (state.fault === 'etag') value.etag = '';
    if (state.fault === 'version') value.versionId = '';
    if (state.fault === 'changed' && state.heads === 2) value.etag = 'changed';
    if (state.fault === 'versionChanged' && state.heads === 2)
      value.versionId = 'changed';
    if (state.fault === 'afterObservation' && state.heads === 2)
      state.etag = 'later';
    return Promise.resolve(value);
  });
  const read = jest.fn(
    (
      _target: HistoricalReadTarget,
      fixed: { etag: string; size: number; versionId?: string },
    ) => {
      if (state.fault === 'readUnavailable')
        throw new Error('private read token');
      expect(Object.isFrozen(fixed)).toBe(true);
      let bytes = Buffer.from(content);
      if (['digest', 'digestAndClose'].includes(state.fault)) bytes[0] ^= 1;
      if (state.fault === 'short')
        bytes = bytes.subarray(0, bytes.byteLength - 1);
      if (state.fault === 'oversize')
        bytes = Buffer.concat([bytes, Buffer.from('!')]);
      const body =
        state.fault === 'stream'
          ? Readable.from(
              (function* () {
                yield bytes.subarray(0, 4);
                throw new Error('private stream token');
              })(),
            )
          : state.fault === 'chunk'
            ? Readable.from(['invalid chunk'])
            : Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]);
      bodies.push(body);
      const revision = headers();
      if (state.fault === 'getRevision') revision.etag = 'different';
      if (state.fault === 'getVersion') revision.versionId = 'different';
      if (state.fault === 'getSize') revision.size++;
      return Promise.resolve({ revision, body, close });
    },
  );
  const reader: ItemHistoricalObjectReader = { head, read };
  const observer = new ItemHistoricalCopyObserver(f.store, reader);
  f.state.writes = 0;
  f.calls.length = 0;
  return {
    ...f,
    observer,
    reader,
    head,
    read,
    close,
    bodies,
    remote: state,
    content,
  };
}

describe('Historical byte observation through explicit read-only collaborators, no network', () => {
  it.each([true, false])(
    'observes pinned bytes via HEAD/read/HEAD without granting or persisting staging (versioned=%s)',
    async (versioned) => {
      const f = await setup(versioned),
        before = structuredClone(f.state.db);
      const result = await f.observer.observe(f.input);
      expect(result).toMatchObject({
        protocol: 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1',
        bytes: 'MATCH',
        reservation: 'OBSERVED_ONLY',
        provenance: 'NOT_ASSESSED',
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
        observation: {
          bucket: f.input.bucket,
          key: f.state.db.files[0].historicalKey,
          sha256: f.input.sourceSha256,
          revision: { etag: 'historical-etag', size: 12 },
        },
      });
      expect(result.observation.revision.versionId).toBe(
        versioned ? 'historical-v1' : undefined,
      );
      expect(result.observationHash).toBe(archiveHash(result.observation));
      expect(f.head).toHaveBeenCalledTimes(2);
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.head.mock.invocationCallOrder[0]).toBeLessThan(
        f.read.mock.invocationCallOrder[0],
      );
      expect(f.read.mock.invocationCallOrder[0]).toBeLessThan(
        f.head.mock.invocationCallOrder[1],
      );
      const target = f.head.mock.calls[0][0];
      expect(target).toEqual({
        bucket: f.input.bucket,
        key: f.state.db.files[0].historicalKey,
      });
      expect(Object.isFrozen(target)).toBe(true);
      expect(f.read.mock.calls[0][1]).toEqual(result.observation.revision);
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(f.bodies[0].destroyed).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.observation)).toBe(true);
      expect(Object.isFrozen(result.observation.revision)).toBe(true);
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      const subject = await f.store.readHistoricalCopy(f.input);
      const staging = buildItemStagingCopyIntent(
        subject,
        subject.file.historicalCopyIntent!,
        result.observation,
      );
      expect(staging.source.key).toBe(result.observation.key);
      expect(staging.predecessor?.observationHash).toBe(result.observationHash);
      expect(staging.copyDispatch).toBe('NOT_AUTHORIZED');
    },
  );
  it.each([
    'absent',
    'foreignBucket',
    'foreignKey',
    'size',
    'etag',
    'version',
    'getRevision',
    'getVersion',
    'getSize',
    'digest',
    'short',
    'oversize',
    'chunk',
    'removed',
    'changed',
    'versionChanged',
    'digestAndClose',
  ])(
    'rejects %s while preserving the original pins and closing every opened stream',
    async (fault) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.remote.fault = fault;
      await expect(f.observer.observe(f.input)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
      expect(f.close).toHaveBeenCalledTimes(f.bodies.length);
      expect(f.bodies.every((body) => body.destroyed)).toBe(true);
    },
  );
  it.each(['headUnavailable', 'readUnavailable', 'stream', 'close'])(
    'sanitizes %s without fabricating absence, retrying or saving evidence',
    async (fault) => {
      const f = await setup();
      f.remote.fault = fault;
      const error: unknown = await f.observer
        .observe(f.input)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ExternalServiceError);
      expect(String(error)).not.toMatch(/private|token/);
      expect(f.state.writes).toBe(0);
      expect(f.close).toHaveBeenCalledTimes(f.bodies.length);
      expect(f.read.mock.calls.length).toBeLessThanOrEqual(1);
    },
  );
  it('never starts the reader when the persisted subject or its original reservation is unavailable', async () => {
    const f = await setup();
    f.state.db.controls[0].reservationEpoch = 3;
    await expect(f.observer.observe(f.input)).rejects.toThrow(
      'original matching',
    );
    expect(f.head).not.toHaveBeenCalled();
    expect(f.state.writes).toBe(0);
  });
  it('does not use a subject after its read session failed to close', async () => {
    const f = await setup();
    f.state.endFailure = true;
    await expect(f.observer.observe(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.head).not.toHaveBeenCalled();
  });
  it('detaches all pins before reader awaits even when the caller or returned subject changes', async () => {
    const f = await setup();
    const context = await f.store.readHistoricalCopy(f.input);
    jest.spyOn(f.store, 'readHistoricalCopy').mockResolvedValue(context);
    f.remote.beforeHead = () => {
      context.file.source.etag = 'mutated-source';
      context.file.historicalKey = 'foreign-key';
    };
    const result = f.observer.observe(f.input);
    f.input.bucket = 'mutated-bucket';
    f.input.selector.itemId = f.id(90);
    expect((await result).observation.bucket).toBe('test-archive-bucket');
    expect(f.head.mock.calls.every(([t]) => t.key !== 'foreign-key')).toBe(
      true,
    );
  });
  it('does not trust a reader subject for another file even if its own definition is consistent', async () => {
    const f = await setup();
    const context = await f.store.readHistoricalCopy(f.input);
    jest.spyOn(f.store, 'readHistoricalCopy').mockResolvedValue(context);
    const input = { ...f.input, fileId: 'b'.repeat(64) };
    await expect(f.observer.observe(input)).rejects.toThrow('original intent');
    expect(f.head).not.toHaveBeenCalled();
  });
  it('keeps a response from an old reservation observational without a final write or fence', async () => {
    const f = await setup();
    f.remote.beforeHead = () => {
      f.state.db.controls[0].reservationEpoch = 3;
    };
    const result = await f.observer.observe(f.input);
    expect(result).toMatchObject({
      reservation: 'OBSERVED_ONLY',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(result.binding.observedSeal.reservationEpoch).toBe(1);
    expect(f.state.db.controls[0].reservationEpoch).toBe(3);
    expect(f.state.writes).toBe(0);
  });
  it('does not claim retention or remote closure if the object changes after its last HEAD', async () => {
    const f = await setup();
    f.remote.fault = 'afterObservation';
    const result = await f.observer.observe(f.input);
    expect(result.observation.revision.etag).toBe('historical-etag');
    expect(f.remote.etag).toBe('later');
    expect(result).toMatchObject({
      retention: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
    });
  });
});

describe('Original source byte observation with the same collector and no network', () => {
  it.each([true, false])(
    'reads only the captured source revision and compares the declared digest (versioned=%s)',
    async (versioned) => {
      const f = await setup(versioned, true),
        before = structuredClone(f.state.db);
      const file = f.state.db.files[0] as unknown as ArchiveFile;
      f.remote.beforeHead = () =>
        expect(f.sessions.at(-1)!.endSession).toHaveBeenCalledTimes(1);
      const result = await f.observer.observeSource(f.input);
      expect(result).toMatchObject({
        protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1',
        binding: { fileId: file.id, fileDefinitionHash: file.definitionHash },
        observation: {
          key: file.sourceKey,
          revision: file.source,
          sha256: f.input.sourceSha256,
        },
        bytes: 'MATCH',
        reservation: 'OBSERVED_ONLY',
        provenance: 'NOT_ASSESSED',
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(result.observationHash).toBe(archiveHash(result.observation));
      expect(f.head.mock.calls.map(([t]) => t.key)).toEqual([
        file.sourceKey,
        file.sourceKey,
      ]);
      expect(f.read.mock.calls[0][1]).toEqual(file.source);
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(f.bodies[0].destroyed).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.observation.revision)).toBe(true);
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
    },
  );
  it.each(['etag', 'version', 'size'] as const)(
    'refuses a current source with changed %s before GET, without adopting a fresh HEAD pin',
    async (kind) => {
      const f = await setup(true, true);
      if (kind === 'etag') f.remote.etag = 'different-source';
      if (kind === 'version') f.remote.versionId = 'different-source-version';
      if (kind === 'size') f.remote.fault = 'size';
      await expect(f.observer.observeSource(f.input)).rejects.toThrow(
        'original manifest revision',
      );
      expect(f.read).not.toHaveBeenCalled();
      expect(f.state.writes).toBe(0);
    },
  );
  it('does not add a new version pin when the original captured revision had no VersionId', async () => {
    const f = await setup(false, true);
    f.remote.versionId = 'newly-versioned';
    await expect(f.observer.observeSource(f.input)).rejects.toThrow(
      'original manifest revision',
    );
    expect(f.read).not.toHaveBeenCalled();
  });
  it.each(['getRevision', 'digest', 'versionChanged'])(
    'rejects source %s and closes the conditional read without saving evidence',
    async (fault) => {
      const f = await setup(true, true),
        before = structuredClone(f.state.db);
      f.remote.fault = fault;
      await expect(f.observer.observeSource(f.input)).rejects.toThrow(
        'Source object',
      );
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(f.state.db).toEqual(before);
    },
  );
  it.each(['stream', 'close', 'digestAndClose', 'readUnavailable'])(
    'preserves source %s failure semantics and sanitizes private reader errors',
    async (fault) => {
      const f = await setup(true, true);
      f.remote.fault = fault;
      const error: unknown = await f.observer
        .observeSource(f.input)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(
        fault === 'digestAndClose' ? ConflictError : ExternalServiceError,
      );
      expect(String(error)).not.toMatch(/private|token/);
      if (fault !== 'readUnavailable') expect(f.close).toHaveBeenCalledTimes(1);
      expect(f.state.writes).toBe(0);
    },
  );
  it('requires the persisted original historical intent before any source I/O', async () => {
    const f = await setup(true, true);
    delete f.state.db.files[0].historicalCopyIntent;
    await expect(f.observer.observeSource(f.input)).rejects.toThrow(
      'persisted historical',
    );
    expect(f.head).not.toHaveBeenCalled();
  });
  it('cannot substitute source observation for historical evidence or a staging predecessor', async () => {
    const f = await setup(true, true),
      observed = await f.observer.observeSource(f.input);
    expect(() =>
      f.store.confirmHistoricalObservation(f.input, observed as never),
    ).toThrow('Historical byte observation');
    const context = await f.store.readHistoricalCopy(f.input);
    expect(() =>
      buildItemStagingCopyIntent(
        context,
        context.file.historicalCopyIntent!,
        observed.observation,
      ),
    ).toThrow('identity');
    expect(f.state.db.files[0].historicalByteObservation).toBeUndefined();
    expect(f.state.db.files[0].stagingCopyIntent).toBeUndefined();
    expect(f.state.writes).toBe(0);
  });
  it('separates original source pins from mutable caller input and a returned reader context', async () => {
    const f = await setup(true, true),
      input = structuredClone(f.input);
    const context = await f.store.readHistoricalCopy(f.input),
      original = structuredClone(context.file);
    jest.spyOn(f.store, 'readHistoricalCopy').mockResolvedValue(context);
    f.remote.beforeHead = () => {
      context.file.sourceKey = 'foreign';
      context.file.source.etag = 'mutated';
    };
    const pending = f.observer.observeSource(f.input);
    f.input.bucket = 'mutated-bucket';
    f.input.sourceSha256 = 'b'.repeat(64);
    f.input.selector.itemId = f.id(90);
    const observed = await pending;
    expect(observed.observation).toMatchObject({
      bucket: input.bucket,
      key: original.sourceKey,
      revision: original.source,
      sha256: input.sourceSha256,
    });
    expect(f.read.mock.calls[0][1]).toEqual(original.source);
  });
  it('keeps source observations from an old reserve and late object changes observational', async () => {
    const f = await setup(true, true);
    f.remote.fault = 'afterObservation';
    f.remote.beforeHead = () => {
      f.state.db.controls[0].reservationEpoch = 3;
    };
    const result = await f.observer.observeSource(f.input);
    expect(result.binding.observedSeal.reservationEpoch).toBe(1);
    expect(result.observation.revision.etag).toBe('source');
    expect(f.remote.etag).toBe('later');
    expect(result).toMatchObject({
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
    });
    expect(f.state.writes).toBe(0);
  });
});
