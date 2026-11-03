import { ItemManifestObserver } from '../../../src/context/animal-transfer/application/item-manifest-observer';
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
