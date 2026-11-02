import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ItemHistoricalCopyObserver } from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildItemStagingCopyIntent } from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  HistoricalReadTarget,
  ItemHistoricalObjectReader,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { ExternalServiceError } from '../../../src/context/shared/domain/errors/ExternalServiceError';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

async function setup(versioned = true) {
  const f = await historicalCopyPreparationFixture();
  const content = Buffer.from('animal-bytes');
  f.input.sourceSha256 = createHash('sha256').update(content).digest('hex');
  await f.service.prepareHistoricalCopy(f.input);
  const state = {
    fault: '',
    heads: 0,
    etag: 'historical-etag',
    versionId: versioned ? 'historical-v1' : undefined,
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
