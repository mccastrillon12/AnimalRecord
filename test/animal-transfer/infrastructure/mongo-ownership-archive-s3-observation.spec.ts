import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import { OwnershipArchiveS3Observer } from '../../../src/context/animal-transfer/application/ownership-archive-s3-observer';
import { OwnershipArchiveMetadataRevalidationSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-metadata-revalidation.schema';
import { ArchiveS3ObservationPage } from '../../../src/context/animal-transfer/domain/ownership-archive-s3-observation';
import { metadataStore } from '../fixtures/metadata-revalidation-store.fixture';
import {
  historyClone as clone,
  historyUuid,
} from '../fixtures/ownership-archive-history.fixture';

const id = historyUuid(800);
const ready = async (medicalCount = 2, profile = true) => {
  const s = metadataStore(medicalCount, profile);
  let run = await s.repository.start(id, s.fixture.archive.id);
  while (run.phase !== 'METADATA_OBSERVED')
    run = await s.repository.nextPage(id, 100);
  return s;
};
const receipts = (page: ArchiveS3ObservationPage) =>
  page.items.map((item) => ({
    fileId: item.fileId,
    revision: clone(item.revision),
    sha256: item.intent.sha256,
  }));

describe('Mongo checkpoint for read-only S3 observations', () => {
  it('starts explicitly with no new collection/default and preserves metadata roots and records', async () => {
    const s = await ready();
    const original = clone(s.state.db);
    const run = await s.repository.startS3(id);
    expect(run.s3Observation!.phase).toBe('OBSERVING');
    expect(run.s3Observation!.count).toBe(0);
    expect(run.entryDigest).toBe(original.runs[0].entryDigest);
    expect(run.fileDigest).toBe(original.runs[0].fileDigest);
    expect(run.controlRevision).toBe(
      original.controls[0].archiveMaterializationRevision! + 1,
    );
    const before = clone(s.state.db);
    await expect(s.repository.startS3(id)).resolves.toEqual(run);
    expect(s.state.db).toEqual(before);
    expect(s.state.db.archives).toEqual(original.archives);
    expect(s.state.db.files).toEqual(original.files);
    expect(s.state.db.registrations).toEqual(original.registrations);
  });
  it('checkpoints exact sequential pages and matches the complete metadata manifest digest', async () => {
    const s = await ready();
    await s.repository.startS3(id);
    const original = clone(s.state.db);
    let run = s.state.db.runs[0];
    while (run.s3Observation!.phase !== 'S3_OBSERVED') {
      const page = await s.repository.s3Page(id, 1);
      run = await s.repository.confirmS3(page, receipts(page));
    }
    expect(run.s3Observation!.count).toBe(s.fixture.files.length);
    expect(run.s3Observation!.manifestDigest).toBe(run.fileDigest);
    expect(run.s3Observation!.revision).toBe(s.fixture.files.length + 1);
    expect(run.controlRevision).toBe(
      s.state.db.controls[0].archiveMaterializationRevision,
    );
    expect(s.state.db.archives).toEqual(original.archives);
    expect(s.state.db.entries).toEqual(original.entries);
    expect(s.state.db.files).toEqual(original.files);
    expect(s.state.db.registrations).toEqual(original.registrations);
    expect(s.state.db.periods).toEqual(original.periods);
    const terminal = await s.repository.s3Page(id, 5);
    expect(terminal.items).toEqual([]);
    expect(terminal.run.s3Observation!.phase).toBe('S3_OBSERVED');
  });
  it('can finish an empty manifest without any invented receipt', async () => {
    const s = await ready(0, false);
    await s.repository.startS3(id);
    const page = await s.repository.s3Page(id, 5);
    expect(page.items).toEqual([]);
    const result = await s.repository.confirmS3(page, []);
    expect(result.s3Observation!.phase).toBe('S3_OBSERVED');
    expect(result.s3Observation!.count).toBe(0);
  });
  it('never starts before the complete metadata traversal or adopts a stale metadata run', async () => {
    const s = metadataStore();
    await s.repository.start(id, s.fixture.archive.id);
    await expect(s.repository.startS3(id)).rejects.toThrow('Complete metadata');
    while (s.state.db.runs[0].phase !== 'METADATA_OBSERVED')
      await s.repository.nextPage(id, 100);
    s.state.db.controls[0].archiveMaterializationRevision!++;
    await expect(s.repository.startS3(id)).rejects.toThrow('stale');
    expect(s.state.db.runs[0].s3Observation).toBeUndefined();
  });
  it('a page read does not advance a checkpoint or keep a transaction open for S3', async () => {
    const s = await ready();
    await s.repository.startS3(id);
    const before = clone(s.state.db);
    await s.repository.s3Page(id, 1);
    expect(s.state.db).toEqual(before);
    expect(s.sessions[s.sessions.length - 1].endSession).toHaveBeenCalledTimes(
      1,
    );
  });
  it.each([
    'pipeline revision',
    'reservation',
    'owner',
    'version',
    'legacy writer',
    'period',
  ])('rejects a remote result after changing %s', async (problem) => {
    const s = await ready();
    await s.repository.startS3(id);
    const page = await s.repository.s3Page(id, 5);
    if (problem === 'pipeline revision')
      s.state.db.controls[0].archiveMaterializationRevision!++;
    if (problem === 'reservation')
      s.state.db.controls[0].transferLock!.lockedAt = 'other';
    if (problem === 'owner') s.state.db.controls[0].ownerId = historyUuid(999);
    if (problem === 'version') s.state.db.controls[0].ownershipVersion++;
    if (problem === 'legacy writer')
      s.state.db.controls[0].activeWrites = [
        { token: 'legacy', startedAt: 'before' },
      ];
    if (problem === 'period') s.state.db.periods[0].status = 'CLOSED';
    const before = clone(s.state.db);
    await expect(
      s.repository.confirmS3(page, receipts(page)),
    ).rejects.toThrow();
    expect(s.state.db).toEqual(before);
  });
  it('two readers of one page cannot checkpoint/count it twice, even when they finish together', async () => {
    const s = await ready();
    await s.repository.startS3(id);
    const [a, b] = await Promise.all([
      s.repository.s3Page(id, 1),
      s.repository.s3Page(id, 1),
    ]);
    const result = await Promise.allSettled([
      s.repository.confirmS3(a, receipts(a)),
      s.repository.confirmS3(b, receipts(b)),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(s.state.db.runs[0].s3Observation!.count).toBe(1);
    expect(s.state.db.runs[0].s3Observation!.revision).toBe(1);
  });
  it('late reads from a different superseded run cannot checkpoint', async () => {
    const s = await ready();
    await s.repository.startS3(id);
    const page = await s.repository.s3Page(id, 5);
    await s.repository.start(historyUuid(801), s.fixture.archive.id);
    await expect(s.repository.confirmS3(page, receipts(page))).rejects.toThrow(
      'stale',
    );
    expect(s.state.db.runs[0].s3Observation!.count).toBe(0);
  });
  it.each([
    'registration',
    'manifest receipt',
    'missing receipt',
    'metadata digest',
  ])('does not checkpoint changed %s', async (problem) => {
    const s = await ready();
    await s.repository.startS3(id);
    const page = await s.repository.s3Page(id, 5);
    const result = receipts(page);
    if (problem === 'registration')
      s.state.db.registrations[0].revision.etag = 'changed';
    if (problem === 'manifest receipt')
      page.items[0].registrationDefinitionHash = 'c'.repeat(64);
    if (problem === 'missing receipt') result.pop();
    if (problem === 'metadata digest')
      s.state.db.runs[0].fileDigest = 'd'.repeat(64);
    const before = clone(s.state.db);
    await expect(s.repository.confirmS3(page, result)).rejects.toThrow();
    expect(s.state.db).toEqual(before);
  });
  it('a lost checkpoint reply resumes from durable progress without recounting or resetting', async () => {
    const s = await ready();
    await s.repository.startS3(id);
    const page = await s.repository.s3Page(id, 5);
    s.state.loseReply = true;
    await expect(s.repository.confirmS3(page, receipts(page))).rejects.toThrow(
      'commit reply lost',
    );
    const recorded = clone(s.state.db.runs[0]);
    expect(recorded.s3Observation!.phase).toBe('S3_OBSERVED');
    await expect(s.repository.startS3(id)).resolves.toEqual(recorded);
    const terminal = await s.repository.s3Page(id, 5);
    expect(terminal.items).toEqual([]);
    expect(s.state.db.runs[0]).toEqual(recorded);
  });
  it('a failed checkpoint rolls back its control increment, without compensating remote reads', async () => {
    const s = await ready();
    await s.repository.startS3(id);
    const page = await s.repository.s3Page(id, 5);
    const before = clone(s.state.db);
    s.state.failSave = true;
    await expect(s.repository.confirmS3(page, receipts(page))).rejects.toThrow(
      'checkpoint changed',
    );
    expect(s.state.db).toEqual(before);
  });
  it('preserves explicit initialization after a lost start commit reply', async () => {
    const s = await ready();
    s.state.loseReply = true;
    await expect(s.repository.startS3(id)).rejects.toThrow('commit reply lost');
    const recorded = clone(s.state.db);
    await expect(s.repository.startS3(id)).resolves.toEqual(recorded.runs[0]);
    expect(s.state.db).toEqual(recorded);
  });
  it('does not return terminal evidence once the control fence becomes stale', async () => {
    const s = await ready();
    await s.repository.startS3(id);
    const page = await s.repository.s3Page(id, 5);
    await s.repository.confirmS3(page, receipts(page));
    s.state.db.controls[0].archiveMaterializationRevision!++;
    await expect(s.repository.s3Page(id, 5)).rejects.toThrow('stale');
    await expect(s.repository.startS3(id)).rejects.toThrow('stale');
    expect(s.state.db.runs[0].s3Observation!.phase).toBe('S3_OBSERVED');
  });
  it('rechecks a competing pipeline advance when the checkpoint snapshot retries', async () => {
    const s = await ready();
    await s.repository.startS3(id);
    const page = await s.repository.s3Page(id, 5);
    const before = clone(s.state.db);
    s.state.beforeSave = () => {
      s.state.beforeSave = undefined;
      s.state.db.controls[0].archiveMaterializationRevision!++;
      s.state.epoch++;
    };
    await expect(s.repository.confirmS3(page, receipts(page))).rejects.toThrow(
      'stale',
    );
    expect(s.state.db.runs).toEqual(before.runs);
    expect(s.state.db.controls[0].archiveMaterializationRevision).toBe(
      before.controls[0].archiveMaterializationRevision! + 1,
    );
  });
  it('exposes only internal observation and adds optional evidence without TTL/backfill or publication', () => {
    expect(
      Reflect.getMetadata('exports', OwnershipArchiveModule) as unknown[],
    ).toContain(OwnershipArchiveS3Observer);
    expect(
      Reflect.getMetadata('controllers', OwnershipArchiveModule),
    ).toBeUndefined();
    const field =
      OwnershipArchiveMetadataRevalidationSchema.path('s3Observation');
    expect(field.options.default).toBeUndefined();
    expect(field.options.required).not.toBe(true);
    expect(
      OwnershipArchiveMetadataRevalidationSchema.indexes().every(
        ([, options]) => options.expireAfterSeconds === undefined,
      ),
    ).toBe(true);
  });
});
