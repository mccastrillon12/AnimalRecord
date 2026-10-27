import { randomUUID } from 'node:crypto';
import { ClientSession } from 'mongoose';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ArchiveEvidenceConsumptionRequest,
  ArchiveEvidenceSelection,
} from '../../../src/context/animal-transfer/domain/ownership-archive-evidence-consumption';
import { ArchiveProjectionRead } from '../../../src/context/animal-transfer/domain/ownership-archive-projection-read';
import { buildArchiveEntryReferencePlan } from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
import { historyKeyFromUrl } from '../fixtures/ownership-archive-history.fixture';
import {
  ArchiveEvidenceMongoFixture,
  EvidenceMongoSide,
  EVIDENCE_TRANSACTION_OPTIONS,
} from './support/archive-evidence-mongo-fixture';
import { readArchiveProjectionMongoSettings } from './support/archive-projection-mongo-safety';

const urlForKey = (key: string) => `https://test/${key}`;

/** Caller-owned real transactions, no callback replay or fabricated Mongo results. */
async function inSnapshot<T>(
  side: EvidenceMongoSide,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await side.connection.startSession();
  try {
    session.startTransaction(EVIDENCE_TRANSACTION_OPTIONS);
    const value = await work(session);
    await session.commitTransaction();
    return value;
  } catch (error) {
    if (session.inTransaction())
      await session.abortTransaction().catch(() => undefined);
    throw error;
  } finally {
    await session.endSession();
  }
}

function read(side: EvidenceMongoSide, selection: ArchiveEvidenceSelection) {
  return inSnapshot(side, (session) =>
    side.repository.readRecipientProjectionWithinTransaction(
      selection,
      session,
      urlForKey,
    ),
  );
}

function jointProjection(
  side: EvidenceMongoSide,
  request: ArchiveEvidenceConsumptionRequest,
  hooks: {
    beforeConsume?: (
      candidate: ArchiveProjectionRead,
      session: ClientSession,
    ) => Promise<void> | void;
    afterInsert?: () => Promise<void> | void;
  } = {},
) {
  return inSnapshot(side, async (session) => {
    const candidate =
      await side.repository.readRecipientProjectionWithinTransaction(
        request,
        session,
        urlForKey,
      );
    await hooks.beforeConsume?.(candidate, session);
    const receipt = await side.repository.consumeWithinTransaction(
      { ...candidate.evidence, id: request.id },
      session,
    );
    // Technical hash only, never a clinical payload or a real business receipt.
    await side.connection
      .db!.collection<{
        _id: string;
        projectionHash: string;
      }>('_synthetic_joint_writes')
      .insertOne(
        {
          _id: request.id,
          projectionHash: candidate.projection.projectionHash,
        },
        { session },
      );
    await hooks.afterInsert?.();
    return { candidate, receipt };
  });
}

