import { ItemManifestObserver } from '../../../src/context/animal-transfer/application/item-manifest-observer';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { ItemArchiveCopyIntent } from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import { ItemSourceByteObservation } from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { itemManifestFixture } from '../fixtures/item-manifest.fixture';

async function setup(count = 1, files = true) {
  const t = await itemManifestFixture(count, files);
  const read = jest.spyOn(t.f.store, 'readManifestPage');
  const observer = new ItemManifestObserver(t.f.store, t.keyFromUrl);
  return { ...t, read, observer };
}
describe('Controlled local item manifest observation with simulated Mongo', () => {
  it('traverses more than 100 entries/files and revalidates COMPLETE in separate read-only transactions', async () => {
    const t = await setup(203),
      before = structuredClone(t.f.state.db),
      from = t.f.sessions.length;
    expect(await t.observer.observe(t.input)).toEqual(t.complete());
    expect(t.read.mock.calls.map(([input]) => input.cursor.phase)).toEqual([
      'ENTRIES',
      'ENTRIES',
      'ENTRIES',
      'ENTRIES',
      'FILES',
      'FILES',
      'FILES',
      'FILES',
      'COMPLETE',
    ]);
    expect(t.f.sessions.slice(from)).toHaveLength(9);
    for (const session of t.f.sessions.slice(from))
      expect(session.endSession).toHaveBeenCalledTimes(1);
    const reads = t.f.calls.filter(
      (c) => c.role === 'entries' || c.role === 'files',
    );
    expect(reads).toHaveLength(8);
    expect(
      reads.every((c) => c.options?.singleBatch === true && c.limit === 100),
    ).toBe(true);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
    expect(t.f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it('continues after server-sized short batches until actual empty pages rather than treating fewer than 100 as terminal', async () => {
    const t = await setup(7);
    t.f.state.manifestBatchSize = 2;
    expect(await t.observer.observe(t.input)).toEqual(t.complete());
    expect(t.read).toHaveBeenCalledTimes(11);
    expect(t.read.mock.calls[1][0].cursor.afterId).toBe(t.entries[1].id);
    expect(t.read.mock.calls[6][0].cursor.afterId).toBe(t.files[1].id);
  });
  it('reads an empty file page and a final snapshot even when the cut declares zero files', async () => {
    const t = await setup(1, false);
    expect(await t.observer.observe(t.input)).toMatchObject({
      entryCount: 1,
      fileCount: 0,
      reservation: 'OBSERVED_ONLY',
      stableCut: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
    });
    expect(t.read.mock.calls.map(([i]) => i.cursor.phase)).toEqual([
      'ENTRIES',
      'ENTRIES',
      'FILES',
      'COMPLETE',
    ]);
  });
  it.each(['epoch', 'claim', 'request', 'capture', 'period'] as const)(
    'does not return a digest after original %s invalidation between pages',
    async (kind) => {
      const t = await setup(3),
        read = t.read.getMockImplementation()!.bind(t.f.store);
      t.read.mockImplementationOnce(async (input) => {
        const page = await read(input);
        if (kind === 'epoch') t.f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'claim')
          t.f.state.db.claims[0].acceptanceOperationId = t.f.id(90);
        if (kind === 'request') t.f.state.db.requests[0].version = 3;
        if (kind === 'capture')
          (t.f.state.db.archives[0].capture as { revision: number }).revision++;
        if (kind === 'period') t.f.state.db.periods = [];
        return page;
      });
      await expect(t.observer.observe(t.input)).rejects.toThrow();
      expect(t.read).toHaveBeenCalledTimes(2);
      expect(t.f.state.writes).toBe(0);
      expect(t.f.state.db.archives[0].manifestDigest).toBeUndefined();
    },
  );
  it('revalidates after the terminal file page instead of finishing from its older snapshot', async () => {
    const t = await setup(),
      read = t.read.getMockImplementation()!.bind(t.f.store);
    t.read.mockImplementation(async (input) => {
      const page = await read(input);
      if (page.phase === 'FILES' && page.rows.length === 0)
        t.f.state.db.controls[0].reservationEpoch = 3;
      return page;
    });
    await expect(t.observer.observe(t.input)).rejects.toThrow(
      'original matching',
    );
    expect(t.read.mock.calls.at(-1)![0].cursor.phase).toBe('COMPLETE');
    expect(t.f.state.writes).toBe(0);
  });
  it('discards the local accumulator on read failure without persisting or retrying another page', async () => {
    const t = await setup(),
      read = t.read.getMockImplementation()!.bind(t.f.store),
      failure = new Error('Trusted reader failure');
    t.read.mockImplementationOnce(read).mockRejectedValueOnce(failure);
    const before = structuredClone(t.f.state.db);
    await expect(t.observer.observe(t.input)).rejects.toBe(failure);
    expect(t.read).toHaveBeenCalledTimes(2);
    expect(t.f.state.db).toEqual(before);
  });
  it('rejects payload corruption before traversing files and leaves stored state untouched', async () => {
    const t = await setup();
    t.f.state.db.entries[0].contentHash = 'b'.repeat(64);
    const before = structuredClone(t.f.state.db);
    await expect(t.observer.observe(t.input)).rejects.toThrow('integrity');
    expect(t.read).toHaveBeenCalledTimes(1);
    expect(t.f.state.db).toEqual(before);
  });
  it('rejects a mismatched reader phase instead of treating it as completion', async () => {
    const t = await setup();
    t.read.mockResolvedValueOnce({ phase: 'COMPLETE', snapshot: t.snapshot });
    await expect(t.observer.observe(t.input)).rejects.toThrow(
      'another traversal phase',
    );
    expect(t.read).toHaveBeenCalledTimes(1);
  });
  it('captures original input before the first await and returns a frozen minimal result', async () => {
    const t = await setup(),
      expected = t.complete(),
      raw = structuredClone(t.input);
    const pending = t.observer.observe(raw);
    raw.selector.itemId = t.f.id(90);
    raw.expectedSealHash = 'b'.repeat(64);
    const result = await pending;
    expect(result).toEqual(expected);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /users\/|payload|Brownie|leaseToken|sourceKey|sha256/,
    );
  });
  it('rejects a supplied result or cursor instead of resuming a JSON proof', async () => {
    const t = await setup();
    await expect(
      t.observer.observe({ ...t.input, cursor: { phase: 'FILES' } } as never),
    ).rejects.toThrow('Invalid');
    await expect(
      t.observer.observe({ ...t.input, manifestHash: 'a'.repeat(64) } as never),
    ).rejects.toThrow('Invalid');
    expect(t.read).not.toHaveBeenCalled();
  });
});

describe('Historical source anchor with simulated Mongo and synthetic observations', () => {
  async function anchorSetup(count = 3) {
    const t = await setup(count);
    const file = t.files.at(-1)!;
    const preparation = {
      ...t.f.input,
      ...t.input,
      fileId: file.id,
      expectedFileDefinitionHash: file.definitionHash,
    };
    const currentFile = () =>
      t.f.state.db.files.find((row) => row.id === file.id)!;
    const header = () =>
      t.f.state.db.archives.find((row) => row.id === file.archiveId)!;
    const digest = t.complete();
    await t.f.store.confirmManifestDigest(t.input, digest);
    await t.f.store.prepareHistoricalCopy(preparation);
    const intent = currentFile().historicalCopyIntent as ItemArchiveCopyIntent;
    const observation = {
      intentId: intent.id,
      intentDefinitionHash: intent.definitionHash,
      bucket: intent.bucket,
      key: intent.source.key,
      revision: intent.source.revision,
      sha256: intent.source.sha256,
    };
    const source: ItemSourceByteObservation = {
      protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1',
      binding: intent.binding,
      observation,
      observationHash: archiveHash(observation),
      bytes: 'MATCH',
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    };
    await t.f.store.confirmSourceObservation(preparation, source);
    const readSource = jest.spyOn(t.f.store, 'readHistoricalSourceForAnchor');
    t.f.state.writes = 0;
    t.f.calls.length = 0;
    return {
      ...t,
      currentFile,
      header,
      digest,
      intent,
      source,
      readSource,
      anchorInput: { preparation, expectedManifestHash: digest.manifestHash },
    };
  }

  it('finds a source on a later page and binds the final local snapshot without writes', async () => {
    const t = await anchorSetup(103);
    t.f.state.manifestBatchSize = 40;
    const before = structuredClone(t.f.state.db);
    const result = await t.observer.anchorHistoricalSource(t.anchorInput);
    const { anchorHash, ...definition } = result;
    expect(anchorHash).toBe(archiveHash(definition));
    expect(definition).toEqual({
      protocol: 'ITEM_HISTORICAL_SOURCE_ANCHOR_V1',
      binding: t.intent.binding,
      manifestHash: t.digest.manifestHash,
      intentId: t.intent.id,
      intentDefinitionHash: t.intent.definitionHash,
      sourceObservationHash: t.source.observationHash,
      reservation: 'OBSERVED_ONLY',
      provenance: 'NOT_ASSESSED',
      coverage: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(t.read.mock.calls.map(([input]) => input.cursor.phase)).toEqual([
      'ENTRIES',
      'ENTRIES',
      'ENTRIES',
      'ENTRIES',
      'FILES',
      'FILES',
      'FILES',
      'FILES',
      'COMPLETE',
    ]);
    expect(t.readSource).toHaveBeenCalledTimes(1);
    const session = t.f.sessions.at(-1)!;
    const reads = t.f.calls.filter((call) => call.session === session);
    expect(reads.map((call) => call.role)).toEqual([
      'requests',
      'items',
      'claims',
      'archives',
      'controls',
      'periods',
      'periods',
      'files',
    ]);
    expect(
      reads.find((call) => call.role === 'archives')?.projection,
    ).toHaveProperty('manifestDigest', 1);
    expect(
      reads.find((call) => call.role === 'files')?.projection,
    ).toHaveProperty('sourceByteObservation', 1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
    expect(t.f.state.db).toEqual(before);
    expect(t.f.capture.captureBatch).not.toHaveBeenCalled();
    expect(Object.isFrozen(result.binding.observedSeal)).toBe(true);
    expect(Object.isFrozen(result.binding)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /users\/|payload|sourceKey|sha256|leaseToken/,
    );
    expect(await t.observer.anchorHistoricalSource(t.anchorInput)).toEqual(
      result,
    );
  });

  it.each(['file-id', 'file-hash', 'manifest-hash'] as const)(
    'requires the exact traversed membership and expected hash (%s)',
    async (pin) => {
      const t = await anchorSetup();
      const input = structuredClone(t.anchorInput);
      if (pin === 'file-id') input.preparation.fileId = 'f'.repeat(64);
      if (pin === 'file-hash')
        input.preparation.expectedFileDefinitionHash = 'b'.repeat(64);
      if (pin === 'manifest-hash') input.expectedManifestHash = 'c'.repeat(64);
      await expect(t.observer.anchorHistoricalSource(input)).rejects.toThrow(
        'expected manifest traversal',
      );
      expect(t.read.mock.calls.at(-1)?.[0].cursor.phase).toBe('COMPLETE');
      expect(t.readSource).not.toHaveBeenCalled();
      expect(t.f.state.writes).toBe(0);
    },
  );

  it('checks the full manifest even when the selected file still matches', async () => {
    const t = await anchorSetup();
    const row = t.f.state.db.files[0];
    expect(row.id).not.toBe(t.anchorInput.preparation.fileId);
    const { definitionHash: old, state, ...definition } = row;
    const replacement = { ...(row.source as object), versionId: 'later' };
    Object.assign(row, {
      source: replacement,
      definitionHash: archiveHash({ ...definition, source: replacement }),
    });
    expect(row.definitionHash).not.toBe(old);
    expect(state).toBe('PENDING');
    await expect(
      t.observer.anchorHistoricalSource(t.anchorInput),
    ).rejects.toThrow('expected manifest traversal');
    expect(t.readSource).not.toHaveBeenCalled();
  });

  it('cannot anchor a file in a complete zero-file manifest', async () => {
    const t = await setup(1, false);
    await expect(
      t.observer.anchorHistoricalSource({
        preparation: { ...t.f.input, ...t.input },
        expectedManifestHash: t.complete().manifestHash,
      }),
    ).rejects.toThrow('expected manifest traversal');
    expect(t.read.mock.calls.map(([input]) => input.cursor.phase)).toEqual([
      'ENTRIES',
      'ENTRIES',
      'FILES',
      'COMPLETE',
    ]);
    expect(t.f.state.writes).toBe(0);
  });

  it.each([
    'manifest',
    'manifest-hash',
    'source',
    'source-revision',
    'intent',
    'lease',
    'epoch',
    'period',
  ] as const)(
    'rejects %s invalidation after COMPLETE in the final source snapshot',
    async (kind) => {
      const t = await anchorSetup();
      const read = t.read.getMockImplementation()!.bind(t.f.store);
      t.read.mockImplementation(async (input) => {
        const page = await read(input);
        if (page.phase !== 'COMPLETE') return page;
        if (kind === 'manifest') delete t.header().manifestDigest;
        if (kind === 'manifest-hash') {
          const { manifestHash: previousHash, ...definition } = t.digest;
          const changed = { ...definition, entriesDigest: 'b'.repeat(64) };
          const manifestHash = archiveHash(changed);
          expect(manifestHash).not.toBe(previousHash);
          t.header().manifestDigest = {
            ...changed,
            manifestHash,
          };
        }
        if (kind === 'source') delete t.currentFile().sourceByteObservation;
        if (kind === 'source-revision') {
          const observation = {
            ...t.source.observation,
            revision: {
              ...t.source.observation.revision,
              versionId: 'later',
            },
          };
          t.currentFile().sourceByteObservation = {
            ...t.source,
            observation,
            observationHash: archiveHash(observation),
          };
        }
        if (kind === 'intent') delete t.currentFile().historicalCopyIntent;
        if (kind === 'lease') t.currentFile().leaseToken = 'synthetic-lease';
        if (kind === 'epoch') t.f.state.db.controls[0].reservationEpoch = 3;
        if (kind === 'period') t.f.state.db.periods = [];
        return page;
      });
      await expect(
        t.observer.anchorHistoricalSource(t.anchorInput),
      ).rejects.toThrow();
      expect(t.readSource).toHaveBeenCalledTimes(1);
      expect(t.f.state.writes).toBe(0);
      expect(t.f.capture.captureBatch).not.toHaveBeenCalled();
    },
  );

  it('rejects caller-supplied evidence and freezes selector and pins before paging', async () => {
    const t = await anchorSetup();
    await expect(
      t.observer.anchorHistoricalSource({
        ...t.anchorInput,
        sourceObservation: t.source,
      } as never),
    ).rejects.toThrow('Invalid historical source anchor input');
    expect(t.read).not.toHaveBeenCalled();
    const mutable = structuredClone(t.anchorInput);
    const pending = t.observer.anchorHistoricalSource(mutable);
    mutable.preparation.selector.itemId = t.f.id(90);
    mutable.preparation.bucket = 'changed-bucket';
    mutable.expectedManifestHash = 'b'.repeat(64);
    expect(await pending).toMatchObject({
      binding: t.intent.binding,
      manifestHash: t.digest.manifestHash,
    });
  });

  it('propagates a session close failure after the final source snapshot', async () => {
    const t = await anchorSetup();
    const read = t.read.getMockImplementation()!.bind(t.f.store);
    t.read.mockImplementation(async (input) => {
      const page = await read(input);
      if (page.phase === 'COMPLETE') t.f.state.endFailure = true;
      return page;
    });
    await expect(
      t.observer.anchorHistoricalSource(t.anchorInput),
    ).rejects.toMatchObject({ status: 503 });
    expect(t.readSource).toHaveBeenCalledTimes(1);
    expect(t.f.state.writes).toBe(0);
  });
});
