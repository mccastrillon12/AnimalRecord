import { ClientSession } from 'mongoose';
import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { ArchiveProjectionRead } from '../../../src/context/animal-transfer/domain/ownership-archive-projection-read';
import {
  ArchiveEvidenceSelection,
  archiveEvidenceHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive-evidence-consumption';
import { buildArchiveEntryReferencePlan } from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
import { buildArchiveRecipientProjection } from '../../../src/context/animal-transfer/domain/ownership-archive-recipient-projection';
import { s3ObservationMetadataHash } from '../../../src/context/animal-transfer/domain/ownership-archive-s3-observation';
import { metadataStore } from '../fixtures/metadata-revalidation-store.fixture';
import {
  historyClone as clone,
  historyKeyFromUrl,
  historyUuid,
} from '../fixtures/ownership-archive-history.fixture';

const urlForKey = (key: string) => `https://test/${key}`;
async function observed(count = 2, retained = false) {
  const s = metadataStore(count, count > 0, retained);
  const id = historyUuid(870);
  let run = await s.repository.start(id, s.fixture.archive.id);
  while (run.phase !== 'METADATA_OBSERVED')
    run = await s.repository.nextPage(id, 100);
  run = await s.repository.startS3(id);
  while (run.s3Observation!.phase !== 'S3_OBSERVED') {
    const page = await s.repository.s3Page(id, 20);
    run = await s.repository.confirmS3(
      page,
      page.items.map((item) => ({
        fileId: item.fileId,
        revision: item.revision,
        sha256: item.intent.sha256,
      })),
    );
  }
  const request: ArchiveEvidenceSelection = {
    runId: id,
    archiveId: s.fixture.archive.id,
    expectedRunRevision: run.revision,
    expectedEvidenceHash: archiveEvidenceHash(run),
  };
  const read = async (input = request) => {
    const session = await s.runs.db.startSession();
    try {
      return (await session.withTransaction(() =>
        s.repository.readRecipientProjectionWithinTransaction(
          input,
          session as unknown as ClientSession,
          urlForKey,
        ),
      )) as ArchiveProjectionRead;
    } finally {
      await session.endSession();
    }
  };
  return { ...s, request, read };
}

describe('Projection read in the caller snapshot (simulated models/sessions)', () => {
  it.each([
    [2, false],
    [0, false],
    [1, true],
  ] as const)(
    'returns a detached complete candidate and exact evidence without any writes (count=%s, retained=%s)',
    async (count, retained) => {
      const s = await observed(count, retained);
      const before = clone(s.state.db);
      const models = [
        s.runs,
        s.archives,
        s.entries,
        s.files,
        s.registrations,
        s.controls,
        s.periods,
      ];
      const starts = s.runs.db.startSession.mock.calls.length;
      const writes = models.map((m) => [
        m.updateOne.mock.calls.length,
        m.create.mock.calls.length,
        m.findOneAndUpdate.mock.calls.length,
      ]);
      const queries = models.map((m) => ({
        find: m.find.mock.calls.length,
        findOne: m.findOne.mock.calls.length,
        count: m.countDocuments.mock.calls.length,
        exists: m.exists.mock.calls.length,
      }));
      const session = await s.runs.db.startSession();
      await session.withTransaction(async () => {
        const result =
          await s.repository.readRecipientProjectionWithinTransaction(
            s.request,
            session as unknown as ClientSession,
            urlForKey,
          );
        expect(result.evidence).toEqual(s.request);
        expect(result.projection).toEqual(
          buildArchiveRecipientProjection(
            before.archives[0],
            before.entries,
            before.files,
            before.registrations,
            { keyFromUrl: historyKeyFromUrl, urlForKey },
          ),
        );
        expect(result).not.toHaveProperty('canCommit');
        expect(result).not.toHaveProperty('consumption');
        expect(s.runs.db.startSession.mock.calls).toHaveLength(starts + 1); // Caller only.
        expect(session.abortTransaction).not.toHaveBeenCalled();
        for (const [i, model] of models.entries()) {
          expect([
            model.updateOne.mock.calls.length,
            model.create.mock.calls.length,
            model.findOneAndUpdate.mock.calls.length,
          ]).toEqual(writes[i]);
          for (const [operation, from] of [
            [model.find, queries[i].find],
            [model.findOne, queries[i].findOne],
            [model.countDocuments, queries[i].count],
            [model.exists, queries[i].exists],
          ] as const)
            for (const result of operation.mock.results.slice(from)) {
              if (result.type !== 'return') throw new Error('Expected a query');
              expect(result.value.session).toHaveBeenCalledWith(session);
            }
        }
        result.projection.entries[0].payload.ownerId = 'changed output';
        expect(session.current.db).toEqual(before);
      });
      expect(s.state.db).toEqual(before);
      await session.endSession();
    },
  );
  it('reads multiple pages with bounded queries and terminal reads in a single session', async () => {
    const s = await observed(100);
    const starts = [
      s.entries.find.mock.calls.length,
      s.files.find.mock.calls.length,
      s.registrations.find.mock.calls.length,
    ];
    const result = await s.read();
    expect(result.projection.entries).toHaveLength(101);
    expect(result.projection.media).toHaveLength(101);
    for (const [i, model] of [s.entries, s.files, s.registrations].entries()) {
      const calls = model.find.mock.calls.slice(starts[i]);
      expect(calls.length).toBeGreaterThan(1);
      expect(calls[1][0]).toHaveProperty('id.$gt');
      for (const result of model.find.mock.results.slice(starts[i])) {
        if (result.type !== 'return') throw new Error('Expected a query');
        expect(result.value.sort).toHaveBeenCalledWith({ id: 1 });
        for (const [limit] of result.value.limit.mock.calls)
          expect(limit).toBeLessThanOrEqual(100);
      }
    }
  });
  it.each([
    'inactive',
    'ended',
    'foreign client',
    'read concern',
    'write concern',
    'read preference',
    'model client',
  ])(
    'rejects %s before database queries and without aborting an unvalidated session',
    async (problem) => {
      const s = await observed();
      const session = await s.runs.db.startSession();
      const beforeReads = s.runs.findOne.mock.calls.length;
      await expect(
        session.withTransaction(async () => {
          if (problem === 'inactive')
            session.inTransaction.mockReturnValue(false);
          if (problem === 'ended') session.hasEnded = true;
          if (problem === 'foreign client') session.client = {};
          if (problem === 'read concern')
            session.transaction.options.readConcern = { level: 'local' };
          if (problem === 'write concern')
            session.transaction.options.writeConcern = { w: '1' };
          if (problem === 'read preference')
            session.transaction.options.readPreference = 'secondary';
          if (problem === 'model client') s.files.db.getClient = () => ({});
          await s.repository.readRecipientProjectionWithinTransaction(
            s.request,
            session as unknown as ClientSession,
            urlForKey,
          );
        }),
      ).rejects.toThrow('caller active');
      expect(s.runs.findOne.mock.calls).toHaveLength(beforeReads);
      expect(session.abortTransaction).not.toHaveBeenCalled();
    },
  );
  it.each(['runId', 'archiveId', 'revision', 'hash', 'newline hash'])(
    'rejects invalid/stale selection %s and aborts the validated transaction',
    async (problem) => {
      const s = await observed();
      const before = clone(s.state.db);
      const request = { ...s.request };
      if (problem === 'runId') request.runId = 'bad';
      if (problem === 'archiveId') request.archiveId = historyUuid(999);
      if (problem === 'revision') request.expectedRunRevision--;
      if (problem === 'hash') request.expectedEvidenceHash = 'b'.repeat(64);
      if (problem === 'newline hash') request.expectedEvidenceHash += '\n';
      await expect(s.read(request)).rejects.toThrow();
      expect(s.sessions.at(-1)!.abortTransaction).toHaveBeenCalledTimes(1);
      expect(s.state.db).toEqual(before);
    },
  );
  it.each([
    'epoch',
    'preparation',
    'plan',
    'materialization',
    'writer',
    'owner',
    'period',
    'metadata phase',
    's3 phase',
    'missing pins',
    'header consumed',
    'run consumed',
  ])('rejects %s drift already visible in the snapshot', async (problem) => {
    const s = await observed();
    const db = s.state.db;
    if (problem === 'epoch') db.controls[0].reservationEpoch! += 2;
    if (problem === 'preparation')
      db.controls[0].archivePreparationRevision = 0;
    if (problem === 'plan') db.controls[0].archiveReferencePlanRevision = 0;
    if (problem === 'materialization')
      db.controls[0].archiveMaterializationRevision!++;
    if (problem === 'writer')
      db.controls[0].activeWrites = [
        { token: 'legacy', startedAt: '2020-01-01' },
      ];
    if (problem === 'owner') db.controls[0].ownerId = historyUuid(999);
    if (problem === 'period') db.periods[0].status = 'CLOSED';
    if (problem === 'metadata phase') db.runs[0].phase = 'FILES';
    if (problem === 's3 phase') db.runs[0].s3Observation!.phase = 'OBSERVING';
    if (problem === 'missing pins') delete db.runs[0].pipelineFence;
    if (problem === 'header consumed')
      Object.assign(db.archives[0], { evidenceConsumption: {} });
    if (problem === 'run consumed')
      Object.assign(db.runs[0], { consumption: {} });
    const before = clone(db);
    await expect(s.read()).rejects.toThrow();
    expect(s.state.db).toEqual(before);
  });
  it.each([
    'valid changed payload',
    'entry digest',
    'file digest',
    'observation digest',
    'entry cursor',
    'file cursor',
    's3 cursor',
  ])(
    'rebuilds evidence digests/cursors and rejects %s despite a matching selection hash',
    async (problem) => {
      const s = await observed();
      const run = s.state.db.runs[0];
      if (problem === 'valid changed payload') {
        const entry = s.state.db.entries.find(
          (entry) => entry.kind === 'ANIMAL',
        )!;
        entry.payload.name = 'Changed locally with valid new plan';
        entry.contentHash = archiveHash({
          kind: entry.kind,
          payload: entry.payload,
          fileBindings: entry.fileBindings,
        });
        entry.referencePlan = buildArchiveEntryReferencePlan(
          s.state.db.archives[0],
          entry,
          s.state.db.files.filter((file) =>
            entry.fileBindings.some((b) => b.fileId === file.id),
          ),
          historyKeyFromUrl,
        );
      }
      if (problem === 'entry digest') run.entryDigest = 'a'.repeat(64);
      if (problem === 'file digest') {
        run.fileDigest = 'a'.repeat(64);
        run.s3Observation!.manifestDigest = run.fileDigest;
      }
      if (problem === 'observation digest')
        run.s3Observation!.observationDigest = 'a'.repeat(64);
      if (problem === 'entry cursor') run.entryAfterId = 'a'.repeat(64);
      if (problem === 'file cursor') run.fileAfterId = 'a'.repeat(64);
      if (problem === 's3 cursor') run.s3Observation!.afterId = 'a'.repeat(64);
      run.s3Observation!.metadataHash = s3ObservationMetadataHash(run);
      const request = {
        ...s.request,
        expectedEvidenceHash: archiveEvidenceHash(run),
      };
      await expect(s.read(request)).rejects.toThrow('projection differs');
    },
  );
  it.each(['missing page', 'oversized page', 'duplicate cursor'])(
    'refuses a simulated %s without returning a partial result',
    async (problem) => {
      const s = await observed();
      const find = s.entries.find.getMockImplementation()!;
      s.entries.find.mockImplementationOnce((filter) => {
        const q = find(filter);
        q.exec.mockResolvedValue(
          problem === 'missing page'
            ? []
            : Array.from(
                { length: problem === 'oversized page' ? 101 : 2 },
                () => clone(s.state.db.entries[0]),
              ),
        );
        return q;
      });
      await expect(s.read()).rejects.toThrow();
    },
  );
  it('aborts prior caller writes on read failure, preserving the original cause even if abort fails', async () => {
    const s = await observed();
    const before = clone(s.state.db);
    const session = await s.runs.db.startSession();
    await expect(
      session.withTransaction(async () => {
        await s.periods
          .updateOne(
            { id: s.fixture.archive.periodId },
            { $set: { syntheticCallerWrite: true } },
            { session },
          )
          .exec();
        session.abortTransaction.mockRejectedValueOnce(
          new Error('abort failed'),
        );
        await s.repository.readRecipientProjectionWithinTransaction(
          { ...s.request, expectedEvidenceHash: 'b'.repeat(64) },
          session as unknown as ClientSession,
          urlForKey,
        );
      }),
    ).rejects.toThrow('evidence changed');
    expect(s.state.db).toEqual(before);
  });
  it('does not treat a read-only snapshot as a lock against a later successful consumer', async () => {
    const s = await observed();
    const outer = await s.runs.db.startSession();
    await expect(
      outer.withTransaction(async () => {
        // Pin with a query BEFORE the competitor; Mongo does not pin on startSession alone.
        const snapshotQuery = s.runs.findOne({ id: s.request.runId });
        snapshotQuery.session(outer);
        await snapshotQuery.exec();
        const other = await s.runs.db.startSession();
        await other.withTransaction(() =>
          s.repository.consumeWithinTransaction(
            { ...s.request, id: historyUuid(871) },
            other as unknown as ClientSession,
          ),
        );
        const result =
          await s.repository.readRecipientProjectionWithinTransaction(
            s.request,
            outer as unknown as ClientSession,
            urlForKey,
          );
        expect(result.evidence).toEqual(s.request); // Coherent OLD snapshot, never latest-state permission.
        expect(s.state.db.archives[0].evidenceConsumption).toBeDefined();
        throw new Error('Stop read-only snapshot example without commit');
      }),
    ).rejects.toThrow('Stop read-only snapshot');
    await expect(s.read()).rejects.toThrow('consumed');
  });
  it('a competing consumption after reading prevents a later stale joint transaction from committing in the snapshot double', async () => {
    const s = await observed();
    const outer = await s.runs.db.startSession();
    let raced = false;
    await expect(
      outer.withTransaction(async () => {
        await s.repository.readRecipientProjectionWithinTransaction(
          s.request,
          outer as unknown as ClientSession,
          urlForKey,
        );
        if (!raced) {
          raced = true;
          const other = await s.runs.db.startSession();
          await other.withTransaction(() =>
            s.repository.consumeWithinTransaction(
              { ...s.request, id: historyUuid(871) },
              other as unknown as ClientSession,
            ),
          );
        }
        await s.repository.consumeWithinTransaction(
          { ...s.request, id: historyUuid(872) },
          outer as unknown as ClientSession,
        );
        await s.periods
          .updateOne(
            { id: s.fixture.archive.periodId },
            { $set: { syntheticStaleWrite: true } },
            { session: outer },
          )
          .exec();
      }),
    ).rejects.toThrow('consumed');
    expect(s.state.db.archives[0].evidenceConsumption!.id).toBe(
      historyUuid(871),
    );
    expect(s.state.db.periods[0]).not.toHaveProperty('syntheticStaleWrite');
  });
  it('exports an alias of the SAME persistence collaborator without controllers or automatic execution', () => {
    expect(
      Reflect.getMetadata('providers', OwnershipArchiveModule) as unknown[],
    ).toContainEqual({
      provide: 'OwnershipArchiveProjectionRead',
      useExisting: 'OwnershipArchiveMetadataRevalidationRepository',
    });
    expect(
      Reflect.getMetadata('exports', OwnershipArchiveModule) as unknown[],
    ).toContain('OwnershipArchiveProjectionRead');
    expect(
      Reflect.getMetadata('controllers', OwnershipArchiveModule),
    ).toBeUndefined();
  });
});
