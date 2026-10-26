import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import { OwnershipArchiveMetadataRevalidator } from '../../../src/context/animal-transfer/application/ownership-archive-metadata-revalidator';
import { OwnershipArchiveMetadataRevalidationSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-metadata-revalidation.schema';
import { metadataStore } from '../fixtures/metadata-revalidation-store.fixture';
import {
  historyClone as clone,
  historyUuid,
} from '../fixtures/ownership-archive-history.fixture';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';

const id = historyUuid(800);
const complete = async (s: ReturnType<typeof metadataStore>, limit = 2) => {
  let run = await s.repository.start(id, s.fixture.archive.id);
  for (let page = 0; page < 20 && run.phase !== 'METADATA_OBSERVED'; page++)
    run = await s.repository.nextPage(id, limit);
  expect(run.phase).toBe('METADATA_OBSERVED');
  return run;
};
describe('Fenced metadata traversal, not S3/ownership authorization', () => {
  it('covers all entries/files/registrations with bounded pages and records deterministic digests', async () => {
    const s = metadataStore(3);
    const original = clone(s.state.db);
    const run = await complete(s, 2);
    expect(run.entryCount).toBe(4);
    expect(run.fileCount).toBe(4);
    expect(run.revision).toBe(6); // full pages require a final empty page in each phase
    expect(run.controlRevision).toBe(
      s.state.db.controls[0].archiveMaterializationRevision,
    );
    let entryDigest = archiveHash([]),
      fileDigest = archiveHash([]);
    for (const entry of s.fixture.entries)
      entryDigest = archiveHash([
        entryDigest,
        entry.id,
        entry.contentHash,
        entry.referencePlan!.planHash,
      ]);
    for (const file of s.fixture.files)
      fileDigest = archiveHash([
        fileDigest,
        file.id,
        file.definitionHash,
        s.fixture.registrations.find((row) => row.fileId === file.id)!
          .definitionHash,
      ]);
    expect(run.entryDigest).toBe(entryDigest);
    expect(run.fileDigest).toBe(fileDigest);
    expect(s.state.db.archives).toEqual(original.archives);
    expect(s.state.db.entries).toEqual(original.entries);
    expect(s.state.db.files).toEqual(original.files);
    expect(s.state.db.registrations).toEqual(original.registrations);
    expect(s.state.db.periods).toEqual(original.periods);
    expect(s.state.db.controls[0].transferLock).toEqual(
      original.controls[0].transferLock,
    );
    expect(s.state.db.controls[0].activeWrites).toEqual([]);
    expect(s.storage.keyFromUrl).toHaveBeenCalled();
    expect(Object.keys(s.storage)).toEqual(['keyFromUrl']);
    expect(run).not.toHaveProperty('canCommit');
    expect(
      s.sessions.every((session) => session.endSession.mock.calls.length === 1),
    ).toBe(true);
    expect(s.sessions[0].withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      },
    );
  });
  it('produces the same metadata digests regardless of page boundaries', async () => {
    const first = await complete(metadataStore(4), 1);
    const second = await complete(metadataStore(4), 3);
    expect(first.entryDigest).toBe(second.entryDigest);
    expect(first.fileDigest).toBe(second.fileDigest);
  });
  it('handles a profile without files and empty manifest without fabricated registrations', async () => {
    const s = metadataStore(0, false);
    const run = await complete(s);
    expect(run.entryCount).toBe(1);
    expect(run.fileCount).toBe(0);
    expect(run.fileDigest).toBe(archiveHash([]));
    expect(s.state.db.registrations).toEqual([]);
  });
  it('covers retained records separately and preserves root/inherited identities', async () => {
    const s = metadataStore(1, true, true);
    const before = clone(
      s.state.db.entries.find((entry) => entry.kind === 'RETAINED_RECORD'),
    );
    const run = await complete(s);
    expect(run.entryCount).toBe(3);
    expect(
      s.state.db.entries.find((entry) => entry.kind === 'RETAINED_RECORD'),
    ).toEqual(before);
    expect(
      s.state.db.registrations.filter(
        (row) => row.mode === 'RETAINED_READ_ONLY',
      ),
    ).toHaveLength(1);
  });
  it('repeats start and terminal observation without resetting progress or advancing the control', async () => {
    const s = metadataStore();
    const run = await complete(s);
    const before = clone(s.state.db);
    await expect(s.repository.start(id, s.fixture.archive.id)).resolves.toEqual(
      run,
    );
    await expect(s.repository.nextPage(id, 2)).resolves.toEqual(run);
    expect(s.state.db).toEqual(before);
  });
  it.each(['start', 'page'] as const)(
    'reconciles a lost %s commit reply without resetting or double counting',
    async (step) => {
      const s = metadataStore();
      if (step === 'page') await s.repository.start(id, s.fixture.archive.id);
      s.state.loseReply = true;
      if (step === 'start')
        await expect(
          s.repository.start(id, s.fixture.archive.id),
        ).rejects.toThrow('commit reply lost');
      else
        await expect(s.repository.nextPage(id, 1)).rejects.toThrow(
          'commit reply lost',
        );
      const persisted = clone(s.state.db.runs[0]);
      await expect(
        s.repository.start(id, s.fixture.archive.id),
      ).resolves.toEqual(persisted);
      const next = await s.repository.nextPage(id, 1);
      expect(next.entryCount).toBe(persisted.entryCount + 1);
      expect(s.state.db.runs).toHaveLength(1);
    },
  );
  it('concurrent page calls retry their snapshots and never count the same entry twice', async () => {
    const s = metadataStore(4);
    await s.repository.start(id, s.fixture.archive.id);
    await Promise.all([
      s.repository.nextPage(id, 1),
      s.repository.nextPage(id, 1),
    ]);
    expect(s.state.db.runs[0].entryCount).toBe(2);
    expect(s.state.db.runs[0].revision).toBe(2);
    const run = await complete(s, 2);
    expect(run.entryCount).toBe(5);
  });
  it.each(['control revision', 'lock timestamp', 'other run'])(
    'refuses stale progress after %s without repinning',
    async (problem) => {
      const s = metadataStore();
      await s.repository.start(id, s.fixture.archive.id);
      if (problem === 'control revision')
        s.state.db.controls[0].archiveMaterializationRevision!++;
      if (problem === 'lock timestamp')
        s.state.db.controls[0].transferLock!.lockedAt = '2026-10-26';
      if (problem === 'other run')
        await s.repository.start(historyUuid(801), s.fixture.archive.id);
      const before = clone(s.state.db);
      await expect(s.repository.nextPage(id, 1)).rejects.toThrow('stale');
      await expect(
        s.repository.start(id, s.fixture.archive.id),
      ).rejects.toThrow('stale');
      expect(s.state.db).toEqual(before);
    },
  );
  it('a competing pipeline write during a page invalidates its retry; no partial fence/cursor commit', async () => {
    const s = metadataStore();
    await s.repository.start(id, s.fixture.archive.id);
    s.state.beforeSave = () => {
      s.state.db.controls[0].archiveMaterializationRevision!++;
      s.state.epoch++;
      s.state.beforeSave = undefined;
    };
    const previous = clone(s.state.db.runs[0]);
    await expect(s.repository.nextPage(id, 1)).rejects.toThrow('stale');
    expect(s.state.db.runs[0]).toEqual(previous);
  });
  it.each([
    'period',
    'owner',
    'version',
    'reservation',
    'writer',
    'plan definition',
  ])('denies %s changes without advancing the run', async (problem) => {
    const s = metadataStore();
    await s.repository.start(id, s.fixture.archive.id);
    if (problem === 'period') s.state.db.periods[0].status = 'CLOSED';
    if (problem === 'owner') s.state.db.controls[0].ownerId = historyUuid(999);
    if (problem === 'version') s.state.db.controls[0].ownershipVersion++;
    if (problem === 'reservation')
      s.state.db.controls[0].transferLock = undefined;
    if (problem === 'writer')
      s.state.db.controls[0].activeWrites = [
        { token: 'legacy', startedAt: 'before' },
      ];
    if (problem === 'plan definition')
      s.state.db.archives[0].referencePlan!.revision++;
    const before = clone(s.state.db);
    await expect(s.repository.nextPage(id, 1)).rejects.toThrow();
    expect(s.state.db).toEqual(before);
  });
  it.each([
    'payload',
    'plan',
    'missing referenced file',
    'bad result',
    'wrong recipient key',
  ])('rejects %s while rebuilding entries', async (problem) => {
    const s = metadataStore();
    await s.repository.start(id, s.fixture.archive.id);
    if (problem === 'payload')
      s.state.db.entries[0].payload.name = 'not original';
    if (problem === 'plan')
      s.state.db.entries[0].referencePlan!.planHash = 'bad';
    if (problem === 'missing referenced file') s.state.db.files = [];
    if (problem === 'bad result')
      s.state.db.files[0].materialization!.verified!.size++;
    if (problem === 'wrong recipient key')
      s.state.db.files[0].materialization!.intent.destinationKey =
        s.state.db.files[0].recipientFinalKey;
    const before = clone(s.state.db);
    await expect(s.repository.nextPage(id, 100)).rejects.toThrow();
    expect(s.state.db).toEqual(before);
  });
  it.each([
    'missing registration',
    'duplicate registration',
    'changed revision',
    'extra registration',
    'unreferenced file',
    'missing profile',
  ])('does not emit a terminal observation with %s', async (problem) => {
    const s = metadataStore();
    await s.repository.start(id, s.fixture.archive.id);
    await s.repository.nextPage(id, 100);
    if (problem === 'missing registration') s.state.db.registrations.pop();
    if (problem === 'duplicate registration')
      s.state.db.registrations.push(clone(s.state.db.registrations[0]));
    if (problem === 'changed revision')
      s.state.db.registrations[0].revision.etag = 'wrong';
    if (problem === 'extra registration')
      s.state.db.registrations.push({
        ...s.state.db.registrations[0],
        fileId: 'x',
        id: 'extra',
      });
    if (problem === 'unreferenced file')
      s.state.db.entries = s.state.db.entries.filter(
        (entry) =>
          !entry.fileBindings.some(
            (binding) => binding.fileId === s.state.db.files[0].id,
          ),
      );
    if (problem === 'missing profile')
      s.state.db.entries = s.state.db.entries.filter(
        (entry) => entry.kind !== 'ANIMAL',
      );
    const before = clone(s.state.db);
    await expect(s.repository.nextPage(id, 100)).rejects.toThrow();
    expect(s.state.db).toEqual(before);
    expect(s.state.db.runs[0].phase).toBe('FILES');
  });
  it('does not commit a control increment if the checkpoint CAS fails', async () => {
    const s = metadataStore();
    await s.repository.start(id, s.fixture.archive.id);
    s.state.failSave = true;
    const before = clone(s.state.db);
    await expect(s.repository.nextPage(id, 1)).rejects.toThrow('page changed');
    expect(s.state.db).toEqual(before);
  });
  it('a previously terminal observation is rejected after a later pipeline revision', async () => {
    const s = metadataStore();
    const run = await complete(s);
    s.state.db.controls[0].archiveMaterializationRevision!++;
    await expect(s.repository.nextPage(id, 20)).rejects.toThrow('stale');
    expect(s.state.db.runs[0]).toEqual(run);
  });
  it('does not adopt a run ID from another archive', async () => {
    const s = metadataStore();
    await s.repository.start(id, s.fixture.archive.id);
    s.state.db.runs[0].archiveId = historyUuid(999);
    const before = clone(s.state.db);
    await expect(s.repository.start(id, s.fixture.archive.id)).rejects.toThrow(
      'identity',
    );
    expect(s.state.db).toEqual(before);
  });
  it('supports an absent legacy materialization revision without backfilling unrelated fields', async () => {
    const s = metadataStore();
    delete s.state.db.controls[0].archiveMaterializationRevision;
    const run = await s.repository.start(id, s.fixture.archive.id);
    expect(run.controlRevision).toBe(1);
    expect(s.controls.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        archiveMaterializationRevision: { $exists: false },
        'transferLock.lockedAt': s.fixture.control.transferLock.lockedAt,
      }),
      { $inc: { archiveMaterializationRevision: 1 } },
      { session: s.sessions[0] },
    );
    expect(s.state.db.controls[0].transferLock).toEqual(
      s.fixture.control.transferLock,
    );
  });
  it('uses bounded ordered queries and the same session for checkpoint/control updates', async () => {
    const s = metadataStore();
    const run = await s.repository.start(id, s.fixture.archive.id);
    await s.repository.nextPage(id, 1);
    expect(s.entries.find).toHaveBeenCalledWith({
      archiveId: s.fixture.archive.id,
    });
    const session = s.sessions[1];
    expect(s.runs.updateOne).toHaveBeenCalledWith(
      {
        id,
        definitionHash: run.definitionHash,
        revision: 0,
        phase: 'ENTRIES',
        controlRevision: run.controlRevision,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          revision: 1,
          entryCount: 1,
        }) as unknown,
      }),
      { session },
    );
    expect(s.controls.updateOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archiveMaterializationRevision: run.controlRevision,
        'transferLock.transferId': s.fixture.archive.transferId,
        'transferLock.lockedAt': s.fixture.control.transferLock.lockedAt,
      }),
      { $inc: { archiveMaterializationRevision: 1 } },
      { session },
    );
    await s.repository.nextPage(id, 1);
    expect(s.entries.find).toHaveBeenLastCalledWith({
      archiveId: s.fixture.archive.id,
      id: { $gt: s.fixture.entries[0].id },
    });
  });
  it('declares internal wiring and explicit states with no TTL/permission/activation defaults', () => {
    expect(
      Reflect.getMetadata('exports', OwnershipArchiveModule) as unknown[],
    ).toContain(OwnershipArchiveMetadataRevalidator);
    expect(
      Reflect.getMetadata('controllers', OwnershipArchiveModule),
    ).toBeUndefined();
    expect(
      OwnershipArchiveMetadataRevalidationSchema.path('phase').options.enum,
    ).toEqual(['ENTRIES', 'FILES', 'METADATA_OBSERVED']);
    expect(
      OwnershipArchiveMetadataRevalidationSchema.path('phase').options.default,
    ).toBeUndefined();
    expect(
      OwnershipArchiveMetadataRevalidationSchema.path('canCommit'),
    ).toBeUndefined();
    expect(
      OwnershipArchiveMetadataRevalidationSchema.indexes().every(
        ([, options]) => options.expireAfterSeconds === undefined,
      ),
    ).toBe(true);
  });
});