describe('Projection read plus evidence consumption in an opt-in disposable Mongo replica set', () => {
  let db: ArchiveEvidenceMongoFixture;
  beforeEach(async () => {
    db = new ArchiveEvidenceMongoFixture();
    await db.open(readArchiveProjectionMongoSettings(process.env));
  });
  afterEach(async () => {
    await db?.close();
  });

  it.each(['files', 'empty', 'retained', 'return to A'])(
    'reads without writes then consumes/inserts atomically in ONE session (%s, synthetic S3)',
    async (kind) => {
      const s =
        kind === 'empty'
          ? await db.seedObserved(false)
          : await db.seedProjectionObserved(
              kind !== 'files',
              kind === 'return to A',
            );
      const before = await db.snapshot();
      const from = db.commands.length;
      const result = await jointProjection(db.left, s.request, {
        beforeConsume: async (candidate) => {
          expect(candidate.evidence).toEqual({
            runId: s.request.runId,
            archiveId: s.request.archiveId,
            expectedRunRevision: s.request.expectedRunRevision,
            expectedEvidenceHash: s.request.expectedEvidenceHash,
          });
          expect(candidate.projection.entries).toHaveLength(
            s.fixture.entries.length,
          );
          expect(candidate.projection.media).toHaveLength(
            s.fixture.files.length,
          );
          const phase = db.commands
            .slice(from)
            .filter((c) => c.side === 'left');
          expect(phase.length).toBeGreaterThan(0);
          expect(
            phase.every(
              (c) => c.command === 'find' || c.command === 'aggregate',
            ),
          ).toBe(true);
          expect(phase.every((c) => c.transaction !== undefined)).toBe(true);
          expect(await db.snapshot()).toEqual(before);
        },
      });
      const after = await db.snapshot();
      expect(after.archive!.evidenceConsumption).toEqual(result.receipt);
      expect(after.run!.consumption).toEqual(result.receipt);
      expect(after.control!.archiveMaterializationRevision).toBe(
        before.control!.archiveMaterializationRevision! + 1,
      );
      expect(after.control!.reservationEpoch).toBe(
        before.control!.reservationEpoch,
      );
      expect(after.control!.transferLock).toEqual(before.control!.transferLock);
      expect(after.archive!.state).toBe('READY');
      expect(after.joint).toHaveLength(1);
      expect(after.joint[0]).toMatchObject({
        _id: s.request.id,
        projectionHash: result.candidate.projection.projectionHash,
      });
      if (kind === 'retained' || kind === 'return to A') {
        const historical = result.candidate.projection.entries.find(
          (e) => e.kind === 'RETAINED_RECORD',
        )!;
        expect(historical.mode).toBe('RETAINED_READ_ONLY');
        expect(historical.payload.ownerId).toBe(
          s.fixture.entries.find((e) => e.kind === 'RETAINED_RECORD')!.payload
            .ownerId,
        );
      }
      const commands = db.commands.slice(from).filter((c) => c.side === 'left');
      expect(commands.every((c) => c.transaction !== undefined)).toBe(true);
      expect(new Set(commands.map((c) => c.transaction)).size).toBe(1);
      expect(commands.some((c) => c.snapshot)).toBe(true);
      expect(
        commands.some((c) => c.command === 'commitTransaction' && c.majority),
      ).toBe(true);
      expect(
        commands
          .filter((c) => c.command === 'update' || c.command === 'insert')
          .map((c) => c.collection)
          .sort(),
      ).toEqual(
        [
          '_synthetic_joint_writes',
          'animal_archive_metadata_revalidations',
          'animal_ownership_archives',
          'animal_ownership_controls',
        ].sort(),
      );
      await expect(read(db.right, s.request)).rejects.toThrow('consumed');
      expect(await db.snapshot()).toEqual(after);
    },
  );

  it('rolls back guard markers and the synthetic insert after later caller failure', async () => {
    const s = await db.seedProjectionObserved();
    const before = await db.snapshot();
    await expect(
      jointProjection(db.left, s.request, {
        afterInsert: () => {
          throw new Error('Synthetic caller failure');
        },
      }),
    ).rejects.toThrow('Synthetic caller failure');
    expect(await db.snapshot()).toEqual(before);
    await jointProjection(db.left, s.request);
    expect((await db.snapshot()).joint).toHaveLength(1);
  });

  it.each(['selection', 'codec'])(
    'read failure (%s) aborts prior caller writes even when its error is caught',
    async (problem) => {
      const s = await db.seedProjectionObserved();
      const before = await db.snapshot();
      const session = await db.left.connection.startSession();
      try {
        session.startTransaction(EVIDENCE_TRANSACTION_OPTIONS);
        await db.left.connection
          .db!.collection<{ _id: string }>('_synthetic_joint_writes')
          .insertOne({ _id: s.request.id }, { session });
        await expect(
          db.left.repository.readRecipientProjectionWithinTransaction(
            problem === 'selection'
              ? { ...s.request, expectedEvidenceHash: 'b'.repeat(64) }
              : s.request,
            session,
            problem === 'codec' ? () => 'http://invalid' : urlForKey,
          ),
        ).rejects.toThrow();
        expect(session.inTransaction()).toBe(false);
        await expect(session.commitTransaction()).rejects.toThrow();
      } finally {
        await session.endSession();
      }
      expect(await db.snapshot()).toEqual(before);
    },
  );

  it('a read-only snapshot can still return an old candidate after another client consumes; it grants no lock', async () => {
    const s = await db.seedProjectionObserved();
    const from = db.commands.length;
    await inSnapshot(db.left, async (session) => {
      // Mongo pins on the first query, not merely startSession/startTransaction.
      await db.left.runs
        .findOne({ id: s.request.runId })
        .session(session)
        .lean()
        .exec();
      await db.joint(db.right, { ...s.request, id: randomUUID() });
      const candidate =
        await db.left.repository.readRecipientProjectionWithinTransaction(
          s.request,
          session,
          urlForKey,
        );
      expect(candidate.evidence.expectedEvidenceHash).toBe(
        s.request.expectedEvidenceHash,
      );
      expect((await db.snapshot()).archive!.evidenceConsumption).toBeDefined();
    }); // Read-only commit is allowed; no stale business writes are made.
    expect(
      db.commands
        .slice(from)
        .filter((c) => c.side === 'left')
        .some((c) => c.command === 'update' || c.command === 'insert'),
    ).toBe(false);
    await expect(read(db.left, s.request)).rejects.toThrow('consumed');
    expect((await db.snapshot()).joint).toHaveLength(1);
  });

  it('a competing consumer after reading prevents the old snapshot from confirming its own consume and insert', async () => {
    const s = await db.seedProjectionObserved();
    const winningId = randomUUID();
    let rereadOldSnapshot = false;
    await expect(
      jointProjection(db.left, s.request, {
        beforeConsume: async (candidate, session) => {
          await db.joint(db.right, { ...s.request, id: winningId });
          const again =
            await db.left.repository.readRecipientProjectionWithinTransaction(
              s.request,
              session,
              urlForKey,
            );
          expect(again.projection.projectionHash).toBe(
            candidate.projection.projectionHash,
          );
          rereadOldSnapshot = true;
          await expect(read(db.right, s.request)).rejects.toThrow('consumed');
        },
      }),
    ).rejects.toThrow();
    expect(rereadOldSnapshot).toBe(true);
    const after = await db.snapshot();
    expect(after.archive!.evidenceConsumption!.id).toBe(winningId);
    expect(after.joint.map((row) => row._id)).toEqual([winningId]);
  });

  it('two projection readers on the same evidence permit exactly one subsequent joint commit', async () => {
    const s = await db.seedProjectionObserved();
    const first = db.left.gate.arm('CONTROL'),
      second = db.right.gate.arm('CONTROL');
    const a = db.observe(jointProjection(db.left, s.request));
    await first.entered();
    const b = db.observe(
      jointProjection(db.right, { ...s.request, id: randomUUID() }),
    );
    await second.entered();
    first.release();
    expect(await a).toHaveProperty('value');
    second.release();
    expect(await b).toHaveProperty('error');
    const after = await db.snapshot();
    expect(after.archive!.evidenceConsumption!.id).toBe(s.request.id);
    expect(after.joint).toHaveLength(1);
  });

  it.each([
    'reservationEpoch',
    'archivePreparationRevision',
    'archiveReferencePlanRevision',
    'archiveMaterializationRevision',
  ] as const)(
    'a committed %s change after reading invalidates the later consume, even if a reread stays old',
    async (field) => {
      const s = await db.seedProjectionObserved();
      const before = await db.snapshot();
      let rereadOldSnapshot = false;
      await expect(
        jointProjection(db.left, s.request, {
          beforeConsume: async (candidate, session) => {
            const changed = await db.right.controls
              .updateOne(
                { animalId: s.fixture.archive.animalId },
                { $inc: { [field]: field === 'reservationEpoch' ? 2 : 1 } },
                { writeConcern: { w: 'majority' } },
              )
              .exec();
            expect(changed.modifiedCount).toBe(1); // Test-only drift, not a new business mutator.
            const again =
              await db.left.repository.readRecipientProjectionWithinTransaction(
                s.request,
                session,
                urlForKey,
              );
            expect(again.projection.projectionHash).toBe(
              candidate.projection.projectionHash,
            );
            rereadOldSnapshot = true;
          },
        }),
      ).rejects.toThrow();
      expect(rereadOldSnapshot).toBe(true);
      const after = await db.snapshot();
      expect(after.archive!.evidenceConsumption).toBeUndefined();
      expect(after.run!.consumption).toBeUndefined();
      expect(after.joint).toEqual([]);
      expect(after.control![field]).toBe(
        (before.control![field] ?? 0) + (field === 'reservationEpoch' ? 2 : 1),
      );
      await expect(read(db.left, s.request)).rejects.toThrow();
    },
  );

  it('rejects an internally valid changed payload/plan that no longer matches the observed digests', async () => {
    const s = await db.seedProjectionObserved();
    const entry = structuredClone(
      s.fixture.entries.find((e) => e.kind === 'ANIMAL')!,
    );
    entry.payload.name = 'Changed synthetic name';
    entry.contentHash = archiveHash({
      kind: entry.kind,
      payload: entry.payload,
      fileBindings: entry.fileBindings,
    });
    entry.referencePlan = buildArchiveEntryReferencePlan(
      s.fixture.archive,
      entry,
      s.fixture.files.filter((file) =>
        entry.fileBindings.some((b) => b.fileId === file.id),
      ),
      historyKeyFromUrl,
    );
    await db.right.entries
      .updateOne(
        { id: entry.id },
        {
          $set: {
            payload: entry.payload,
            contentHash: entry.contentHash,
            referencePlan: entry.referencePlan,
          },
        },
        { writeConcern: { w: 'majority' } },
      )
      .exec();
    const before = await db.snapshot();
    await expect(read(db.left, s.request)).rejects.toThrow(
      'projection differs',
    );
    expect(await db.snapshot()).toEqual(before);
  });

  it.each([
    'foreign client',
    'local read concern',
    'non-majority write concern',
  ])(
    'rejects %s before reader queries without aborting the unvalidated session',
    async (problem) => {
      const s = await db.seedObserved();
      const session = await (
        problem === 'foreign client' ? db.right : db.left
      ).connection.startSession();
      try {
        session.startTransaction({
          ...EVIDENCE_TRANSACTION_OPTIONS,
          readConcern: {
            level: problem === 'local read concern' ? 'local' : 'snapshot',
          },
          writeConcern: {
            w: problem === 'non-majority write concern' ? 1 : 'majority',
          },
        });
        const from = db.commands.length;
        await expect(
          db.left.repository.readRecipientProjectionWithinTransaction(
            s.request,
            session,
            urlForKey,
          ),
        ).rejects.toThrow('caller active');
        expect(session.inTransaction()).toBe(true);
        expect(db.commands).toHaveLength(from);
        await session.abortTransaction();
      } finally {
        await session.endSession();
      }
    },
  );

  it('reads a complete set of more than 100 entries/files/registrations before its joint commit', async () => {
    const s = await db.seedObserved(true, 100);
    const result = await jointProjection(db.left, s.request);
    expect(result.candidate.projection.entries).toHaveLength(101);
    expect(result.candidate.projection.media).toHaveLength(101);
    expect((await db.snapshot()).joint).toHaveLength(1);
  });

  it('preserves the durable synthetic result after an application error AFTER acknowledged commit', async () => {
    const s = await db.seedProjectionObserved();
    const operation = async () => {
      await jointProjection(db.left, s.request);
      throw new Error('Application observation lost after commit');
    };
    await expect(operation()).rejects.toThrow('observation lost');
    const confirmed = await db.snapshot();
    expect(confirmed.joint).toHaveLength(1);
    await expect(jointProjection(db.right, s.request)).rejects.toThrow(
      'consumed',
    );
    expect(await db.snapshot()).toEqual(confirmed);
  });
});
