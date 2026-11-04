import { getModelToken } from '@nestjs/mongoose';
import { DynamicModule } from '@nestjs/common';
import { TransferItemCaptureModule } from '../../../src/app/animal-transfer/transfer-item-capture.module';
import { ItemManifestReadInput } from '../../../src/context/animal-transfer/domain/transfer-item-manifest-digest';
import { itemManifestFixture } from '../fixtures/item-manifest.fixture';

async function setup() {
  const t = await itemManifestFixture(3);
  const input: ItemManifestReadInput = {
    ...t.input,
    cursor: { phase: 'ENTRIES', limit: 100 },
  };
  return { ...t, input };
}
describe('Item manifest pages on simulated Mongo only', () => {
  it.each(['ENTRIES', 'FILES'] as const)(
    'reads %s with its original binding, one bounded snapshot and keyset query, without fences',
    async (phase) => {
      const t = await setup(),
        before = structuredClone(t.f.state.db);
      const result = await t.f.store.readManifestPage({
        ...t.input,
        cursor: { phase, limit: 100 },
      });
      expect(result.phase).toBe(phase);
      expect(t.f.state.db).toEqual(before);
      expect(t.f.state.writes).toBe(0);
      const read = t.f.calls.find(
        (c) => c.role === (phase === 'ENTRIES' ? 'entries' : 'files'),
      )!;
      expect(read).toMatchObject({
        method: 'find',
        filter: { archiveId: t.archive.id },
        limit: 100,
        sort: { id: 1 },
        collation: { locale: 'simple' },
        options: { singleBatch: true, maxTimeMS: 5000 },
      });
      expect(read.projection).not.toHaveProperty('leaseToken');
      expect(read.projection).not.toHaveProperty('historicalCopyIntent');
      const session = t.f.sessions.at(-1)!;
      expect(t.f.calls.every((c) => c.session === session)).toBe(true);
      expect(session.endSession).toHaveBeenCalledTimes(1);
      const tx = session.withTransaction.mock.calls as unknown[][];
      expect(tx[0][1]).toMatchObject({
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
        timeoutMS: 15000,
        maxCommitTimeMS: 5000,
      });
      expect(
        t.f.calls.filter((c) => c.role === 'periods').map((c) => c.filter),
      ).toEqual([
        {
          id: t.archive.periodId,
          animalId: t.archive.animalId,
          ownerId: t.archive.ownerId,
          ownershipVersion: 1,
          status: 'ACTIVE',
        },
        { animalId: t.archive.animalId, status: 'CLOSED' },
      ]);
      expect(Object.isFrozen(result)).toBe(true);
      const afterId = phase === 'ENTRIES' ? t.entries[0].id : t.files[0].id;
      const next = await t.f.store.readManifestPage({
        ...t.input,
        cursor: { phase, afterId, limit: 100 },
      });
      expect('rows' in next && next.rows.map((r) => r.id)).toEqual(
        (phase === 'ENTRIES' ? t.entries : t.files).slice(1).map((r) => r.id),
      );
      expect(t.f.calls.at(-1)!.filter).toMatchObject({ id: { $gt: afterId } });
    },
  );
  it('revalidates COMPLETE in a new snapshot without reading rows or writing progress', async () => {
    const t = await setup(),
      before = structuredClone(t.f.state.db);
    const result = await t.f.store.readManifestPage({
      ...t.input,
      cursor: { phase: 'COMPLETE', limit: 100 },
    });
    expect(result.phase).toBe('COMPLETE');
    expect(result).not.toHaveProperty('rows');
    expect(
      t.f.calls.some((c) => c.role === 'entries' || c.role === 'files'),
    ).toBe(false);
    expect(t.f.state.db).toEqual(before);
    expect(t.f.state.writes).toBe(0);
  });
  it('authorizes the recipient before reading associated state or payload rows', async () => {
    const t = await setup();
    await expect(
      t.f.store.readManifestPage({
        ...t.input,
        selector: { ...t.input.selector, actorId: t.f.actorId },
      }),
    ).rejects.toThrow('recipient');
    expect(t.f.calls.map((c) => c.role)).toEqual(['requests']);
  });
  it.each([
    'entryConnection',
    'fileConnection',
    'entryCollection',
    'fileCollection',
    'entryIndex',
    'fileIndex',
  ] as const)('fails %s preflight without DDL or row reads', async (kind) => {
    const t = await setup();
    if (kind === 'entryConnection') t.f.models[13].db = { ...t.f.connection };
    if (kind === 'fileConnection') t.f.models[12].db = { ...t.f.connection };
    if (kind === 'entryCollection')
      t.f.state.missingCollection = 'animal_ownership_archive_entries';
    if (kind === 'fileCollection')
      t.f.state.missingCollection = 'animal_ownership_archive_files';
    if (kind === 'entryIndex')
      t.f.state.badIndex = 'animal_ownership_archive_entries';
    if (kind === 'fileIndex')
      t.f.state.badIndex = 'animal_ownership_archive_files';
    await expect(t.f.store.readManifestPage(t.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(t.f.calls).toEqual([]);
    expect(t.f.state.writes).toBe(0);
  });
  it('keeps the old six/seven-source methods independent from entry readiness', async () => {
    const t = await setup();
    t.f.models[13].db = { ...t.f.connection };
    t.f.state.missingCollection = 'animal_ownership_archive_entries';
    t.f.state.badIndex = 'animal_ownership_archive_entries';
    expect(
      await t.f.service.inspectCopyPreparation(t.f.input.selector),
    ).toHaveProperty('observedSealHash');
    expect(
      await t.f.service.prepareHistoricalCopy({
        ...t.f.input,
        expectedSealHash: t.input.expectedSealHash,
      }),
    ).toMatchObject({
      replayed: false,
    });
  });
  it.each(['seal', 'claim', 'epoch', 'period', 'consumed'] as const)(
    'rejects changed %s before reading any page rows',
    async (kind) => {
      const t = await setup();
      let input = t.input;
      if (kind === 'seal')
        input = { ...input, expectedSealHash: 'b'.repeat(64) };
      if (kind === 'claim')
        t.f.state.db.claims[0].acceptanceOperationId = t.f.id(90);
      if (kind === 'epoch') t.f.state.db.controls[0].reservationEpoch = 3;
      if (kind === 'period') t.f.state.db.periods = [];
      if (kind === 'consumed')
        t.f.state.db.archives[0].evidenceConsumption = {};
      const before = structuredClone(t.f.state.db);
      await expect(t.f.store.readManifestPage(input)).rejects.toThrow();
      expect(
        t.f.calls.some((c) => c.role === 'entries' || c.role === 'files'),
      ).toBe(false);
      expect(t.f.state.db).toEqual(before);
    },
  );
  it.each([
    'entryOrder',
    'entryDuplicate',
    'entryArchive',
    'fileOrder',
    'fileId',
    'oversized',
  ] as const)(
    'rejects an invalid %s page from the driver before returning it',
    async (kind) => {
      const t = await setup(),
        entries = kind.startsWith('entry');
      const model = t.f.models[entries ? 13 : 12],
        find = model.find.bind(model);
      jest.spyOn(model, 'find').mockImplementationOnce((filter) => {
        const query = find(filter),
          exec = query.exec;
        query.exec = async () => {
          const rows = (await exec()) as Array<Record<string, unknown>>;
          if (kind.endsWith('Order')) rows.reverse();
          if (kind === 'entryDuplicate') rows[1] = rows[0];
          if (kind === 'entryArchive') rows[0].archiveId = t.f.id(90);
          if (kind === 'fileId') rows[0].id = 'bad';
          if (kind === 'oversized')
            return Array.from({ length: 101 }, () => rows[0]);
          return rows;
        };
        return query;
      });
      await expect(
        t.f.store.readManifestPage({
          ...t.input,
          cursor: { phase: entries ? 'ENTRIES' : 'FILES', limit: 100 },
        }),
      ).rejects.toThrow();
      expect(t.f.state.writes).toBe(0);
    },
  );
  it.each([
    'limit',
    'phase',
    'after',
    'completeAfter',
    'extraCursor',
    'extraInput',
    'extraSelector',
    'missingLimit',
    'badSeal',
  ] as const)(
    'rejects invalid %s input before a session or storage await',
    async (kind) => {
      const t = await setup(),
        raw = structuredClone(t.input) as unknown as Record<string, unknown>;
      const cursor = raw.cursor as Record<string, unknown>;
      if (kind === 'limit') cursor.limit = 101;
      if (kind === 'phase') cursor.phase = 'NEXT';
      if (kind === 'after') cursor.afterId = 'bad';
      if (kind === 'completeAfter') {
        cursor.phase = 'COMPLETE';
        cursor.afterId = 'a'.repeat(64);
      }
      if (kind === 'extraCursor') cursor.digest = 'a'.repeat(64);
      if (kind === 'extraInput') raw.manifestHash = 'a'.repeat(64);
      if (kind === 'extraSelector')
        (raw.selector as Record<string, unknown>).archiveId = t.archive.id;
      if (kind === 'missingLimit') delete cursor.limit;
      if (kind === 'badSeal') raw.expectedSealHash = 'bad';
      const sessions = t.f.sessions.length;
      expect(() => t.f.store.readManifestPage(raw as never)).toThrow('Invalid');
      expect(t.f.sessions).toHaveLength(sessions);
      expect(t.f.calls).toEqual([]);
    },
  );
  it('captures selector, seal and cursor before waiting for the read session', async () => {
    const t = await setup(),
      raw = {
        ...t.input,
        selector: { ...t.input.selector },
        cursor: {
          phase: 'ENTRIES' as const,
          limit: 100 as const,
          afterId: t.entries[0].id,
        },
      };
    const pending = t.f.store.readManifestPage(raw);
    raw.selector.itemId = t.f.id(90);
    raw.expectedSealHash = 'b'.repeat(64);
    raw.cursor.afterId = 'f'.repeat(64);
    const page = await pending;
    expect('rows' in page && page.rows.map((r) => r.id)).toEqual(
      t.entries.slice(1).map((r) => r.id),
    );
  });
  it('returns no page after session-close failure and preserves a prior recipient denial', async () => {
    const t = await setup(),
      before = structuredClone(t.f.state.db);
    t.f.state.endFailure = true;
    await expect(t.f.store.readManifestPage(t.input)).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      t.f.store.readManifestPage({
        ...t.input,
        selector: { ...t.input.selector, actorId: t.f.actorId },
      }),
    ).rejects.toThrow('recipient');
    expect(t.f.state.db).toEqual(before);
  });
  it('registers the existing entry model explicitly without enabling a worker or observer provider', () => {
    const module = TransferItemCaptureModule.register({
      captureBatch: jest.fn(),
    });
    const mongoose = module.imports![0] as DynamicModule;
    const tokens = (mongoose.providers! as Array<{ provide: string }>).map(
      (p) => p.provide,
    );
    expect(tokens).toHaveLength(9);
    expect(tokens).toContain(getModelToken('OwnershipArchiveEntry'));
    expect(tokens).toContain(getModelToken('TransferItemCopyRecord'));
    expect(module.providers).toContainEqual({
      provide: 'ItemCopyRecordStore',
      useExisting: 'ItemCaptureStore',
    });
    expect(module.providers).toHaveLength(4);
  });
});
