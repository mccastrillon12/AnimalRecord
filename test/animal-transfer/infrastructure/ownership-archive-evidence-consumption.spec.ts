import { ClientSession } from 'mongoose';
import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import {
  ArchiveEvidenceConsumptionRequest,
  ArchiveEvidenceConsumption,
  archiveEvidenceHash,
  buildArchivePipelineFence,
} from '../../../src/context/animal-transfer/domain/ownership-archive-evidence-consumption';
import { OwnershipArchiveSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive.schema';
import { OwnershipArchiveMetadataRevalidationSchema } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/ownership-archive-metadata-revalidation.schema';
import { metadataStore } from '../fixtures/metadata-revalidation-store.fixture';
import {
  historyClone as clone,
  historyUuid,
} from '../fixtures/ownership-archive-history.fixture';

const id = historyUuid(850);
async function observed(count = 2) {
  const s = metadataStore(count, count > 0);
  await s.repository.start(id, s.fixture.archive.id);
  while (s.state.db.runs[0].phase !== 'METADATA_OBSERVED')
    await s.repository.nextPage(id, 100);
  await s.repository.startS3(id);
  const page = await s.repository.s3Page(id, 20);
  await s.repository.confirmS3(
    page,
    page.items.map((item) => ({
      fileId: item.fileId,
      revision: item.revision,
      sha256: item.intent.sha256,
    })),
  );
  const run = clone(s.state.db.runs[0]);
  const request: ArchiveEvidenceConsumptionRequest = {
    id: historyUuid(851),
    runId: id,
    archiveId: s.fixture.archive.id,
    expectedRunRevision: run.revision,
    expectedEvidenceHash: archiveEvidenceHash(run),
  };
  const consume = async (input = request) => {
    const session = await s.runs.db.startSession();
    try {
      return (await session.withTransaction(() =>
        s.repository.consumeWithinTransaction(
          input,
          session as unknown as ClientSession,
        ),
      )) as ArchiveEvidenceConsumption;
    } finally {
      await session.endSession();
    }
  };
  return { ...s, run, request, consume };
}

describe('Single-use evidence consumption in the caller transaction (models simulated)', () => {
  it('marks header/run and advances the shared fence only with a caller transaction; never grants publication', async () => {
    const s = await observed();
    const before = clone(s.state.db);
    const session = await s.runs.db.startSession();
    let provisional: unknown;
    await session.withTransaction(async () => {
      provisional = await s.repository.consumeWithinTransaction(
        s.request,
        session as unknown as ClientSession,
      );
      expect(s.state.db).toEqual(before); // Not externally visible before caller commit.
      await s.periods
        .updateOne(
          { id: s.fixture.archive.periodId },
          { $set: { syntheticJointWrite: true } },
          { session },
        )
        .exec();
    });
    const receipt = s.state.db.archives[0].evidenceConsumption!;
    expect(receipt).toEqual(provisional);
    expect(s.state.db.runs[0].consumption).toEqual(receipt);
    expect(receipt.evidenceHash).toBe(s.request.expectedEvidenceHash);
    expect(receipt).not.toHaveProperty('canCommit');
    expect(receipt).not.toHaveProperty('ownerId');
    expect(s.state.db.controls[0].archiveMaterializationRevision).toBe(
      before.controls[0].archiveMaterializationRevision! + 1,
    );
    expect(s.state.db.runs[0].revision).toBe(s.run.revision + 1);
    expect(s.state.db.periods[0].syntheticJointWrite).toBe(true);
    expect(s.state.db.entries).toEqual(before.entries);
    expect(s.state.db.files).toEqual(before.files);
    expect(s.state.db.registrations).toEqual(before.registrations);
    expect(s.state.db.archives[0].state).toBe('READY');
    expect(s.state.db.controls[0].transferLock).toEqual(
      before.controls[0].transferLock,
    );
    expect(s.state.db.controls[0].reservationEpoch).toBe(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });
  it('supports an empty manifest without remote work or invented receipts', async () => {
    const s = await observed(0);
    await s.consume();
    expect(s.state.db.runs[0].fileCount).toBe(0);
    expect(s.state.db.archives[0].evidenceConsumption).toBeDefined();
  });
  it.each([
    'inactive',
    'ended',
    'foreign client',
    'read concern',
    'write concern',
    'read preference',
    'missing options',
    'model client',
  ])(
    'rejects %s session before any model operation and never starts its own transaction',
    async (problem) => {
      const s = await observed();
      const session = await s.runs.db.startSession();
      const count = s.runs.findOne.mock.calls.length;
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
          if (problem === 'missing options') session.transaction.options = {};
          if (problem === 'model client') s.files.db.getClient = () => ({});
          await s.repository.consumeWithinTransaction(
            s.request,
            session as unknown as ClientSession,
          );
        }),
      ).rejects.toThrow('caller active');
      expect(s.runs.findOne.mock.calls).toHaveLength(count);
      expect(session.abortTransaction).not.toHaveBeenCalled(); // Never abort an unvalidated foreign transaction.
    },
  );
  it.each(['id', 'runId', 'archiveId', 'revision', 'hash', 'hash newline'])(
    'rejects invalid or stale request %s and aborts the validated caller transaction',
    async (problem) => {
      const s = await observed();
      const request = { ...s.request };
      if (problem === 'id') request.id = 'bad';
      if (problem === 'runId') request.runId = historyUuid(999);
      if (problem === 'archiveId') request.archiveId = historyUuid(999);
      if (problem === 'revision') request.expectedRunRevision--;
      if (problem === 'hash') request.expectedEvidenceHash = 'a'.repeat(64);
      if (problem === 'hash newline') request.expectedEvidenceHash += '\n';
      const before = clone(s.state.db);
      await expect(s.consume(request)).rejects.toThrow();
      expect(s.state.db).toEqual(before);
      expect(
        s.sessions[s.sessions.length - 1].abortTransaction,
      ).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    'metadata phase',
    's3 phase',
    'missing pipeline pin',
    'preparation revision',
    'plan revision',
    'materialization revision',
    'reservation',
    'epoch',
    'writer',
    'owner',
    'period',
    'header definition',
    'header binding',
    'run digest',
    's3 digest',
    'counts',
    'overflow',
  ])('refuses %s drift without partial consumption', async (problem) => {
    const s = await observed();
    const run = s.state.db.runs[0];
    const control = s.state.db.controls[0];
    if (problem === 'metadata phase') run.phase = 'FILES';
    if (problem === 's3 phase') run.s3Observation!.phase = 'OBSERVING';
    if (problem === 'missing pipeline pin') delete run.pipelineFence;
    if (problem === 'preparation revision')
      control.archivePreparationRevision = 1;
    if (problem === 'plan revision') control.archiveReferencePlanRevision = 1;
    if (problem === 'materialization revision')
      control.archiveMaterializationRevision!++;
    if (problem === 'reservation') control.transferLock!.lockedAt = 'other';
    if (problem === 'epoch') control.reservationEpoch = 3;
    if (problem === 'writer')
      control.activeWrites = [{ token: 'legacy', startedAt: 'before' }];
    if (problem === 'owner') control.ownerId = historyUuid(999);
    if (problem === 'period') s.state.db.periods[0].status = 'CLOSED';
    if (problem === 'header definition')
      s.state.db.archives[0].definitionHash = 'a'.repeat(64);
    if (problem === 'header binding')
      s.state.db.archives[0].reservation!.epoch = 3;
    if (problem === 'run digest') run.entryDigest = 'a'.repeat(64);
    if (problem === 's3 digest')
      run.s3Observation!.observationDigest = 'a'.repeat(64);
    if (problem === 'counts') s.state.db.registrations.pop();
    if (problem === 'overflow') run.revision = Number.MAX_SAFE_INTEGER;
    const before = clone(s.state.db);
    await expect(s.consume()).rejects.toThrow();
    expect(s.state.db).toEqual(before);
  });
  it('does not treat an absent pipeline counter as persisted zero or retrofit its pin', async () => {
    const s = await observed();
    expect(s.run.pipelineFence).toEqual(
      buildArchivePipelineFence(undefined, undefined),
    );
    s.state.db.controls[0].archivePreparationRevision = 0;
    await expect(s.consume()).rejects.toThrow('stale');
  });
  it('rolls back consumption and a synthetic caller write if later joint work fails', async () => {
    const s = await observed();
    const before = clone(s.state.db);
    const session = await s.runs.db.startSession();
    await expect(
      session.withTransaction(async () => {
        await s.repository.consumeWithinTransaction(
          s.request,
          session as unknown as ClientSession,
        );
        await s.periods
          .updateOne(
            { id: s.fixture.archive.periodId },
            { $set: { syntheticJointWrite: true } },
            { session },
          )
          .exec();
        throw new Error('business write failed');
      }),
    ).rejects.toThrow('business write failed');
    expect(s.state.db).toEqual(before);
    await expect(s.consume()).resolves.toBeDefined(); // Only rolled-back attempt can be run again.
  });
  it('aborts tentative header/control writes on a failed final CAS even when caller swallows the error', async () => {
    const s = await observed();
    const before = clone(s.state.db);
    const session = await s.runs.db.startSession();
    s.state.failSave = true;
    await expect(
      session.withTransaction(async () => {
        await s.repository
          .consumeWithinTransaction(
            s.request,
            session as unknown as ClientSession,
          )
          .catch(() => undefined);
      }),
    ).rejects.toThrow('aborted by guard');
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(s.state.db).toEqual(before);
  });
  it('preserves original failure if abort acknowledgement itself fails', async () => {
    const s = await observed();
    const session = await s.runs.db.startSession();
    session.abortTransaction.mockRejectedValueOnce(
      new Error('abort reply lost'),
    );
    await expect(
      session.withTransaction(() =>
        s.repository.consumeWithinTransaction(
          { ...s.request, expectedEvidenceHash: 'b'.repeat(64) },
          session as unknown as ClientSession,
        ),
      ),
    ).rejects.toThrow('evidence changed');
    expect(s.state.db.archives[0].evidenceConsumption).toBeUndefined();
  });
  it('two consumers of the same evidence cannot both commit even with identical request IDs', async () => {
    const s = await observed();
    const results = await Promise.allSettled([s.consume(), s.consume()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(s.state.db.archives[0].evidenceConsumption!.id).toBe(s.request.id);
    expect(s.state.db.runs[0].revision).toBe(s.run.revision + 1);
  });
  it('rechecks a pipeline advance if consumption loses its snapshot before commit', async () => {
    const s = await observed();
    const before = clone(s.state.db);
    s.state.beforeArchiveSave = () => {
      s.state.beforeArchiveSave = undefined;
      s.state.db.controls[0].archiveReferencePlanRevision = 1;
      s.state.epoch++;
    };
    await expect(s.consume()).rejects.toThrow('stale');
    expect(s.state.db.archives).toEqual(before.archives);
    expect(s.state.db.runs).toEqual(before.runs);
    expect(s.state.db.controls[0].archiveMaterializationRevision).toBe(
      before.controls[0].archiveMaterializationRevision,
    );
  });
  it('a newly started metadata run invalidates the previously offered evidence', async () => {
    const s = await observed();
    await s.repository.start(historyUuid(854), s.fixture.archive.id);
    const before = clone(s.state.db);
    await expect(s.consume()).rejects.toThrow('stale');
    expect(s.state.db).toEqual(before);
    expect(s.state.db.archives[0].evidenceConsumption).toBeUndefined();
  });
  it('a reservation release winning against a consumption snapshot prevents its commit', async () => {
    const s = await observed();
    const before = clone(s.state.db);
    s.state.beforeArchiveSave = () => {
      s.state.beforeArchiveSave = undefined;
      delete s.state.db.controls[0].transferLock;
      s.state.db.controls[0].reservationEpoch!++;
      s.state.epoch++;
    };
    await expect(s.consume()).rejects.toThrow();
    expect(s.state.db.archives).toEqual(before.archives);
    expect(s.state.db.runs).toEqual(before.runs);
    expect(s.state.db.controls[0].reservationEpoch).toBe(2);
  });
  it('a persisted run-only consumption marker is never cleared or adopted', async () => {
    const s = await observed();
    Object.assign(s.state.db.runs[0], { consumption: {} });
    const before = clone(s.state.db);
    await expect(s.consume()).rejects.toThrow('consumed');
    await expect(s.repository.nextPage(id, 20)).rejects.toThrow('consumed');
    expect(s.state.db).toEqual(before);
  });
  it('lost commit reply leaves one receipt; repeating it is conflict, never permission to rerun business work', async () => {
    const s = await observed();
    s.state.loseReply = true;
    await expect(s.consume()).rejects.toThrow('commit reply lost');
    const recorded = clone(s.state.db);
    expect(recorded.archives[0].evidenceConsumption).toEqual(
      recorded.runs[0].consumption,
    );
    await expect(s.consume()).rejects.toThrow('consumed');
    await expect(
      s.consume({ ...s.request, id: historyUuid(852) }),
    ).rejects.toThrow('consumed');
    await expect(
      s.repository.start(historyUuid(853), s.request.archiveId),
    ).rejects.toThrow('consumed');
    await expect(s.repository.startS3(id)).rejects.toThrow('consumed');
    await expect(s.repository.s3Page(id, 5)).rejects.toThrow('consumed');
    await expect(s.repository.nextPage(id, 20)).rejects.toThrow('consumed');
    expect(s.state.db).toEqual(recorded);
  });
  it('exports only an internal persistence collaborator with optional no-default receipt fields and no TTL', () => {
    expect(
      Reflect.getMetadata('exports', OwnershipArchiveModule) as unknown[],
    ).toContain('OwnershipArchiveEvidenceConsumption');
    expect(
      Reflect.getMetadata('controllers', OwnershipArchiveModule),
    ).toBeUndefined();
    for (const field of [
      OwnershipArchiveSchema.path('evidenceConsumption'),
      OwnershipArchiveMetadataRevalidationSchema.path('consumption'),
      OwnershipArchiveMetadataRevalidationSchema.path('pipelineFence'),
    ]) {
      expect(field.options.default).toBeUndefined();
      expect(field.options.required).not.toBe(true);
    }
    expect(
      OwnershipArchiveMetadataRevalidationSchema.indexes().every(
        ([, options]) => options.expireAfterSeconds === undefined,
      ),
    ).toBe(true);
  });
});
