import { AcceptanceSelection } from '../../../src/context/animal-transfer/domain/transfer-acceptance-preparation';
import { TransferRequestItem } from '../../../src/context/animal-transfer/domain/transfer-request';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  assertArchiveReservationControl,
  archiveDefinitionOnly,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import { transferRecordId } from '../../../src/context/animal-transfer/domain/transfer-record-id';
import { TransferAcceptanceMongoFixture } from './support/transfer-acceptance-mongo-fixture';
import { readAcceptanceMongoSettings } from './support/transfer-acceptance-mongo-safety';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';
import { otpActor, otpOther } from '../fixtures/transfer-otp.fixture';
import {
  archiveAnimal,
  archiveMedicalDocument,
} from '../fixtures/ownership-archive.fixture';
import { AcceptancePoint } from './support/transfer-acceptance-race-gate';
import { ItemCaptureInput } from '../../../src/context/animal-transfer/domain/transfer-item-capture';

describe('Opt-in Mongo acceptance start and capture continuity; no remote storage', () => {
  let f: TransferAcceptanceMongoFixture,
    input: AcceptanceSelection,
    animalIds: string[];
  beforeEach(async () => {
    f = new TransferAcceptanceMongoFixture();
    await f.open(readAcceptanceMongoSettings(process.env));
    const seed = await f.seedAcceptance();
    ({ animalIds, ...input } = seed);
  });
  afterEach(async () => {
    try {
      await f.close();
    } finally {
      jest.restoreAllMocks();
    }
  });
  async function reject() {
    return f.right.requests.decide(otpOther, input.transferId, id(3), {
      expectedVersion: 1,
      acceptedAnimalIds: [],
    });
  }
  async function unchangedBefore(
    work: () => Promise<unknown>,
    message?: string,
  ) {
    const before = await f.snapshot();
    if (message) await expect(work()).rejects.toThrow(message);
    else await expect(work()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  }
  async function beginItemCapture() {
    const receipt = await f.left.start.start(input),
      selected = receipt.binding.selected[0];
    const selector: ItemCaptureInput = {
      actorId: input.actorId,
      transferId: input.transferId,
      itemId: selected.itemId,
      decisionOperationId: input.operationId,
      expectedRequestVersion: receipt.requestVersion,
      expectedCaptureRevision: 0,
    };
    return { selected, selector };
  }
  function businessWrites(from: number) {
    return f.commands
      .slice(from)
      .filter((c) =>
        ['insert', 'update', 'delete', 'findAndModify'].includes(c.command),
      );
  }
  it('observes a candidate without acquiring a reservation or recording any decision', async () => {
    const before = await f.snapshot(),
      candidate = await f.left.prepare.prepare(input);
    expect(candidate).toMatchObject({
      decision: 'NOT_RECORDED',
      reservation: 'NOT_ACQUIRED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(candidate.selected).toHaveLength(2);
    expect(candidate.rejectedItemIds).toHaveLength(1);
    expect(await f.snapshot()).toEqual(before);
  });
  it('records partial selection, all reservations, headers and audit in one acknowledged snapshot/majority transaction', async () => {
    const from = f.commands.length,
      receipt = await f.left.start.start(input),
      r = f.right.rows;
    expect(receipt).toMatchObject({
      replayed: false,
      requestVersion: 2,
      reservation: 'RECORDED_AT_START',
      stableCut: 'NOT_ASSESSED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(
      (await r.requests.findById(input.transferId).lean().exec())?.status,
    ).toBe('PROCESSING');
    expect(
      (await r.items.find().sort({ animalId: 1 }).lean().exec()).map(
        (i) => i.status,
      ),
    ).toEqual(['PROCESSING', 'PROCESSING', 'REJECTED']);
    expect(
      (await r.claims.find().sort({ _id: 1 }).lean().exec()).map((c) => c._id),
    ).toEqual(input.acceptedAnimalIds);
    for (const selected of receipt.binding.selected) {
      const archive = await r.archives
          .findOne({ id: selected.archiveId })
          .lean()
          .exec(),
        control = await r.controls
          .findOne({ animalId: selected.animalId })
          .lean()
          .exec();
      expect(archive).toMatchObject({
        state: 'COLLECTING',
        capture: { phase: 'ANIMAL', revision: 0, entryCount: 0 },
      });
      assertArchiveReservationControl(archive!, control);
      expect(control?.reservationEpoch).toBe(selected.reservationEpoch);
    }
    expect(await r.notices.countDocuments()).toBe(0);
    expect(await r.outbox.countDocuments()).toBe(0);
    expect(
      await r.events.countDocuments({ type: 'REQUEST_ACCEPTANCE_STARTED' }),
    ).toBe(1);
    expect(
      (await r.animals.find().lean().exec()).every(
        (a) => a.ownerId === otpActor,
      ),
    ).toBe(true);
    expect(await r.periods.countDocuments({ status: 'CLOSED' })).toBe(0);
    const commands = f.commands.slice(from),
      writes = commands.filter((c) =>
        ['insert', 'update', 'findAndModify', 'delete'].includes(c.command),
      );
    const transaction = writes.find(
      (c) => c.collection === 'animal_transfers',
    )?.transaction;
    expect(transaction).toBeDefined();
    expect(writes.every((c) => c.transaction === transaction)).toBe(true);
    expect(
      commands.some((c) => c.transaction === transaction && c.snapshot),
    ).toBe(true);
    expect(
      commands.some(
        (c) =>
          c.transaction === transaction &&
          c.command === 'commitTransaction' &&
          c.majority,
      ),
    ).toBe(true);
    for (const name of [
      'users',
      'animals',
      'animal_ownership_controls',
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_archives',
      'animal_transfer_events',
    ])
      expect(writes.some((c) => c.collection === name)).toBe(true);
  });
  it('accepts the complete set without releasing a selected claim', async () => {
    const receipt = await f.left.start.start({
      ...input,
      acceptedAnimalIds: animalIds,
    });
    expect(receipt.binding.rejectedItemIds).toEqual([]);
    expect(await f.right.rows.claims.countDocuments()).toBe(3);
    expect(await f.right.rows.archives.countDocuments()).toBe(3);
  });
  it('reads every stored request page beyond 100 items without inventing an animal limit', async () => {
    // Extend the whole live set so items, claims, animals, controls and periods
    // all cross the first wire batch. No business maximum is introduced.
    const r = f.left.rows,
      extra = Array.from({ length: 98 }, (_, n) => id(300 + n));
    await r.items.db
      .db!.collection<TransferRequestItem>('animal_transfer_items')
      .insertMany(
        extra.map((animalId) => ({
          _id: transferRecordId('item', input.transferId, animalId),
          transferId: input.transferId,
          animalId,
          animalName: 'Other',
          animalCode: 'AR-other',
          expectedOwnerId: otpActor,
          expectedOwnershipVersion: 1,
          status: 'PENDING' as const,
        })),
        { ordered: true, writeConcern: { w: 'majority' } },
      );
    await r.claims.create(
      extra.map((animalId) => ({
        _id: animalId,
        transferId: input.transferId,
      })),
      { w: 'majority' },
    );
    await r.requests
      .updateOne({ _id: input.transferId }, { $set: { animalCount: 101 } })
      .exec();
    await r.animals.collection.insertMany(
      extra.map((animalId, n) => ({
        ...structuredClone(archiveAnimal),
        id: animalId,
        ownerId: otpActor,
        code: `AR-extra-${n}`,
        isActive: true,
      })),
    );
    await r.controls.collection.insertMany(
      extra.map((animalId) => ({
        animalId,
        ownerId: otpActor,
        ownershipVersion: 1,
        activeWrites: [],
      })),
    );
    await r.periods.collection.insertMany(
      extra.map((animalId, n) => ({
        id: id(2000 + n),
        animalId,
        ownerId: otpActor,
        ownershipVersion: 1,
        status: 'ACTIVE',
        startedAtKnown: true,
        startedAt: new Date().toISOString(),
        startProvenance: 'CREATED',
      })),
    );
    const receipt = await f.left.start.start({
      ...input,
      acceptedAnimalIds: [...animalIds, ...extra],
    });
    expect(receipt.binding.selected).toHaveLength(101);
    expect(receipt.binding.rejectedItemIds).toEqual([]);
    expect(await f.right.rows.archives.countDocuments()).toBe(101);
    expect(
      await f.right.rows.items.countDocuments({ status: 'REJECTED' }),
    ).toBe(0);
  });
  it.each([
    'ACQUIRE',
    'FENCE',
    'DECISION',
    'ITEM',
    'CLAIM',
    'HEADER',
    'REJECT_ITEMS',
    'RELEASE_CLAIMS',
    'EVENT',
  ] as const)(
    'rolls back the complete request/reservations/headers when %s fails before its real write',
    async (point: AcceptancePoint) => {
      f.left.gate.fail = point;
      await unchangedBefore(
        () => f.left.start.start(input),
        'could not be acknowledged',
      );
    },
  );
  it.each([
    'PENDING_UPLOAD',
    'ANALYZING',
    'REVIEW_PENDING',
    'UNKNOWN',
    'MISSING',
  ] as const)(
    'denies pending medical state %s on the second selected animal without partial rejection',
    async (status) => {
      await f.left.rows.medical.collection.insertOne({
        id: id(500),
        animalIds: [animalIds[1]],
        ...(status === 'MISSING' ? {} : { status }),
      });
      await unchangedBefore(
        () => f.left.start.start(input),
        'finish or discard',
      );
    },
  );
  it('denies a legacy accepted multi-animal record during full dossier preflight without normalizing it', async () => {
    await f.left.rows.medical.collection.insertOne({
      ...archiveMedicalDocument(id(500)),
      ownerId: otpActor,
      animalIds: [animalIds[1], animalIds[2]],
    });
    await unchangedBefore(
      () => f.left.start.start(input),
      'independent document',
    );
  });
  it('reads the diary after its first hundred rows and denies an unsealed attachment without reserving any animal', async () => {
    const prefix = `users/${otpActor}/animals/${animalIds[1]}/diary/`;
    await f.left.rows.diary.collection.insertMany(
      Array.from({ length: 101 }, (_, n) => ({
        id: id(500 + n),
        animalId: animalIds[1],
        title: 'Control',
        content: 'x'.repeat(200000), // Force a wire-size-short batch before 100 records.
        date: '2026-01-01',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        attachments:
          n < 100
            ? []
            : [
                {
                  id: id(900),
                  url: `https://acceptance.invalid/${prefix}legacy.jpeg`,
                  fileName: 'legacy',
                  fileType: 'image',
                  mimeType: 'image/jpeg',
                  size: 12,
                  createdAt: '2026-01-01',
                },
              ],
      })),
    );
    await unchangedBefore(() => f.left.start.start(input), 'unconfirmed');
    expect(
      f.commands.filter((c) => c.command === 'getMore' && c.transaction),
    ).toEqual([]);
  });
  it('uses only synthetic sealed receipts for photo preflight and leaves bytes/remote closure unassessed', async () => {
    const key = `users/${otpActor}/animals/${animalIds[0]}/profile_photo.jpeg`;
    await f.left.rows.animals
      .updateOne(
        { id: animalIds[0] },
        { $set: { profilePictureUrl: `https://acceptance.invalid/${key}` } },
      )
      .exec();
    await f.left.rows.media.collection.insertOne({
      id: id(600),
      ownerId: otpActor,
      animalId: animalIds[0],
      finalKey: key,
      stagingKey: `synthetic/${id(600)}`,
      mimeType: 'image/jpeg',
      size: 12,
      createdAt: new Date().toISOString(),
      pinned: { etag: 'synthetic', size: 12, sha256: 'a'.repeat(64) },
      sealed: { etag: 'synthetic', size: 12 },
    });
    expect((await f.left.start.start(input)).stableCut).toBe('NOT_ASSESSED');
  });
  it.each([
    'initial-period',
    'later-period',
    'inactive',
    'claim',
    'existing-lock',
    'epoch-exhausted',
    'upload-window',
  ] as const)(
    'preserves the %s guard without manufacturing or adopting an archive',
    async (kind) => {
      const r = f.left.rows;
      if (kind === 'initial-period')
        await r.periods.deleteOne({ animalId: animalIds[0] }).exec();
      if (kind === 'later-period') {
        await r.periods
          .updateOne(
            { animalId: animalIds[0] },
            { $set: { ownershipVersion: 2 } },
          )
          .exec();
        await r.controls
          .updateOne(
            { animalId: animalIds[0] },
            { $set: { ownershipVersion: 2 } },
          )
          .exec();
        await r.items
          .updateOne(
            { animalId: animalIds[0] },
            { $set: { expectedOwnershipVersion: 2 } },
          )
          .exec();
      }
      if (kind === 'inactive')
        await r.animals
          .updateOne({ id: animalIds[0] }, { $set: { isActive: false } })
          .exec();
      if (kind === 'claim')
        await r.claims.deleteOne({ _id: animalIds[2] }).exec();
      if (kind === 'existing-lock')
        await r.controls
          .updateOne(
            { animalId: animalIds[0] },
            {
              $set: {
                reservationEpoch: 1,
                transferLock: {
                  transferId: input.transferId,
                  lockedAt: new Date().toISOString(),
                },
              },
            },
          )
          .exec();
      if (kind === 'epoch-exhausted')
        await r.controls
          .updateOne(
            { animalId: animalIds[0] },
            { $set: { reservationEpoch: Number.MAX_SAFE_INTEGER } },
          )
          .exec();
      if (kind === 'upload-window')
        await r.controls
          .updateOne(
            { animalId: animalIds[0] },
            {
              $set: {
                uploadsValidUntil: new Date(Date.now() + 60000).toISOString(),
              },
            },
          )
          .exec();
      await unchangedBefore(() => f.left.start.start(input));
    },
  );
  it('retains its own start binding when the application reply is lost after a recognized Mongo commit', async () => {
    f.loseNextCommitReply(f.left);
    await expect(f.left.start.start(input)).rejects.toMatchObject({
      status: 503,
    });
    const before = await f.snapshot(),
      from = f.commands.length;
    expect((await f.right.start.start(input)).replayed).toBe(true);
    expect(await f.snapshot()).toEqual(before);
    expect(
      f.commands
        .slice(from)
        .some((c) =>
          ['insert', 'update', 'delete', 'findAndModify'].includes(c.command),
        ),
    ).toBe(false);
  });
  it('does not change or re-send an already recorded selection under the same or another operation', async () => {
    await f.left.start.start(input);
    await unchangedBefore(
      () =>
        f.right.start.start({ ...input, acceptedAnimalIds: [animalIds[0]] }),
      'receipt',
    );
    await unchangedBefore(
      () => f.right.start.start({ ...input, operationId: id(3) }),
      'receipt',
    );
  });
  it('preserves the committed decision if closing the real session succeeds but the application then observes a close error', async () => {
    const startSession = f.left.connection.startSession.bind(f.left.connection);
    jest
      .spyOn(f.left.connection, 'startSession')
      .mockImplementationOnce(async (...args) => {
        const session = await startSession(...args),
          end = session.endSession.bind(session);
        jest
          .spyOn(session, 'endSession')
          .mockImplementationOnce(async (...endArgs) => {
            await end(...endArgs);
            throw new Error(
              'Injected application observation error after session close',
            );
          });
        return session;
      });
    await expect(f.left.start.start(input)).rejects.toMatchObject({
      status: 503,
    });
    const before = await f.snapshot();
    expect((await f.right.start.start(input)).replayed).toBe(true);
    expect(await f.snapshot()).toEqual(before);
  });
  it('lets only one of two different recipient decisions win the request CAS', async () => {
    const left = f.left.gate.arm('SNAPSHOT'),
      right = f.right.gate.arm('SNAPSHOT');
    const pending = [
      f.observe(f.left.start.start(input)),
      f.observe(
        f.right.start.start({
          ...input,
          operationId: id(3),
          acceptedAnimalIds: [animalIds[1]],
        }),
      ),
    ];
    await Promise.all([left.entered(), right.entered()]);
    left.release();
    right.release();
    const outcomes = await Promise.all(pending);
    expect(outcomes.filter((r) => 'value' in r)).toHaveLength(1);
    expect(
      await f.right.rows.events.countDocuments({
        type: 'REQUEST_ACCEPTANCE_STARTED',
      }),
    ).toBe(1);
    const row = await f.right.rows.requests
      .findById(input.transferId)
      .lean()
      .exec();
    expect(await f.right.rows.archives.countDocuments()).toBe(
      row!.acceptanceStart!.selected.length,
    );
  });
  it('reconciles two simultaneous calls with the same intent as one start and one read-only receipt', async () => {
    const left = f.left.gate.arm('SNAPSHOT'),
      right = f.right.gate.arm('SNAPSHOT');
    const pending = [
      f.observe(f.left.start.start(input)),
      f.observe(f.right.start.start(input)),
    ];
    await Promise.all([left.entered(), right.entered()]);
    left.release();
    right.release();
    const results = await Promise.all(pending);
    expect(results.every((r) => 'value' in r)).toBe(true);
    const outcomes = results.flatMap((r) => ('value' in r ? [r.value] : []));
    expect(outcomes.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(outcomes[0].binding).toEqual(outcomes[1].binding);
    expect(
      await f.right.rows.events.countDocuments({
        type: 'REQUEST_ACCEPTANCE_STARTED',
      }),
    ).toBe(1);
  });
  it('loses to a rejection committed after its request snapshot and leaves no acceptance reservation/header', async () => {
    const pause = f.left.gate.arm('SNAPSHOT'),
      start = f.observe(f.left.start.start(input));
    await pause.entered();
    expect((await reject()).status).toBe('REJECTED');
    pause.release();
    expect(await start).toHaveProperty('error');
    expect(await f.right.rows.archives.countDocuments()).toBe(0);
    expect(
      await f.right.rows.controls.countDocuments({
        transferLock: { $exists: true },
      }),
    ).toBe(0);
    expect(await f.right.rows.claims.countDocuments()).toBe(0);
  });
  it('does not allow the existing public reject-all service to undo a committed start', async () => {
    await f.left.start.start(input);
    await unchangedBefore(reject, 'changed');
  });
  it('keeps an old read-only candidate unauthorized after another client reserves the animal', async () => {
    const pause = f.left.gate.arm('SNAPSHOT'),
      read = f.observe(f.left.prepare.prepare(input));
    await pause.entered();
    expect(
      await f.right.ownership.acquireTransferLock({
        animalId: animalIds[0],
        ownerId: otpActor,
        expectedOwnershipVersion: 1,
        transferId: id(80),
        lockedAt: new Date().toISOString(),
      }),
    ).toBe(true);
    pause.release();
    const result = await read;
    expect(result).toHaveProperty('value');
    if ('value' in result)
      expect(result.value).toMatchObject({
        reservation: 'NOT_ACQUIRED',
        businessCommit: 'NOT_AUTHORIZED',
      });
    await unchangedBefore(() => f.left.start.start(input), 'busy');
  });
  it('retries its own Mongo transaction after reservation ABA, binding the newly acquired epoch rather than the stale snapshot epoch', async () => {
    const pause = f.left.gate.arm('SNAPSHOT'),
      start = f.observe(f.left.start.start(input));
    await pause.entered();
    expect(
      await f.right.ownership.acquireTransferLock({
        animalId: animalIds[0],
        ownerId: otpActor,
        expectedOwnershipVersion: 1,
        transferId: id(80),
        lockedAt: new Date().toISOString(),
      }),
    ).toBe(true);
    expect(
      await f.right.ownership.releaseTransferLock(animalIds[0], id(80), 1),
    ).toBe(true); // Only its acknowledged fresh test reservation; no archive/callback.
    pause.release();
    const result = await start;
    expect(result).toHaveProperty('value');
    if ('value' in result)
      expect(result.value.binding.selected[0].reservationEpoch).toBe(3);
  });
  it('cannot commit its old snapshot over a real coordinated writer that still holds a callback claim', async () => {
    const snapshot = f.left.gate.arm('SNAPSHOT'),
      start = f.observe(f.left.start.start(input));
    await snapshot.entered();
    const profile = f.right.gate.arm('PROFILE');
    const writer = f.observe(
      f.right.writer.run(
        [animalIds[0]],
        otpActor,
        () =>
          f.right.rows.animals
            .updateOne({ id: animalIds[0] }, { $set: { name: 'Changed' } })
            .exec(),
        { kind: 'ANIMAL_UPDATE' },
      ),
    );
    await profile.entered();
    snapshot.release();
    expect(await start).toHaveProperty('error');
    profile.release();
    expect(await writer).toHaveProperty('value');
    expect(await f.right.rows.archives.countDocuments()).toBe(0);
  });
  it('rechecks pending medical work when a coordinated writer completed locally after the acceptance snapshot', async () => {
    const pause = f.left.gate.arm('SNAPSHOT'),
      start = f.observe(f.left.start.start(input));
    await pause.entered();
    await f.right.writer.run(
      [animalIds[0]],
      otpActor,
      () =>
        f.right.rows.medical.collection.insertOne({
          id: id(500),
          animalIds: [animalIds[0]],
          status: 'ANALYZING',
        }),
      { kind: 'MEDICAL_ANALYZE' },
    );
    pause.release();
    expect(await start).toHaveProperty('error');
    expect(await f.right.rows.archives.countDocuments()).toBe(0);
    expect(
      (await f.right.rows.requests.findById(input.transferId).lean().exec())
        ?.status,
    ).toBe('PENDING');
  });
  it('resumes real Mongo capture through the persisted header without reacquiring and preserves the name history snapshot', async () => {
    const receipt = await f.left.start.start(input),
      selected = receipt.binding.selected[0];
    const archive = (await f.right.rows.archives
      .findOne({ id: selected.archiveId })
      .lean()
      .exec())!;
    expect(
      (await f.right.capture.start(archiveDefinitionOnly(archive))).id,
    ).toBe(archive.id);
    for (let n = 0; n < 4; n++) await f.right.capture.captureBatch(archive.id);
    const captured = (await f.right.rows.entries
      .findOne({ archiveId: archive.id, kind: 'ANIMAL' })
      .lean()
      .exec())!;
    expect(captured.payload.nameHistory).toEqual(archiveAnimal.nameHistory);
    expect(
      (
        await f.right.rows.controls
          .findOne({ animalId: selected.animalId })
          .lean()
          .exec()
      )?.reservationEpoch,
    ).toBe(selected.reservationEpoch);
    expect(
      (await f.right.rows.archives.findOne({ id: archive.id }).lean().exec())
        ?.state,
    ).toBe('COPYING');
    expect(
      (
        await f.right.rows.animals
          .findOne({ id: selected.animalId })
          .lean()
          .exec()
      )?.ownerId,
    ).toBe(otpActor);
  });
  it('returns only historical receipt information after synthetic administrative epoch invalidation and denies capture under the stale header', async () => {
    const receipt = await f.left.start.start(input),
      selected = receipt.binding.selected[0];
    // Adversarial fixture mutation, NOT a supported recovery/release procedure.
    await f.right.rows.controls.collection.updateOne(
      { animalId: selected.animalId },
      { $inc: { reservationEpoch: 1 } },
    );
    const replay = await f.right.start.start(input);
    expect(replay.binding).toEqual(receipt.binding);
    expect(replay.businessCommit).toBe('NOT_AUTHORIZED');
    await expect(
      f.right.capture.captureBatch(selected.archiveId),
    ).rejects.toThrow('original matching');
  });
  it.each(['missing-collection', 'missing-unique-index', 'ttl-index'] as const)(
    'fails %s readiness without creating/repairing application storage',
    async (kind) => {
      if (kind === 'missing-collection')
        await f.left.rows.diary.collection.drop();
      if (kind === 'missing-unique-index')
        await f.left.rows.archives.collection.dropIndex('id_1');
      if (kind === 'ttl-index')
        await f.left.rows.requests.collection.createIndex(
          { createdAt: 1 },
          { expireAfterSeconds: 60 },
        );
      const before = await f.snapshot(),
        from = f.commands.length;
      await expect(f.left.start.start(input)).rejects.toMatchObject({
        status: 503,
      });
      expect(await f.snapshot()).toEqual(before);
      expect(
        f.commands
          .slice(from)
          .some((c) =>
            [
              'create',
              'createIndexes',
              'insert',
              'update',
              'delete',
              'findAndModify',
            ].includes(c.command),
          ),
      ).toBe(false);
    },
  );
  it('admits each bound item page in a separate committed transaction and seals capture without copies or ownership changes', async () => {
    const { selected, selector } = await beginItemCapture(),
      before = await f.snapshot(),
      from = f.commands.length;
    const callback = jest.spyOn(f.left.batch, 'captureBatch');
    for (const [revision, phase] of [
      [0, 'DIARY'],
      [1, 'MEDICAL'],
      [2, 'COMPLETE'],
      [3, 'COMPLETE'],
    ] as const) {
      expect(
        await f.left.itemCapture.advance({
          ...selector,
          expectedCaptureRevision: revision,
        }),
      ).toMatchObject({
        phase,
        captureRevision: Math.min(revision + 1, 3),
        entryCount: 1,
        stage: revision === 3 ? 'CAPTURE_SEALED' : 'COLLECTING',
        callback: 'RETURNED',
        reservation: 'OBSERVED_ONLY',
        stableCut: 'NOT_ASSESSED',
        businessCommit: 'NOT_AUTHORIZED',
      });
    }
    expect(callback).toHaveBeenCalledTimes(4);
    expect(
      callback.mock.calls.map(([, expected]) => expected?.revision),
    ).toEqual([0, 1, 2, 3]);
    expect(callback.mock.calls.every(([id]) => id === selected.archiveId)).toBe(
      true,
    );
    const writes = businessWrites(from),
      admission = writes.find((c) => c.collection === 'animal_transfers')!,
      commands = f.commands.slice(from),
      firstAdmission = writes.filter(
        (c) => c.transaction === admission.transaction,
      );
    expect(admission.transaction).toBeDefined();
    expect(firstAdmission.map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
    ]);
    expect(
      commands.some(
        (c) => c.transaction === admission.transaction && c.snapshot,
      ),
    ).toBe(true);
    const commit = commands.findIndex(
        (c) =>
          c.transaction === admission.transaction &&
          c.command === 'commitTransaction' &&
          c.majority,
      ),
      firstEntry = commands.findIndex(
        (c) =>
          c.command === 'insert' &&
          c.collection === 'animal_ownership_archive_entries',
      );
    expect(commit).toBeGreaterThanOrEqual(0);
    expect(firstEntry).toBeGreaterThan(commit);
    expect(commands[firstEntry].transaction).not.toBe(admission.transaction);
    const r = f.right.rows,
      archive = (await r.archives
        .findOne({ id: selected.archiveId })
        .lean()
        .exec())!,
      control = await r.controls
        .findOne({ animalId: selected.animalId })
        .lean()
        .exec();
    assertArchiveReservationControl(archive, control);
    expect(archive.state).toBe('COPYING');
    expect(control?.reservationEpoch).toBe(selected.reservationEpoch);
    expect(await r.files.countDocuments()).toBe(0);
    expect(await r.entries.countDocuments({ archiveId: archive.id })).toBe(1);
    const after = await f.snapshot();
    for (const role of ['animals', 'periods', 'events', 'notices', 'outbox'])
      expect(after[role]).toEqual(before[role]);
    expect(
      (await r.requests.findById(input.transferId).lean().exec())?.status,
    ).toBe('PROCESSING');
    expect(
      await f.right.itemCapture.advance({
        ...selector,
        expectedCaptureRevision: 3,
      }),
    ).toMatchObject({ stage: 'CAPTURE_SEALED', callback: 'NOT_INVOKED' });
  });
  it('keeps observe and an old expected revision read-only after an acknowledged item page', async () => {
    const { selector } = await beginItemCapture();
    await f.left.itemCapture.advance(selector);
    const before = await f.snapshot(),
      from = f.commands.length,
      callback = jest.spyOn(f.right.batch, 'captureBatch');
    const progress = await f.right.itemCapture.observe(selector);
    expect(progress).toMatchObject({ captureRevision: 1, phase: 'DIARY' });
    expect(JSON.stringify(progress)).not.toMatch(
      /archiveId|definitionHash|nameHistory|Brownie|token|proof/,
    );
    expect(await f.right.itemCapture.advance(selector)).toMatchObject({
      ...progress,
      callback: 'NOT_INVOKED',
    });
    expect(callback).not.toHaveBeenCalled();
    expect(businessWrites(from)).toEqual([]);
    expect(await f.snapshot()).toEqual(before);
  });
  it('advances only the selected item while preserving the other reserved item and the rejected item', async () => {
    const { selector } = await beginItemCapture(),
      before = await f.snapshot();
    await f.left.itemCapture.advance(selector);
    const after = await f.snapshot();
    for (const role of ['items', 'claims', 'controls', 'archives'] as const) {
      const untouched = (rows: unknown) =>
        (rows as Array<Record<string, unknown>>).filter((row) =>
          role === 'items'
            ? row.animalId !== animalIds[0]
            : role === 'claims'
              ? row._id !== animalIds[0]
              : row.animalId !== animalIds[0],
        );
      expect(untouched(after[role])).toEqual(untouched(before[role]));
    }
  });
  it.each(['CAPTURE_ADMISSION', 'ITEM', 'CLAIM', 'FENCE'] as const)(
    'rolls back all item admission fences on %s failure without invoking capture',
    async (point) => {
      const { selector } = await beginItemCapture(),
        callback = jest.spyOn(f.left.batch, 'captureBatch');
      f.left.gate.fail = point;
      await unchangedBefore(
        () => f.left.itemCapture.advance(selector),
        'could not be acknowledged',
      );
      expect(callback).not.toHaveBeenCalled();
    },
  );
  it.each(['claim', 'epoch', 'period'] as const)(
    'denies an item with an invalidated original %s without repairs or capture',
    async (kind) => {
      const { selector, selected } = await beginItemCapture(),
        r = f.right.rows,
        callback = jest.spyOn(f.left.batch, 'captureBatch');
      // Adversarial fixture mutations only; none is a supported recovery action.
      if (kind === 'claim')
        await r.claims
          .updateOne(
            { _id: selected.animalId },
            { $set: { acceptanceOperationId: id(90) } },
          )
          .exec();
      if (kind === 'epoch')
        await r.controls.collection.updateOne(
          { animalId: selected.animalId },
          { $inc: { reservationEpoch: 1 } },
        );
      if (kind === 'period')
        await r.periods.collection.deleteOne({
          animalId: selected.animalId,
          ownershipVersion: 1,
          status: 'ACTIVE',
        });
      await unchangedBefore(() => f.left.itemCapture.advance(selector));
      expect(callback).not.toHaveBeenCalled();
    },
  );
  it('retains committed admission fences but never invokes capture after application reply loss', async () => {
    const { selector, selected } = await beginItemCapture(),
      callback = jest.spyOn(f.left.batch, 'captureBatch');
    f.loseNextCommitReply(f.left);
    await expect(f.left.itemCapture.advance(selector)).rejects.toMatchObject({
      status: 503,
    });
    expect(callback).not.toHaveBeenCalled();
    expect(
      (await f.right.rows.requests.findById(input.transferId).lean().exec())
        ?.captureStepRevision,
    ).toBe(1);
    const before = await f.snapshot(),
      from = f.commands.length;
    expect(await f.right.itemCapture.observe(selector)).toMatchObject({
      captureRevision: 0,
      reservation: 'OBSERVED_ONLY',
    });
    expect(await f.snapshot()).toEqual(before);
    expect(businessWrites(from)).toEqual([]);
    expect(
      await f.right.rows.entries.countDocuments({
        archiveId: selected.archiveId,
      }),
    ).toBe(0);
  });
  it('keeps a completed page after a callback observation error and does not start the next page on retry', async () => {
    const { selector } = await beginItemCapture(),
      callback = jest.spyOn(f.left.batch, 'captureBatch');
    f.left.gate.fail = 'CAPTURE_RETURN';
    await expect(f.left.itemCapture.advance(selector)).rejects.toMatchObject({
      status: 503,
    });
    const before = await f.snapshot();
    expect(await f.left.itemCapture.advance(selector)).toMatchObject({
      captureRevision: 1,
      callback: 'NOT_INVOKED',
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(await f.snapshot()).toEqual(before);
  });
  it('replays an appended page after failure before checkpoint without duplicating its immutable entry', async () => {
    const { selector, selected } = await beginItemCapture(),
      checkpoint = f.left.repository.checkpointCapture.bind(f.left.repository);
    jest
      .spyOn(f.left.repository, 'checkpointCapture')
      .mockImplementationOnce(async (...args) => {
        await f.left.gate.before('CAPTURE_CHECKPOINT');
        return checkpoint(...args);
      });
    f.left.gate.fail = 'CAPTURE_CHECKPOINT';
    await expect(f.left.itemCapture.advance(selector)).rejects.toMatchObject({
      status: 503,
    });
    expect(await f.right.itemCapture.observe(selector)).toMatchObject({
      captureRevision: 0,
      entryCount: 0,
    });
    const entries = await f.right.rows.entries.find().lean().exec();
    expect(entries).toHaveLength(1);
    expect(await f.right.itemCapture.advance(selector)).toMatchObject({
      captureRevision: 1,
      entryCount: 1,
      callback: 'RETURNED',
    });
    expect(await f.right.rows.entries.find().lean().exec()).toEqual(entries);
    expect(entries[0].archiveId).toBe(selected.archiveId);
  });
  it('retries a stale item admission snapshot as observed progress after the other client advances', async () => {
    const { selector } = await beginItemCapture(),
      callback = jest.spyOn(f.left.batch, 'captureBatch'),
      pause = f.left.gate.arm('CAPTURE_SNAPSHOT'),
      pending = f.observe(f.left.itemCapture.advance(selector));
    await pause.entered();
    await f.right.itemCapture.advance(selector);
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toMatchObject({
      value: { captureRevision: 1, callback: 'NOT_INVOKED' },
    });
    expect(callback).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });
  it('permits two callbacks to replay the same page while committing one cursor increment and one entry', async () => {
    const { selector } = await beginItemCapture(),
      checkpoint = f.left.repository.checkpointCapture.bind(f.left.repository),
      left = jest.spyOn(f.left.batch, 'captureBatch'),
      right = jest.spyOn(f.right.batch, 'captureBatch'),
      pause = f.left.gate.arm('CAPTURE_CHECKPOINT');
    // Pause AFTER append committed and BEFORE entering the real checkpoint tx,
    // so this barrier itself holds no Mongo write lock against the second client.
    jest
      .spyOn(f.left.repository, 'checkpointCapture')
      .mockImplementationOnce(async (...args) => {
        await f.left.gate.before('CAPTURE_CHECKPOINT');
        return checkpoint(...args);
      });
    const pending = f.observe(f.left.itemCapture.advance(selector));
    await pause.entered();
    expect(await f.right.itemCapture.advance(selector)).toMatchObject({
      captureRevision: 1,
      entryCount: 1,
    });
    pause.release();
    expect(await pending).toMatchObject({
      value: { captureRevision: 1, entryCount: 1 },
    });
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalledTimes(1);
    expect(await f.right.rows.entries.countDocuments()).toBe(1);
    expect(
      (await f.right.rows.requests.findById(input.transferId).lean().exec())
        ?.captureStepRevision,
    ).toBe(2);
    const from = f.commands.length;
    expect(await f.right.itemCapture.advance(selector)).toMatchObject({
      captureRevision: 1,
      callback: 'NOT_INVOKED',
    });
    expect(businessWrites(from)).toEqual([]);
  });
  it.each(['CAPTURE_CALL', 'CAPTURE_RETURN'] as const)(
    'rejects an invalidated original epoch at %s without releasing or adopting a reservation',
    async (point) => {
      const { selector, selected } = await beginItemCapture(),
        pause = f.left.gate.arm(point),
        pending = f.observe(f.left.itemCapture.advance(selector));
      await pause.entered();
      // Synthetic invalidation, not cancellation of an in-flight callback.
      await f.right.rows.controls.collection.updateOne(
        { animalId: selected.animalId },
        { $inc: { reservationEpoch: 1 } },
      );
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(await f.snapshot()).toEqual(before);
      expect(await f.right.rows.entries.countDocuments()).toBe(
        point === 'CAPTURE_CALL' ? 0 : 1,
      );
      expect(
        (
          await f.right.rows.controls
            .findOne({ animalId: selected.animalId })
            .lean()
            .exec()
        )?.transferLock?.transferId,
      ).toBe(input.transferId);
    },
  );
  it('allows observe to return an old snapshot but never treats it as permission for the next page', async () => {
    const { selector } = await beginItemCapture(),
      pause = f.left.gate.arm('CAPTURE_SNAPSHOT'),
      read = f.observe(f.left.itemCapture.observe(selector)),
      callback = jest.spyOn(f.left.batch, 'captureBatch');
    await pause.entered();
    await f.right.itemCapture.advance(selector);
    const before = await f.snapshot();
    pause.release();
    expect(await read).toMatchObject({
      value: { captureRevision: 0, reservation: 'OBSERVED_ONLY' },
    });
    expect(await f.left.itemCapture.advance(selector)).toMatchObject({
      captureRevision: 1,
      callback: 'NOT_INVOKED',
    });
    expect(callback).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });
  it('retains optional schemas and all declared indexes without TTL or implicit data migration', async () => {
    for (const row of Object.values(f.left.rows))
      expect(
        (await row.collection.indexes()).some(
          (i) => i.expireAfterSeconds !== undefined,
        ),
      ).toBe(false);
    const indexes = await f.right.rows.archives.collection.indexes();
    expect(
      indexes.some(
        (i) =>
          archiveHash(i.key) === archiveHash({ periodId: 1, transferId: 1 }) &&
          i.unique === true,
      ),
    ).toBe(true);
    const r = await f.right.rows.requests
      .findById(input.transferId)
      .lean()
      .exec();
    expect(r?.acceptanceStart).toBeUndefined();
    expect(await f.right.rows.archives.countDocuments()).toBe(0);
    expect(
      (await f.right.rows.controls.find().lean().exec()).every(
        (c) => c.reservationEpoch === undefined,
      ),
    ).toBe(true);
  });
});
