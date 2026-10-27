import { randomUUID } from 'node:crypto';
import { ArchiveEvidenceConsumption } from '../../../src/context/animal-transfer/domain/ownership-archive-evidence-consumption';
import {
  ArchiveEvidenceMongoFixture,
  EVIDENCE_TRANSACTION_OPTIONS,
} from './support/archive-evidence-mongo-fixture';
import { readArchiveEvidenceMongoSettings } from './support/archive-evidence-mongo-safety';
import { bounded, deferred } from './support/write-race-gate';

// Never discovered by npm test or the journal integration command.
describe('Single-use evidence and SYNTHETIC joint writes with an opt-in local replica set', () => {
  let db: ArchiveEvidenceMongoFixture;
  beforeEach(async () => {
    db = new ArchiveEvidenceMongoFixture();
    await db.open(readArchiveEvidenceMongoSettings(process.env));
  });
  afterEach(async () => {
    await db?.close();
  });

  it.each([true, false])(
    'commits matching markers/control and a joint write atomically (files=%s, synthetic S3)',
    async (withFiles) => {
      const s = await db.seedObserved(withFiles);
      const before = await db.snapshot();
      const commandsFrom = db.commands.length;
      let provisional: ArchiveEvidenceConsumption | undefined;
      const receipt = await db.joint(db.left, s.request, async (session) => {
        provisional = await db.left.archives
          .findOne({ id: s.request.archiveId })
          .session(session)
          .lean()
          .exec()
          .then((row) => row!.evidenceConsumption);
        expect(await db.snapshot()).toEqual(before); // Other client cannot see uncommitted writes.
      });
      const after = await db.snapshot();
      expect(provisional).toEqual(receipt);
      expect(after.archive!.evidenceConsumption).toEqual(receipt);
      expect(after.run!.consumption).toEqual(receipt);
      expect(after.control!.archiveMaterializationRevision).toBe(
        before.control!.archiveMaterializationRevision! + 1,
      );
      expect(after.joint.map((row) => row._id)).toEqual([s.request.id]);
      expect(after.control!.reservationEpoch).toBe(
        before.control!.reservationEpoch,
      );
      expect(after.control!.transferLock).toEqual(before.control!.transferLock);
      expect(after.archive!.state).toBe('READY');
      expect(after.run!.fileCount > 0).toBe(withFiles);
      const commands = db.commands
        .slice(commandsFrom)
        .filter((command) => command.side === 'left');
      const writes = commands.filter((command) =>
        ['update', 'insert'].includes(command.command),
      );
      expect(writes.map((command) => command.collection).sort()).toEqual(
        [
          '_synthetic_joint_writes',
          'animal_archive_metadata_revalidations',
          'animal_ownership_archives',
          'animal_ownership_controls',
        ].sort(),
      );
      expect(new Set(writes.map((command) => command.transaction)).size).toBe(
        1,
      );
      expect(writes.every((command) => command.transaction !== undefined)).toBe(
        true,
      );
      expect(commands.some((command) => command.snapshot)).toBe(true);
      expect(
        commands.some(
          (command) =>
            command.command === 'commitTransaction' && command.majority,
        ),
      ).toBe(true);
      expect(
        commands.some((command) => command.command === 'abortTransaction'),
      ).toBe(false);
      await expect(db.joint(db.left, s.request)).rejects.toThrow();
      await expect(
        db.left.repository.start(randomUUID(), s.request.archiveId),
      ).rejects.toThrow();
      expect(await db.snapshot()).toEqual(after);
    },
  );

  it('rolls back all guard writes and the joint insert when later caller work fails', async () => {
    const s = await db.seedObserved();
    const before = await db.snapshot();
    await expect(
      db.joint(db.left, s.request, async () => {
        await Promise.resolve();
        throw new Error('Synthetic business failure after guard');
      }),
    ).rejects.toThrow('Synthetic business failure');
    expect(await db.snapshot()).toEqual(before);
    await db.joint(db.left, s.request); // Explicit retry only after proven local rollback.
    expect((await db.snapshot()).joint).toHaveLength(1);
  });

  it('aborts partial control/header writes after a real zero-match final CAS even if the caller catches the error', async () => {
    const s = await db.seedObserved();
    const before = await db.snapshot();
    const session = await db.left.connection.startSession();
    try {
      session.startTransaction(EVIDENCE_TRANSACTION_OPTIONS);
      db.left.gate.failRunCas = true;
      await expect(
        db.left.repository.consumeWithinTransaction(s.request, session),
      ).rejects.toThrow('consumption changed');
      expect(session.inTransaction()).toBe(false);
      await expect(session.commitTransaction()).rejects.toThrow();
    } finally {
      await session.endSession();
    }
    expect(await db.snapshot()).toEqual(before);
  });

  it('lets exactly one of two independent clients with the same observed snapshot consume', async () => {
    const s = await db.seedObserved();
    const first = db.left.gate.arm('CONTROL');
    const second = db.right.gate.arm('CONTROL');
    const a = db.observe(db.joint(db.left, s.request));
    await first.entered();
    const b = db.observe(
      db.joint(db.right, { ...s.request, id: randomUUID() }),
    );
    await second.entered();
    first.release();
    const winner = await a;
    expect(winner).toHaveProperty('value');
    second.release();
    expect(await b).toHaveProperty('error');
    const state = await db.snapshot();
    expect(state.joint).toHaveLength(1);
    expect(state.archive!.evidenceConsumption).toEqual(state.run!.consumption);
    expect(state.archive!.evidenceConsumption!.id).toBe(s.request.id);
  });

  it('orders a competing control write after a consumer that already holds the control write lock', async () => {
    const s = await db.seedObserved();
    const gate = db.left.gate.arm('HEADER');
    const consumer = db.observe(db.joint(db.left, s.request));
    await gate.entered(); // The control increment is tentative and owns its Mongo lock.
    const sent = deferred();
    const client = db.right.connection.getClient();
    const listener = (event: { commandName: string }) => {
      if (event.commandName === 'update') sent.resolve();
    };
    client.on('commandStarted', listener);
    try {
      const contender = db.observe(
        db.right.controls
          .updateOne(
            { animalId: s.fixture.archive.animalId },
            { $inc: { archiveMaterializationRevision: 1 } },
            { writeConcern: { w: 'majority' }, maxTimeMS: 6000 },
          )
          .exec(),
      );
      await bounded(sent.promise, 'competing control command sent');
      gate.release();
      expect(await consumer).toHaveProperty('value');
      expect(await contender).toHaveProperty('value.modifiedCount', 1);
      const after = await db.snapshot();
      expect(after.joint).toHaveLength(1);
      expect(after.control!.archiveMaterializationRevision).toBe(
        after.archive!.evidenceConsumption!.nextControlRevision + 1,
      );
      await expect(db.joint(db.left, s.request)).rejects.toThrow();
    } finally {
      client.off('commandStarted', listener);
    }
  });

  it.each([
    'archivePreparationRevision',
    'archiveReferencePlanRevision',
    'archiveMaterializationRevision',
    'reservationEpoch',
  ] as const)(
    'rejects a consumer whose snapshot loses to a committed %s change',
    async (counter) => {
      const s = await db.seedObserved();
      const before = await db.snapshot();
      const gate = db.left.gate.arm('CONTROL');
      const consumer = db.observe(db.joint(db.left, s.request));
      await gate.entered();
      // Test-only drift injection through the second real client; not a new business mutator.
      const result = await db.right.controls
        .updateOne(
          { animalId: s.fixture.archive.animalId },
          { $inc: { [counter]: counter === 'reservationEpoch' ? 2 : 1 } },
          { writeConcern: { w: 'majority' } },
        )
        .exec();
      expect(result.modifiedCount).toBe(1);
      gate.release();
      expect(await consumer).toHaveProperty('error');
      const after = await db.snapshot();
      expect(after.archive).toEqual(before.archive);
      expect(after.run).toEqual(before.run);
      expect(after.joint).toEqual([]);
      expect(after.control!.transferLock).toEqual(before.control!.transferLock);
      expect(after.control![counter]).toBe(
        (before.control![counter] ?? 0) +
          (counter === 'reservationEpoch' ? 2 : 1),
      );
      // A fresh transaction also refuses stale evidence, independent of snapshot conflicts.
      await expect(db.joint(db.left, s.request)).rejects.toThrow();
    },
  );

  it('keeps the durable result after application observation is lost AFTER a successful commit; never replays', async () => {
    const s = await db.seedObserved();
    const operation = async () => {
      await db.joint(db.left, s.request);
      throw new Error('Application observation lost after actual commit');
    };
    await expect(operation()).rejects.toThrow('observation lost');
    const confirmed = await db.snapshot();
    expect(confirmed.joint).toHaveLength(1);
    expect(confirmed.archive!.evidenceConsumption!.id).toBe(s.request.id);
    await expect(db.joint(db.right, s.request)).rejects.toThrow();
    expect(await db.snapshot()).toEqual(confirmed);
  });

  it.each([
    'foreign client',
    'local read concern',
    'non-majority write concern',
  ])(
    'rejects %s using real driver sessions before guard queries or writes',
    async (problem) => {
      const s = await db.seedObserved();
      const before = await db.snapshot();
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
        const commandCount = db.commands.length;
        await expect(
          db.left.repository.consumeWithinTransaction(s.request, session),
        ).rejects.toThrow('caller active');
        expect(session.inTransaction()).toBe(true); // Guard must not abort an unvalidated session.
        expect(db.commands).toHaveLength(commandCount);
        await session.abortTransaction();
      } finally {
        await session.endSession();
      }
      expect(await db.snapshot()).toEqual(before);
    },
  );

  it('creates the actual unique identities and no TTL index in the isolated collections', async () => {
    const s = await db.seedObserved();
    for (const model of [db.left.archives, db.left.runs]) {
      const indexes = await model.collection.indexes();
      expect(indexes.some((index) => index.unique && index.key.id === 1)).toBe(
        true,
      );
      expect(
        indexes.some((index) => index.expireAfterSeconds !== undefined),
      ).toBe(false);
    }
    await expect(
      db.left.archives.create(s.fixture.archive),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(db.left.runs.create(s.run)).rejects.toMatchObject({
      code: 11000,
    });
    expect((await db.snapshot()).joint).toEqual([]);
  });
});
