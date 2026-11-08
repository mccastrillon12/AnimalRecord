import { mongo } from 'mongoose';
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
import { ItemCopyDeclarationInput } from '../../../src/context/animal-transfer/domain/transfer-item-copy-record';
import {
  captureItemArchiveFileDefinition,
  ItemHistoricalSourceAnchorInput,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import { ITEM_COPY_RECORD_COLLECTION } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-item-copy-record.schema';
import {
  ItemSourceOperationalAccreditation,
  buildItemSourceDelegationBound,
  sourceRetentionSelectorHash,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import {
  ITEM_SOURCE_PROFILE_STATE_COLLECTION,
  ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
  itemSourceControlsHash,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-item-source-profile-state';

describe('Opt-in Mongo acceptance/capture, source/staging and manifest integrity; synthetic objects only', () => {
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
  it('persists a historical intent and all five fences in one acknowledged transaction without capture or storage', async () => {
    const { preparation, file, selected } = await f.seedHistoricalCopy(input);
    const before = await f.snapshot(),
      from = f.commands.length;
    const capture = jest.spyOn(f.left.batch, 'captureBatch');
    const inspect = jest.spyOn(f.left.storage, 'inspect');
    const copy = jest.spyOn(f.left.storage, 'copyAndVerify');
    const receipt = await f.left.itemCapture.prepareHistoricalCopy(preparation);
    expect(receipt).toMatchObject({
      replayed: false,
      fileId: file.id,
      reservation: 'FENCED_AT_PREPARATION',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
    });
    const commands = f.commands.slice(from),
      writes = businessWrites(from);
    expect(writes.map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
      'animal_ownership_archive_files',
    ]);
    const transaction = writes[0].transaction;
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
    const stored = await f.right.rows.files
      .findOne({ id: file.id })
      .lean()
      .exec();
    expect(stored).toMatchObject({
      state: 'PENDING',
      historicalCopyIntent: {
        id: receipt.intentId,
        definitionHash: receipt.intentDefinitionHash,
        kind: 'HISTORICAL',
        bucket: preparation.bucket,
        destination: { key: file.historicalKey, ifNoneMatch: '*' },
        copyDispatch: 'NOT_AUTHORIZED',
      },
    });
    expect(stored?.leaseToken).toBeUndefined();
    expect(stored?.verified).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(JSON.stringify(receipt)).not.toMatch(
      /bucket|sourceKey|sha256|https:|leaseToken/,
    );
    const after = await f.snapshot();
    for (const role of [
      'animals',
      'periods',
      'entries',
      'archives',
      'events',
      'notices',
      'outbox',
    ])
      expect(after[role]).toEqual(before[role]);
    expect(
      (
        await f.right.rows.controls
          .findOne({ animalId: selected.animalId })
          .lean()
          .exec()
      )?.reservationEpoch,
    ).toBe(selected.reservationEpoch);
  });
  it('replays the historical definition across clients without replacing its file or permitting the base claimant', async () => {
    const { preparation, selected } = await f.seedHistoricalCopy(input);
    const first = await f.left.itemCapture.prepareHistoricalCopy(preparation);
    const files = await f.right.rows.files.find().lean().exec();
    const from = f.commands.length;
    expect(
      await f.right.itemCapture.prepareHistoricalCopy(preparation),
    ).toEqual({ ...first, replayed: true });
    expect(businessWrites(from).map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
    ]);
    expect(
      await f.right.repository.claimFile(
        selected.archiveId,
        'legacy-token',
        '2026-11-02T00:00:00Z',
        '2026-11-02T00:05:00Z',
      ),
    ).toBeNull();
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
  });
  it.each([
    'CAPTURE_ADMISSION',
    'ITEM',
    'CLAIM',
    'FENCE',
    'HISTORICAL_INTENT',
  ] as const)(
    'rolls back historical preparation and every tentative fence on %s failure',
    async (point) => {
      const { preparation } = await f.seedHistoricalCopy(input);
      f.left.gate.fail = point;
      await unchangedBefore(
        () => f.left.itemCapture.prepareHistoricalCopy(preparation),
        'could not be acknowledged',
      );
      expect(
        (
          await f.right.rows.files
            .findOne({ id: preparation.fileId })
            .lean()
            .exec()
        )?.historicalCopyIntent,
      ).toBeUndefined();
    },
  );
  it.each(['bucket', 'digest', 'fileHash', 'sealHash'] as const)(
    'rejects conflicting historical %s without overwriting the original intent',
    async (kind) => {
      const { preparation } = await f.seedHistoricalCopy(input);
      await f.left.itemCapture.prepareHistoricalCopy(preparation);
      const changed = { ...preparation };
      if (kind === 'bucket') changed.bucket = 'other-synthetic-bucket';
      if (kind === 'digest') changed.sourceSha256 = 'b'.repeat(64);
      if (kind === 'fileHash')
        changed.expectedFileDefinitionHash = 'b'.repeat(64);
      if (kind === 'sealHash') changed.expectedSealHash = 'b'.repeat(64);
      await unchangedBefore(() =>
        f.right.itemCapture.prepareHistoricalCopy(changed),
      );
    },
  );
  it('retries a concurrent historical snapshot as exact replay after the other client commits', async () => {
    const { preparation } = await f.seedHistoricalCopy(input);
    const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT');
    const pending = f.observe(
      f.left.itemCapture.prepareHistoricalCopy(preparation),
    );
    await pause.entered(); // Request/item/claim/header/control snapshot, no write locks yet.
    const winner = await f.right.itemCapture.prepareHistoricalCopy(preparation);
    const files = await f.right.rows.files.find().lean().exec();
    pause.release();
    expect(await pending).toMatchObject({
      value: { ...winner, replayed: true },
    });
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(
      (await f.right.rows.requests.findById(input.transferId).lean().exec())
        ?.captureStepRevision,
    ).toBe(2);
  });
  it('rejects a competing digest after retry instead of replacing the winner or inventing another intent', async () => {
    const { preparation } = await f.seedHistoricalCopy(input);
    const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT');
    const pending = f.observe(
      f.left.itemCapture.prepareHistoricalCopy({
        ...preparation,
        sourceSha256: 'b'.repeat(64),
      }),
    );
    await pause.entered();
    await f.right.itemCapture.prepareHistoricalCopy(preparation);
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toMatchObject({
      error: { message: 'The historical copy intent cannot be replaced' },
    });
    expect(await f.snapshot()).toEqual(before);
  });
  it('retains the historical intent after application reply loss following a real acknowledged commit', async () => {
    const { preparation } = await f.seedHistoricalCopy(input);
    f.loseNextCommitReply(f.left);
    await expect(
      f.left.itemCapture.prepareHistoricalCopy(preparation),
    ).rejects.toMatchObject({ status: 503 });
    const files = await f.right.rows.files.find().lean().exec();
    expect(files[0].historicalCopyIntent?.copyDispatch).toBe('NOT_AUTHORIZED');
    const receipt =
      await f.right.itemCapture.prepareHistoricalCopy(preparation);
    expect(receipt).toMatchObject({
      replayed: true,
      intentDefinitionHash: files[0].historicalCopyIntent?.definitionHash,
    });
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
  });
  it.each(['epoch', 'claim'] as const)(
    'aborts a historical snapshot after original %s invalidation before its fences',
    async (kind) => {
      const { preparation, selected } = await f.seedHistoricalCopy(input);
      const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT');
      const pending = f.observe(
        f.left.itemCapture.prepareHistoricalCopy(preparation),
      );
      await pause.entered();
      // Adversarial fixture mutations, not a supported recovery or cancellation protocol.
      if (kind === 'epoch')
        await f.right.rows.controls.collection.updateOne(
          { animalId: selected.animalId },
          { $inc: { reservationEpoch: 1 } },
        );
      else
        await f.right.rows.claims.collection.updateOne(
          { _id: selected.animalId } as never,
          { $set: { acceptanceOperationId: id(90) } },
        );
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toMatchObject({
        error: {
          message: expect.stringContaining(
            kind === 'epoch' ? 'original matching' : 'original decision',
          ) as unknown,
        },
      });
      expect(await f.snapshot()).toEqual(before);
    },
  );
  it('retries a base claimant snapshot after historical preparation wins, leaving the file unclaimed', async () => {
    const { preparation, selected } = await f.seedHistoricalCopy(input);
    const pause = f.left.gate.arm('FENCE');
    const pending = f.observe(
      f.left.repository.claimFile(
        selected.archiveId,
        'legacy-token',
        '2026-11-02T00:00:00Z',
        '2026-11-02T00:05:00Z',
      ),
    );
    await pause.entered(); // Before control write: no transaction holds the competing write lock.
    await f.right.itemCapture.prepareHistoricalCopy(preparation);
    const files = await f.right.rows.files.find().lean().exec();
    pause.release();
    expect(await pending).toEqual({ value: null });
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    // Empty claim may increment its technical control fence; it grants no work or I/O.
  });
  it('does not adopt a file when the base claimant wins before historical preparation fences', async () => {
    const { preparation, selected } = await f.seedHistoricalCopy(input);
    const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT');
    const pending = f.observe(
      f.left.itemCapture.prepareHistoricalCopy(preparation),
    );
    await pause.entered();
    expect(
      await f.right.repository.claimFile(
        selected.archiveId,
        'legacy-token',
        '2026-11-02T00:00:00Z',
        '2026-11-02T00:05:00Z',
      ),
    ).toMatchObject({
      id: preparation.fileId,
      state: 'COPYING',
      leaseToken: 'legacy-token',
    });
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toMatchObject({
      error: {
        message: expect.stringContaining('pending manifest file') as unknown,
      },
    });
    expect(await f.snapshot()).toEqual(before);
    expect(
      (
        await f.right.rows.files
          .findOne({ id: preparation.fileId })
          .lean()
          .exec()
      )?.historicalCopyIntent,
    ).toBeUndefined();
  });
  it.each([null, { unsupported: true }])(
    'quarantines a malformed historical intent field from the base claimant: %p',
    async (value) => {
      const { preparation, selected } = await f.seedHistoricalCopy(input);
      await f.right.rows.files.collection.updateOne(
        { id: preparation.fileId },
        { $set: { historicalCopyIntent: value } } as never,
      );
      const files = await f.right.rows.files.find().lean().exec();
      expect(
        await f.left.repository.claimFile(
          selected.archiveId,
          'legacy-token',
          '2026-11-02T00:00:00Z',
          '2026-11-02T00:05:00Z',
        ),
      ).toBeNull();
      expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
      await unchangedBefore(() =>
        f.left.itemCapture.prepareHistoricalCopy(preparation),
      );
    },
  );
  it.each(['id_1', 'archiveId_1_sourceKey_1'])(
    'fails closed without historical writes when file uniqueness %s is absent',
    async (index) => {
      const { preparation } = await f.seedHistoricalCopy(input);
      await f.left.rows.files.collection.dropIndex(index);
      const from = f.commands.length;
      await unchangedBefore(
        () => f.left.itemCapture.prepareHistoricalCopy(preparation),
        'could not be acknowledged',
      );
      expect(businessWrites(from)).toEqual([]);
    },
  );
  it('reads historical context and probes an empty staging slot without fences or object I/O', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    const before = await f.snapshot(),
      from = f.commands.length;
    const context =
      await f.left.itemCaptureStore.readHistoricalCopy(preparation);
    expect(context.file.historicalCopyIntent?.kind).toBe('HISTORICAL');
    expect(
      await f.left.itemCaptureStore.resumeStagingCopy(preparation),
    ).toBeNull();
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.historicalReader.calls).toEqual([]);
    expect(await f.snapshot()).toEqual(before);
  });
  it('commits the observed bytes and staging intent in one file CAS with all four original fences', async () => {
    const { preparation, file, selected } = await f.seedStagingCopy(input);
    const before = await f.snapshot(),
      from = f.commands.length;
    const startSession = f.left.connection.startSession.bind(f.left.connection);
    const sessions: Awaited<ReturnType<typeof startSession>>[] = [];
    jest
      .spyOn(f.left.connection, 'startSession')
      .mockImplementation(async (...args) => {
        const session = await startSession(...args);
        sessions.push(session);
        return session;
      });
    f.left.historicalReader.assertOutsideTransaction = () => {
      expect(sessions).toHaveLength(2); // Empty-slot probe, then the historical read.
      expect(sessions.every((s) => s.hasEnded)).toBe(true);
      expect(businessWrites(from)).toEqual([]);
    };
    const capture = jest.spyOn(f.left.batch, 'captureBatch');
    const inspect = jest.spyOn(f.left.storage, 'inspect');
    const copy = jest.spyOn(f.left.storage, 'copyAndVerify');
    const receipt = await f.left.staging.prepare(preparation);
    expect(receipt).toMatchObject({
      replayed: false,
      fileId: file.id,
      reservation: 'FENCED_AT_PREPARATION',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.hasEnded)).toBe(true);
    expect(f.left.historicalReader.calls).toEqual([
      'HEAD',
      'READ',
      'CLOSE',
      'HEAD',
    ]);
    const writes = businessWrites(from),
      commands = f.commands.slice(from);
    expect(writes.map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
      'animal_ownership_archive_files',
    ]);
    const transaction = writes[0].transaction;
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
    const stored = await f.right.rows.files
      .findOne({ id: file.id })
      .lean()
      .exec();
    expect(stored).toMatchObject({
      definitionHash: file.definitionHash,
      state: 'PENDING',
      historicalByteObservation: {
        observationHash: receipt.observationHash,
        bytes: 'MATCH',
        reservation: 'OBSERVED_ONLY',
      },
      stagingCopyIntent: {
        id: receipt.intentId,
        definitionHash: receipt.intentDefinitionHash,
        kind: 'RECIPIENT_STAGING',
        source: {
          key: file.historicalKey,
          revision: f.left.historicalReader.revision,
        },
        destination: { key: file.recipientStagingKey, ifNoneMatch: '*' },
        predecessor: { observationHash: receipt.observationHash },
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      },
    });
    expect(stored?.leaseToken).toBeUndefined();
    expect(stored?.verified).toBeUndefined();
    const after = await f.snapshot();
    for (const role of [
      'animals',
      'periods',
      'entries',
      'archives',
      'events',
      'notices',
      'outbox',
    ])
      expect(after[role]).toEqual(before[role]);
    expect(
      (
        await f.right.rows.controls
          .findOne({ animalId: selected.animalId })
          .lean()
          .exec()
      )?.reservationEpoch,
    ).toBe(selected.reservationEpoch);
    expect(capture).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(JSON.stringify(receipt)).not.toMatch(
      /bucket|sourceKey|sha256|https:|leaseToken/,
    );
  });
  it('replays the complete pair on another client without a new object read or file replacement', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    const first = await f.left.staging.prepare(preparation);
    const files = await f.right.rows.files.find().lean().exec(),
      from = f.commands.length;
    expect(await f.right.staging.prepare(preparation)).toEqual({
      ...first,
      replayed: true,
    });
    expect(f.right.historicalReader.calls).toEqual([]);
    expect(f.left.historicalReader.calls).toHaveLength(4);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(businessWrites(from).map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
    ]);
  });
  it.each([
    'CAPTURE_ADMISSION',
    'ITEM',
    'CLAIM',
    'FENCE',
    'STAGING_INTENT',
  ] as const)(
    'rolls back the observed pair and all four fences on %s failure',
    async (point) => {
      const { preparation } = await f.seedStagingCopy(input);
      f.left.gate.fail = point;
      await unchangedBefore(
        () => f.left.staging.prepare(preparation),
        'could not be acknowledged',
      );
      const file = await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec();
      expect(file?.historicalCopyIntent).toBeDefined();
      expect(file?.historicalByteObservation).toBeUndefined();
      expect(file?.stagingCopyIntent).toBeUndefined();
      expect(f.left.historicalReader.calls).toEqual([
        'HEAD',
        'READ',
        'CLOSE',
        'HEAD',
      ]);
    },
  );
  it('retries a confirmation snapshot as exact replay when the other client commits the same observation', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    const observation = await f.left.historicalObserver.observe(preparation);
    const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT');
    const pending = f.observe(
      f.left.itemCaptureStore.confirmHistoricalObservation(
        preparation,
        observation,
      ),
    );
    await pause.entered(); // Snapshot acquired, no competing write locks held.
    const winner = await f.right.itemCaptureStore.confirmHistoricalObservation(
      preparation,
      observation,
    );
    const files = await f.right.rows.files.find().lean().exec();
    pause.release();
    expect(await pending).toEqual({ value: { ...winner, replayed: true } });
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(f.right.historicalReader.calls).toEqual([]);
  });
  it('rejects a competing observed revision after retry without replacing the winning pair', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    const left = await f.left.historicalObserver.observe(preparation);
    f.right.historicalReader.revision.versionId = 'synthetic-historical-v2';
    const right = await f.right.historicalObserver.observe(preparation);
    const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT');
    const pending = f.observe(
      f.left.itemCaptureStore.confirmHistoricalObservation(preparation, left),
    );
    await pause.entered();
    await f.right.itemCaptureStore.confirmHistoricalObservation(
      preparation,
      right,
    );
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toMatchObject({
      error: {
        message:
          'The historical observation or staging intent cannot be replaced',
      },
    });
    expect(await f.snapshot()).toEqual(before);
  });
  it.each(['epoch', 'claim', 'request', 'seal'] as const)(
    'revalidates original %s after synthetic byte reads before confirming the pair',
    async (kind) => {
      const { preparation, selected } = await f.seedStagingCopy(input);
      const pause = f.left.gate.arm('HISTORICAL_OBSERVED');
      const pending = f.observe(f.left.staging.prepare(preparation));
      await pause.entered();
      // Adversarial fixture mutations; these are not recovery/cancellation APIs.
      if (kind === 'epoch')
        await f.right.rows.controls.collection.updateOne(
          { animalId: selected.animalId },
          { $inc: { reservationEpoch: 1 } },
        );
      if (kind === 'claim')
        await f.right.rows.claims.collection.updateOne(
          { _id: selected.animalId } as never,
          { $set: { acceptanceOperationId: id(90) } },
        );
      if (kind === 'request')
        await f.right.rows.requests.collection.updateOne(
          { _id: input.transferId } as never,
          { $inc: { version: 1 } },
        );
      if (kind === 'seal')
        await f.right.rows.archives.collection.updateOne(
          { id: selected.archiveId },
          { $inc: { 'capture.revision': 1 } },
        );
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(await f.snapshot()).toEqual(before);
      expect(
        (
          await f.right.rows.files
            .findOne({ id: preparation.fileId })
            .lean()
            .exec()
        )?.stagingCopyIntent,
      ).toBeUndefined();
    },
  );
  it('reconciles application reply loss after a real acknowledged confirmation commit without observing bytes again', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    const pause = f.left.gate.arm('HISTORICAL_OBSERVED');
    const pending = f.observe(f.left.staging.prepare(preparation));
    await pause.entered();
    f.loseNextCommitReply(f.left); // The next session is the confirmation, not either read-only probe.
    pause.release();
    expect(await pending).toMatchObject({ error: { status: 503 } });
    const files = await f.right.rows.files.find().lean().exec();
    expect(files[0].historicalByteObservation).toBeDefined();
    expect(files[0].stagingCopyIntent?.copyDispatch).toBe('NOT_AUTHORIZED');
    expect(await f.left.staging.prepare(preparation)).toMatchObject({
      replayed: true,
    });
    expect(f.left.historicalReader.calls).toHaveLength(4);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
  });
  it('preserves the pair when real session close succeeds but the application observes a close error', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    const observation = await f.left.historicalObserver.observe(preparation);
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
    await expect(
      f.left.itemCaptureStore.confirmHistoricalObservation(
        preparation,
        observation,
      ),
    ).rejects.toMatchObject({ status: 503 });
    const files = await f.right.rows.files.find().lean().exec();
    expect(files[0].stagingCopyIntent).toBeDefined();
    expect(await f.right.staging.prepare(preparation)).toMatchObject({
      replayed: true,
    });
    expect(f.right.historicalReader.calls).toEqual([]);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
  });
  it('keeps the manifest and all fences unchanged when the synthetic reader fails', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    const from = f.commands.length;
    f.left.gate.fail = 'HISTORICAL_READ';
    await unchangedBefore(
      () => f.left.staging.prepare(preparation),
      'bytes could not be observed',
    );
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.historicalReader.calls).toEqual(['HEAD', 'READ']);
  });
  it('denies a synthetic digest mismatch and closes the stream without persisting either field', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    f.left.historicalReader.bytes = Buffer.from('animal-byteX');
    await unchangedBefore(
      () => f.left.staging.prepare(preparation),
      'does not match',
    );
    expect(f.left.historicalReader.calls).toEqual(['HEAD', 'READ', 'CLOSE']);
  });
  it('denies a changed current revision after the pinned synthetic stream without confirming stale bytes', async () => {
    const { preparation } = await f.seedStagingCopy(input);
    const pause = f.left.gate.arm('HISTORICAL_READ');
    const pending = f.observe(f.left.staging.prepare(preparation));
    await pause.entered();
    const before = await f.snapshot();
    f.left.historicalReader.revision.versionId = 'synthetic-historical-v2';
    pause.release();
    expect(await pending).toHaveProperty('error');
    expect(await f.snapshot()).toEqual(before);
    expect(f.left.historicalReader.calls).toEqual([
      'HEAD',
      'READ',
      'CLOSE',
      'HEAD',
    ]);
  });
  it.each([
    'missingObservation',
    'missingIntent',
    'nullObservation',
    'corruptIntent',
  ] as const)(
    'blocks a %s pair without repairing it or reading objects again',
    async (kind) => {
      const { preparation } = await f.seedStagingCopy(input);
      await f.left.staging.prepare(preparation);
      const update =
        kind === 'missingObservation'
          ? { $unset: { historicalByteObservation: '' } }
          : kind === 'missingIntent'
            ? { $unset: { stagingCopyIntent: '' } }
            : kind === 'nullObservation'
              ? { $set: { historicalByteObservation: null } }
              : { $set: { stagingCopyIntent: {} } };
      await f.right.rows.files.collection.updateOne(
        { id: preparation.fileId },
        update as never,
      );
      await unchangedBefore(() => f.right.staging.prepare(preparation));
      expect(f.right.historicalReader.calls).toEqual([]);
    },
  );
  it.each([
    'historicalByteObservation',
    'stagingCopyIntent',
    'sourceByteObservation',
    'stagingByteObservation',
    'sourceRetentionObservation',
    'sourceProfileObservationSet',
  ] as const)(
    'excludes an orphan %s from the base claimant even without a historical intent',
    async (field) => {
      const { preparation, selected } = await f.seedHistoricalCopy(input);
      await f.right.rows.files.collection.updateOne(
        { id: preparation.fileId },
        { $set: { [field]: null } } as never,
      );
      const files = await f.right.rows.files.find().lean().exec();
      expect(
        await f.left.repository.claimFile(
          selected.archiveId,
          'legacy-token',
          '2026-11-02T00:00:00Z',
          '2026-11-02T00:05:00Z',
        ),
      ).toBeNull();
      expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
      await unchangedBefore(() => f.left.staging.prepare(preparation));
      expect(f.left.historicalReader.calls).toEqual([]);
    },
  );
  it.each(['id_1', 'archiveId_1_sourceKey_1'])(
    'refuses confirmation before fences when file uniqueness %s is absent',
    async (index) => {
      const { preparation } = await f.seedStagingCopy(input);
      const observation = await f.left.historicalObserver.observe(preparation);
      await f.left.rows.files.collection.dropIndex(index);
      const from = f.commands.length;
      await unchangedBefore(
        () =>
          f.left.itemCaptureStore.confirmHistoricalObservation(
            preparation,
            observation,
          ),
        'could not be acknowledged',
      );
      expect(businessWrites(from)).toEqual([]);
    },
  );
  it.each(['binding', 'hash', 'revision'] as const)(
    'rejects a mismatched collector %s instead of trusting a MATCH payload',
    async (kind) => {
      const { preparation } = await f.seedStagingCopy(input);
      const raw = structuredClone(
        await f.left.historicalObserver.observe(preparation),
      );
      if (kind === 'binding')
        (raw.binding as { itemId: string }).itemId = id(90);
      if (kind === 'hash')
        (raw as { observationHash: string }).observationHash = 'b'.repeat(64);
      if (kind === 'revision') {
        (raw.observation.revision as { size: number }).size = 13;
        (raw as { observationHash: string }).observationHash = archiveHash(
          raw.observation,
        );
      }
      const before = await f.snapshot(),
        from = f.commands.length;
      await expect(
        Promise.resolve().then(() =>
          f.left.itemCaptureStore.confirmHistoricalObservation(
            preparation,
            raw,
          ),
        ),
      ).rejects.toThrow();
      expect(await f.snapshot()).toEqual(before);
      expect(businessWrites(from)).toEqual([]);
    },
  );
  it('traverses over 100 manifest entries and files with physical singleBatch commands and separate read snapshots', async () => {
    const { manifest } = await f.seedManifest(input, 203);
    const before = await f.snapshot(),
      from = f.commands.length,
      findsFrom = f.manifestFinds.length;
    const observed = await f.left.manifestObserver.observe(manifest);
    const commands = f.commands.slice(from),
      finds = f.manifestFinds.slice(findsFrom);
    expect(observed).toMatchObject({
      entryCount: 203,
      fileCount: 203,
      reservation: 'OBSERVED_ONLY',
      stableCut: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(f.left.manifestPages).toEqual([
      { phase: 'ENTRIES', count: 100 },
      { phase: 'ENTRIES', count: 100 },
      { phase: 'ENTRIES', count: 3 },
      { phase: 'ENTRIES', count: 0 },
      { phase: 'FILES', count: 100 },
      { phase: 'FILES', count: 100 },
      { phase: 'FILES', count: 3 },
      { phase: 'FILES', count: 0 },
      { phase: 'COMPLETE' },
    ]);
    expect(finds).toHaveLength(8);
    expect(
      finds.every(
        (c) =>
          c.limit === 100 &&
          c.singleBatch &&
          c.simpleCollation &&
          c.ascendingId &&
          c.transactional,
      ),
    ).toBe(true);
    expect(commands.some((c) => c.command === 'getMore')).toBe(false);
    expect(
      new Set(commands.filter((c) => c.transaction).map((c) => c.transaction))
        .size,
    ).toBe(9);
    expect(businessWrites(from)).toEqual([]);
    expect(await f.right.manifestObserver.observe(manifest)).toEqual(observed);
    expect(await f.snapshot()).toEqual(before);
    expect(f.left.historicalReader.calls).toEqual([]);
  });
  it('continues from a real short firstBatch caused by large synthetic payloads until empty, without getMore', async () => {
    const { manifest } = await f.seedManifest(input, 12, true, 2 * 1024 * 1024);
    const from = f.commands.length;
    const observed = await f.left.manifestObserver.observe(manifest);
    const entries = f.left.manifestPages.filter((p) => p.phase === 'ENTRIES');
    expect(entries[0].count).toBeGreaterThan(0);
    expect(entries[0].count).toBeLessThan(12);
    expect(entries.at(-1)!.count).toBe(0);
    expect(entries.reduce((n, p) => n + p.count!, 0)).toBe(12);
    expect(observed).toMatchObject({ entryCount: 12, fileCount: 12 });
    expect(f.commands.slice(from).some((c) => c.command === 'getMore')).toBe(
      false,
    );
    expect(businessWrites(from)).toEqual([]);
  });
  it('persists zero-file manifest integrity only after the empty file page and final snapshot', async () => {
    const { manifest } = await f.seedManifest(input, 1, false);
    const result = await f.left.manifestPreparer.prepare(manifest);
    expect(result).toMatchObject({
      fileCount: 0,
      replayed: false,
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(f.left.manifestPages).toEqual([
      { phase: 'ENTRIES', count: 1 },
      { phase: 'ENTRIES', count: 0 },
      { phase: 'FILES', count: 0 },
      { phase: 'COMPLETE' },
    ]);
    expect(
      (
        await f.right.rows.archives
          .findOne({ id: result.archiveId })
          .lean()
          .exec()
      )?.manifestDigest?.fileCount,
    ).toBe(0);
    expect(f.left.historicalReader.calls).toEqual([]);
  });
  it('confirms the observed digest and four original fences in one acknowledged snapshot/majority transaction', async () => {
    const { manifest, archiveId } = await f.seedManifest(input, 3);
    const observed = await f.left.manifestObserver.observe(manifest);
    expect(
      await f.left.itemCaptureStore.resumeManifestDigest(manifest),
    ).toBeNull();
    const before = await f.snapshot(),
      from = f.commands.length,
      finds = f.manifestFinds.length;
    const result = await f.left.itemCaptureStore.confirmManifestDigest(
      manifest,
      observed,
    );
    const commands = f.commands.slice(from),
      writes = businessWrites(from),
      transaction = writes[0].transaction;
    expect(writes.map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
      'animal_ownership_archives',
    ]);
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
    expect(f.manifestFinds).toHaveLength(finds);
    expect(result).toMatchObject({
      manifestHash: observed.manifestHash,
      replayed: false,
      reservation: 'FENCED_AT_PREPARATION',
      provenance: 'NOT_ASSESSED',
      stableCut: 'NOT_ASSESSED',
      retention: 'NOT_ASSESSED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    const after = await f.snapshot(),
      headersBefore = before.archives as Array<Record<string, unknown>>;
    expect(after.archives).toEqual(
      headersBefore.map((a) =>
        a.id === archiveId ? { ...a, manifestDigest: observed } : a,
      ),
    );
    for (const role of [
      'animals',
      'periods',
      'entries',
      'files',
      'events',
      'notices',
      'outbox',
    ])
      expect(after[role]).toEqual(before[role]);
    expect(JSON.stringify(result)).not.toMatch(
      /users\/|payload|Brownie|leaseToken|sourceKey|sha256/,
    );
  });
  it('replays a persisted manifest across clients with only four fences and no new row traversal', async () => {
    const { manifest, archiveId } = await f.seedManifest(input);
    const first = await f.left.manifestPreparer.prepare(manifest);
    const header = await f.right.rows.archives
        .findOne({ id: archiveId })
        .lean()
        .exec(),
      from = f.commands.length,
      finds = f.manifestFinds.length;
    expect(await f.right.manifestPreparer.prepare(manifest)).toEqual({
      ...first,
      replayed: true,
    });
    expect(f.right.manifestPages).toEqual([]);
    expect(f.manifestFinds).toHaveLength(finds);
    expect(businessWrites(from).map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
    ]);
    expect(
      await f.right.rows.archives.findOne({ id: archiveId }).lean().exec(),
    ).toEqual(header);
  });
  it.each([
    'CAPTURE_ADMISSION',
    'ITEM',
    'CLAIM',
    'FENCE',
    'MANIFEST_DIGEST',
  ] as const)(
    'rolls back the observed manifest and every tentative fence on %s failure',
    async (point) => {
      const { manifest, archiveId } = await f.seedManifest(input);
      const observed = await f.left.manifestObserver.observe(manifest);
      f.left.gate.fail = point;
      await unchangedBefore(
        () => f.left.itemCaptureStore.confirmManifestDigest(manifest, observed),
        'could not be acknowledged',
      );
      expect(
        (await f.right.rows.archives.findOne({ id: archiveId }).lean().exec())
          ?.manifestDigest,
      ).toBeUndefined();
    },
  );
  it.each(['epoch', 'claim', 'request'] as const)(
    'denies completion after original %s invalidation during a read-only manifest snapshot',
    async (kind) => {
      const { manifest, selected } = await f.seedManifest(input, 3),
        pause = f.left.gate.arm('MANIFEST_ROWS');
      const pending = f.observe(f.left.manifestObserver.observe(manifest));
      await pause.entered(); // No write locks: the paused read may still return its older snapshot.
      if (kind === 'epoch')
        await f.right.rows.controls.collection.updateOne(
          { animalId: selected.animalId },
          { $inc: { reservationEpoch: 1 } },
        );
      if (kind === 'claim')
        await f.right.rows.claims.collection.updateOne(
          { _id: selected.animalId } as never,
          { $set: { acceptanceOperationId: id(90) } },
        );
      if (kind === 'request')
        await f.right.rows.requests.collection.updateOne(
          { _id: input.transferId } as never,
          { $inc: { version: 1 } },
        );
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(await f.snapshot()).toEqual(before);
    },
  );
  it('revalidates the original reservation in a fresh snapshot after the empty terminal file page', async () => {
    const { manifest, selected } = await f.seedManifest(input),
      pause = f.left.gate.arm('MANIFEST_TERMINAL');
    const pending = f.observe(f.left.manifestObserver.observe(manifest));
    await pause.entered();
    await f.right.rows.controls.collection.updateOne(
      { animalId: selected.animalId },
      { $inc: { reservationEpoch: 1 } },
    );
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toHaveProperty('error');
    expect(await f.snapshot()).toEqual(before);
  });
  it.each(['epoch', 'claim', 'seal', 'period'] as const)(
    'refuses to persist a completed observation after %s invalidation before its confirmation',
    async (kind) => {
      const { manifest, selected, archiveId } = await f.seedManifest(input),
        pause = f.left.gate.arm('MANIFEST_OBSERVED');
      const pending = f.observe(f.left.manifestPreparer.prepare(manifest));
      await pause.entered();
      // Adversarial fixture mutations, not recovery/cancellation procedures.
      if (kind === 'epoch')
        await f.right.rows.controls.collection.updateOne(
          { animalId: selected.animalId },
          { $inc: { reservationEpoch: 1 } },
        );
      if (kind === 'claim')
        await f.right.rows.claims.collection.updateOne(
          { _id: selected.animalId } as never,
          { $set: { acceptanceOperationId: id(90) } },
        );
      if (kind === 'seal')
        await f.right.rows.archives.collection.updateOne(
          { id: archiveId },
          { $inc: { 'capture.revision': 1 } },
        );
      if (kind === 'period')
        await f.right.rows.periods.collection.deleteOne({
          animalId: selected.animalId,
        });
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(await f.snapshot()).toEqual(before);
      expect(
        (await f.right.rows.archives.findOne({ id: archiveId }).lean().exec())
          ?.manifestDigest,
      ).toBeUndefined();
    },
  );
  it('retries a competing manifest confirmation as exact replay after the other client commits', async () => {
    const { manifest, archiveId } = await f.seedManifest(input);
    const observed = await f.left.manifestObserver.observe(manifest),
      pause = f.left.gate.arm('MANIFEST_SNAPSHOT');
    const pending = f.observe(
      f.left.itemCaptureStore.confirmManifestDigest(manifest, observed),
    );
    await pause.entered(); // Request/item/claim snapshot, before any shared write lock.
    const winner = await f.right.itemCaptureStore.confirmManifestDigest(
      manifest,
      observed,
    );
    const header = await f.right.rows.archives
      .findOne({ id: archiveId })
      .lean()
      .exec();
    pause.release();
    expect(await pending).toEqual({ value: { ...winner, replayed: true } });
    expect(
      await f.right.rows.archives.findOne({ id: archiveId }).lean().exec(),
    ).toEqual(header);
  });
  it('rejects a competing valid manifest digest after retry without replacing the winner', async () => {
    const { manifest } = await f.seedManifest(input);
    const old = await f.left.manifestObserver.observe(manifest);
    const entry = (await f.right.rows.entries.findOne().lean().exec())!;
    entry.payload.name = 'Adversarial synthetic change';
    const contentHash = archiveHash({
      kind: entry.kind,
      payload: entry.payload,
      fileBindings: entry.fileBindings,
    });
    await f.right.rows.entries.collection.updateOne(
      { id: entry.id },
      { $set: { payload: entry.payload, contentHash } },
    );
    const newer = await f.right.manifestObserver.observe(manifest),
      pause = f.left.gate.arm('MANIFEST_SNAPSHOT');
    const pending = f.observe(
      f.left.itemCaptureStore.confirmManifestDigest(manifest, old),
    );
    await pause.entered();
    await f.right.itemCaptureStore.confirmManifestDigest(manifest, newer);
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toMatchObject({
      error: { message: 'The observed manifest digest cannot be replaced' },
    });
    expect(await f.snapshot()).toEqual(before);
  });
  it('reconciles application reply loss after a real acknowledged digest commit with no new traversal', async () => {
    const { manifest, archiveId } = await f.seedManifest(input),
      pause = f.left.gate.arm('MANIFEST_OBSERVED');
    const pending = f.observe(f.left.manifestPreparer.prepare(manifest));
    await pause.entered();
    f.loseNextCommitReply(f.left); // Next session is confirmation, after all read sessions have closed.
    pause.release();
    expect(await pending).toMatchObject({ error: { status: 503 } });
    const header = await f.right.rows.archives
      .findOne({ id: archiveId })
      .lean()
      .exec();
    expect(header?.manifestDigest).toBeDefined();
    const finds = f.manifestFinds.length;
    expect(await f.right.manifestPreparer.prepare(manifest)).toMatchObject({
      replayed: true,
    });
    expect(f.manifestFinds).toHaveLength(finds);
    expect(
      await f.right.rows.archives.findOne({ id: archiveId }).lean().exec(),
    ).toEqual(header);
  });
  it('retains the digest after actual session close followed by an application close error', async () => {
    const { manifest, archiveId } = await f.seedManifest(input),
      observed = await f.left.manifestObserver.observe(manifest);
    const start = f.left.connection.startSession.bind(f.left.connection);
    jest
      .spyOn(f.left.connection, 'startSession')
      .mockImplementationOnce(async (...args) => {
        const session = await start(...args),
          end = session.endSession.bind(session);
        jest
          .spyOn(session, 'endSession')
          .mockImplementationOnce(async (...endArgs) => {
            await end(...endArgs);
            throw new Error(
              'Injected application error after actual session close',
            );
          });
        return session;
      });
    await expect(
      f.left.itemCaptureStore.confirmManifestDigest(manifest, observed),
    ).rejects.toMatchObject({ status: 503 });
    const header = await f.right.rows.archives
      .findOne({ id: archiveId })
      .lean()
      .exec();
    expect(header?.manifestDigest?.manifestHash).toBe(observed.manifestHash);
    expect(await f.right.manifestPreparer.prepare(manifest)).toMatchObject({
      replayed: true,
    });
    expect(f.right.manifestPages).toEqual([]);
    expect(
      await f.right.rows.archives.findOne({ id: archiveId }).lean().exec(),
    ).toEqual(header);
  });
  it.each(['null', 'empty', 'hash', 'extra'] as const)(
    'keeps a %s persisted digest blocked without repairing it or traversing rows',
    async (kind) => {
      const { manifest, archiveId } = await f.seedManifest(input);
      await f.left.manifestPreparer.prepare(manifest);
      const header = (await f.right.rows.archives
        .findOne({ id: archiveId })
        .lean()
        .exec())!;
      const raw = structuredClone(header.manifestDigest) as unknown as Record<
        string,
        unknown
      >;
      if (kind === 'hash') raw.manifestHash = 'b'.repeat(64);
      if (kind === 'extra') raw.canCopy = true;
      await f.right.rows.archives.collection.updateOne({ id: archiveId }, {
        $set: {
          manifestDigest: kind === 'null' ? null : kind === 'empty' ? {} : raw,
        },
      } as never);
      const finds = f.manifestFinds.length;
      await unchangedBefore(() => f.right.manifestPreparer.prepare(manifest));
      expect(f.manifestFinds).toHaveLength(finds);
    },
  );
  it.each(['id_1', 'archiveId_1_kind_1_resourceId_1', 'archiveId_1_id_1'])(
    'fails manifest readiness when existing entry index %s is absent, without installing it',
    async (index) => {
      const { manifest } = await f.seedManifest(input);
      await f.left.rows.entries.collection.dropIndex(index);
      const from = f.commands.length;
      await unchangedBefore(
        () => f.left.manifestPreparer.prepare(manifest),
        'could not be acknowledged',
      );
      expect(businessWrites(from)).toEqual([]);
    },
  );
  it('denies a corrupt entry before any manifest digest or business fence is persisted', async () => {
    const { manifest, archiveId } = await f.seedManifest(input);
    await f.right.rows.entries.collection.updateOne(
      { archiveId },
      { $set: { contentHash: 'b'.repeat(64) } },
    );
    const from = f.commands.length;
    await unchangedBefore(
      () => f.left.manifestPreparer.prepare(manifest),
      'integrity',
    );
    expect(businessWrites(from)).toEqual([]);
  });
  it('rejects a supplied manifest JSON proof before any Mongo command', async () => {
    const { manifest } = await f.seedManifest(input),
      from = f.commands.length;
    await expect(
      f.left.manifestPreparer.prepare({
        ...manifest,
        manifestHash: 'a'.repeat(64),
      } as never),
    ).rejects.toThrow('Invalid');
    expect(f.commands).toHaveLength(from);
  });
  it('does not treat declared counts as a complete traversal when a sealed row is missing', async () => {
    const { manifest, archiveId } = await f.seedManifest(input);
    await f.right.rows.archives.collection.updateOne(
      { id: archiveId },
      { $set: { expectedEntryCount: 2, 'capture.entryCount': 2 } },
    );
    const inspected = await f.left.itemCapture.inspectCopyPreparation(
      manifest.selector,
    );
    const from = f.commands.length;
    await unchangedBefore(
      () =>
        f.left.manifestPreparer.prepare({
          ...manifest,
          expectedSealHash: inspected.observedSealHash,
        }),
      'integrity',
    );
    expect(businessWrites(from)).toEqual([]);
  });
  it('propagates a fault before a real manifest row query without leaving persisted progress', async () => {
    const { manifest } = await f.seedManifest(input);
    f.left.gate.fail = 'MANIFEST_ROWS';
    await unchangedBefore(
      () => f.left.manifestPreparer.prepare(manifest),
      'could not be acknowledged',
    );
  });
  it('probes the source observation slot without fences or any object reads', async () => {
    const { preparation } = await f.seedSourceObservation(input);
    const from = f.commands.length,
      before = await f.snapshot();
    expect(
      await f.left.itemCaptureStore.resumeSourceObservation(preparation),
    ).toBeNull();
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.sourceReader.calls).toEqual([]);
    expect(f.left.historicalReader.calls).toEqual([]);
    expect(await f.snapshot()).toEqual(before);
  });
  it.each([true, false])(
    'persists original source bytes with four fences in one transaction (versioned=%s)',
    async (versioned) => {
      const { preparation, file } = await f.seedSourceObservation(
        input,
        versioned,
      );
      const before = await f.snapshot(),
        from = f.commands.length;
      const start = f.left.connection.startSession.bind(f.left.connection);
      const sessions: Awaited<ReturnType<typeof start>>[] = [];
      jest
        .spyOn(f.left.connection, 'startSession')
        .mockImplementation(async (...args) => {
          const session = await start(...args);
          sessions.push(session);
          return session;
        });
      f.left.sourceReader.assertOutsideTransaction = () => {
        expect(sessions).toHaveLength(2); // Empty probe, then original context read.
        expect(sessions.every((s) => s.hasEnded)).toBe(true);
        expect(businessWrites(from)).toEqual([]);
      };
      const capture = jest.spyOn(f.left.batch, 'captureBatch');
      const receipt = await f.left.source.prepare(preparation);
      expect(receipt).toMatchObject({
        fileId: file.id,
        replayed: false,
        reservation: 'FENCED_AT_PREPARATION',
        provenance: 'NOT_ASSESSED',
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(sessions).toHaveLength(3);
      expect(sessions.every((s) => s.hasEnded)).toBe(true);
      expect(f.left.sourceReader.calls).toEqual([
        'HEAD',
        'READ',
        'CLOSE',
        'HEAD',
      ]);
      expect(f.left.sourceReader.targets).toEqual(
        Array.from({ length: 3 }, () => ({
          bucket: preparation.bucket,
          key: file.sourceKey,
        })),
      );
      const writes = businessWrites(from),
        commands = f.commands.slice(from);
      expect(writes.map((c) => c.collection)).toEqual([
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animal_ownership_controls',
        'animal_ownership_archive_files',
      ]);
      const transaction = writes[0].transaction;
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
      const stored = await f.right.rows.files
        .findOne({ id: file.id })
        .lean()
        .exec();
      expect(stored).toMatchObject({
        state: 'PENDING',
        definitionHash: file.definitionHash,
        sourceByteObservation: {
          protocol: 'ITEM_SOURCE_BYTE_OBSERVATION_V1',
          bytes: 'MATCH',
          observationHash: receipt.observationHash,
          reservation: 'OBSERVED_ONLY',
          observation: {
            key: file.sourceKey,
            revision: file.source,
            sha256: preparation.sourceSha256,
          },
        },
      });
      expect(stored?.historicalCopyIntent?.id).toBe(receipt.intentId);
      expect(stored?.historicalCopyIntent?.definitionHash).toBe(
        receipt.intentDefinitionHash,
      );
      for (const field of [
        'historicalByteObservation',
        'stagingCopyIntent',
        'leaseToken',
        'verified',
        'materialization',
      ] as const)
        expect(stored?.[field]).toBeUndefined();
      const after = await f.snapshot();
      for (const role of [
        'animals',
        'periods',
        'entries',
        'archives',
        'events',
        'notices',
        'outbox',
      ])
        expect(after[role]).toEqual(before[role]);
      expect(f.left.historicalReader.calls).toEqual([]);
      expect(capture).not.toHaveBeenCalled();
      expect(JSON.stringify(receipt)).not.toMatch(
        /bucket|sourceKey|sha256|https:|leaseToken/,
      );
    },
  );
  it('replays persisted source evidence on another client without reading objects again', async () => {
    const { preparation } = await f.seedSourceObservation(input);
    const receipt = await f.left.source.prepare(preparation);
    const files = await f.right.rows.files.find().lean().exec(),
      from = f.commands.length;
    expect(await f.right.source.prepare(preparation)).toEqual({
      ...receipt,
      replayed: true,
    });
    expect(f.right.sourceReader.calls).toEqual([]);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(businessWrites(from).map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
    ]);
  });
  it.each([
    'CAPTURE_ADMISSION',
    'ITEM',
    'CLAIM',
    'FENCE',
    'SOURCE_OBSERVATION',
  ] as const)(
    'rolls back source evidence and all four fences on %s failure',
    async (point) => {
      const { preparation } = await f.seedSourceObservation(input);
      f.left.gate.fail = point;
      await unchangedBefore(
        () => f.left.source.prepare(preparation),
        'could not be acknowledged',
      );
      const stored = await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec();
      expect(stored?.sourceByteObservation).toBeUndefined();
      expect(stored?.historicalCopyIntent).toBeDefined();
      expect(f.left.sourceReader.calls).toEqual([
        'HEAD',
        'READ',
        'CLOSE',
        'HEAD',
      ]);
    },
  );
  it('retries a competing source confirmation snapshot as exact metadata replay', async () => {
    const { preparation } = await f.seedSourceObservation(input);
    const observed = await f.left.sourceObserver.observeSource(preparation);
    const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT'); // Shared file-context query, before any fences.
    const pending = f.observe(
      f.left.itemCaptureStore.confirmSourceObservation(preparation, observed),
    );
    await pause.entered();
    const winner = await f.right.itemCaptureStore.confirmSourceObservation(
      preparation,
      observed,
    );
    const files = await f.right.rows.files.find().lean().exec();
    pause.release();
    expect(await pending).toEqual({ value: { ...winner, replayed: true } });
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(f.right.sourceReader.calls).toEqual([]);
  });
  it('permits duplicate synthetic source reads but only one immutable observation', async () => {
    const { preparation } = await f.seedSourceObservation(input);
    const pause = f.left.gate.arm('SOURCE_OBSERVED');
    const pending = f.observe(f.left.source.prepare(preparation));
    await pause.entered();
    const winner = await f.right.source.prepare(preparation);
    const files = await f.right.rows.files.find().lean().exec();
    pause.release();
    expect(await pending).toEqual({ value: { ...winner, replayed: true } });
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(f.left.sourceReader.calls).toHaveLength(4);
    expect(f.right.sourceReader.calls).toHaveLength(4);
  });
  it.each(['epoch', 'claim', 'request', 'seal'] as const)(
    'denies stale source evidence when original %s changes during synthetic I/O',
    async (kind) => {
      const { preparation, selected } = await f.seedSourceObservation(input);
      const pause = f.left.gate.arm('SOURCE_OBSERVED');
      const pending = f.observe(f.left.source.prepare(preparation));
      await pause.entered();
      // Adversarial fixture mutations, never recovery or cancellation APIs.
      if (kind === 'epoch')
        await f.right.rows.controls.collection.updateOne(
          { animalId: selected.animalId },
          { $inc: { reservationEpoch: 1 } },
        );
      if (kind === 'claim')
        await f.right.rows.claims.collection.updateOne(
          { _id: selected.animalId } as never,
          { $set: { acceptanceOperationId: id(90) } },
        );
      if (kind === 'request')
        await f.right.rows.requests.collection.updateOne(
          { _id: input.transferId } as never,
          { $inc: { version: 1 } },
        );
      if (kind === 'seal')
        await f.right.rows.archives.collection.updateOne(
          { id: selected.archiveId },
          { $inc: { 'capture.revision': 1 } },
        );
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(await f.snapshot()).toEqual(before);
      expect(
        (
          await f.right.rows.files
            .findOne({ id: preparation.fileId })
            .lean()
            .exec()
        )?.sourceByteObservation,
      ).toBeUndefined();
    },
  );
  it('aborts all source fences when reservation invalidation wins before the control write', async () => {
    const { preparation, selected } = await f.seedSourceObservation(input);
    const observation = await f.left.sourceObserver.observeSource(preparation);
    const pause = f.left.gate.arm('FENCE');
    const pending = f.observe(
      f.left.itemCaptureStore.confirmSourceObservation(
        preparation,
        observation,
      ),
    );
    await pause.entered(); // Request/item/claim are locked; the control has not been written.
    await f.right.rows.controls.collection.updateOne(
      { animalId: selected.animalId },
      { $inc: { reservationEpoch: 1 } },
    );
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toHaveProperty('error');
    expect(await f.snapshot()).toEqual(before);
  });
  it('reconciles source application reply loss after acknowledged commit without another read', async () => {
    const { preparation } = await f.seedSourceObservation(input);
    const pause = f.left.gate.arm('SOURCE_OBSERVED');
    const pending = f.observe(f.left.source.prepare(preparation));
    await pause.entered();
    f.loseNextCommitReply(f.left);
    pause.release();
    expect(await pending).toMatchObject({ error: { status: 503 } });
    const files = await f.right.rows.files.find().lean().exec();
    expect(files[0].sourceByteObservation?.bytes).toBe('MATCH');
    expect(await f.right.source.prepare(preparation)).toMatchObject({
      replayed: true,
      copyDispatch: 'NOT_AUTHORIZED',
    });
    expect(f.left.sourceReader.calls).toHaveLength(4);
    expect(f.right.sourceReader.calls).toEqual([]);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
  });
  it('retains source evidence after an application error following real session closure', async () => {
    const { preparation } = await f.seedSourceObservation(input);
    const observation = await f.left.sourceObserver.observeSource(preparation);
    const start = f.left.connection.startSession.bind(f.left.connection);
    jest
      .spyOn(f.left.connection, 'startSession')
      .mockImplementationOnce(async (...args) => {
        const session = await start(...args),
          end = session.endSession.bind(session);
        jest
          .spyOn(session, 'endSession')
          .mockImplementationOnce(async (...endArgs) => {
            await end(...endArgs);
            throw new Error(
              'Injected application error after source session close',
            );
          });
        return session;
      });
    await expect(
      f.left.itemCaptureStore.confirmSourceObservation(
        preparation,
        observation,
      ),
    ).rejects.toMatchObject({ status: 503 });
    const files = await f.right.rows.files.find().lean().exec();
    expect(files[0].sourceByteObservation).toBeDefined();
    expect(await f.right.source.prepare(preparation)).toMatchObject({
      replayed: true,
    });
    expect(f.right.sourceReader.calls).toEqual([]);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
  });
  it('keeps all source fences untouched when the synthetic conditional read fails', async () => {
    const { preparation } = await f.seedSourceObservation(input),
      from = f.commands.length;
    f.left.gate.fail = 'SOURCE_READ';
    await unchangedBefore(
      () => f.left.source.prepare(preparation),
      'bytes could not be observed',
    );
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.sourceReader.calls).toEqual(['HEAD', 'READ']);
  });
  it('rejects source digest mismatch and closes the synthetic stream without evidence writes', async () => {
    const { preparation } = await f.seedSourceObservation(input),
      from = f.commands.length;
    f.left.sourceReader.bytes = Buffer.from('animal-byteX');
    await unchangedBefore(
      () => f.left.source.prepare(preparation),
      'original manifest revision',
    );
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.sourceReader.calls).toEqual(['HEAD', 'READ', 'CLOSE']);
  });
  it.each(['etag', 'version', 'size'] as const)(
    'rejects a different source %s at initial HEAD instead of adopting a new pin',
    async (kind) => {
      const { preparation } = await f.seedSourceObservation(input),
        from = f.commands.length;
      if (kind === 'etag') f.left.sourceReader.revision.etag = 'foreign';
      if (kind === 'version')
        f.left.sourceReader.revision.versionId = 'foreign';
      if (kind === 'size') f.left.sourceReader.revision.size++;
      await unchangedBefore(
        () => f.left.source.prepare(preparation),
        'original manifest revision',
      );
      expect(businessWrites(from)).toEqual([]);
      expect(f.left.sourceReader.calls).toEqual(['HEAD']);
    },
  );
  it('rejects a changed current source after its pinned synthetic stream without repinning', async () => {
    const { preparation } = await f.seedSourceObservation(input);
    const pause = f.left.gate.arm('SOURCE_READ');
    const pending = f.observe(f.left.source.prepare(preparation));
    await pause.entered();
    const before = await f.snapshot();
    f.left.sourceReader.revision.versionId = 'later-source';
    pause.release();
    expect(await pending).toHaveProperty('error');
    expect(await f.snapshot()).toEqual(before);
    expect(f.left.sourceReader.calls).toEqual([
      'HEAD',
      'READ',
      'CLOSE',
      'HEAD',
    ]);
  });
  it.each(['null', 'hash', 'orphan', 'digest'] as const)(
    'blocks persisted %s source evidence without repair or another object read',
    async (kind) => {
      const { preparation } = await f.seedSourceObservation(input);
      await f.left.source.prepare(preparation);
      const stored = (await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec())!;
      let update: Record<string, unknown>;
      if (kind === 'null') update = { $set: { sourceByteObservation: null } };
      else if (kind === 'orphan')
        update = { $unset: { historicalCopyIntent: '' } };
      else {
        const observation = structuredClone(stored.sourceByteObservation!);
        const raw = observation as unknown as Record<string, unknown>;
        if (kind === 'hash') raw.observationHash = 'b'.repeat(64);
        else {
          (raw.observation as Record<string, unknown>).sha256 = 'b'.repeat(64);
          raw.observationHash = archiveHash(raw.observation);
        }
        update = { $set: { sourceByteObservation: observation } };
      }
      await f.right.rows.files.collection.updateOne(
        { id: preparation.fileId },
        update,
      );
      const from = f.commands.length;
      await unchangedBefore(() => f.right.source.prepare(preparation));
      await unchangedBefore(() =>
        f.right.itemCapture.prepareHistoricalCopy(preparation),
      );
      expect(businessWrites(from)).toEqual([]);
      expect(f.right.sourceReader.calls).toEqual([]);
    },
  );
  it.each(['protocol', 'key', 'revision', 'binding'] as const)(
    'refuses mismatched source collector %s even with recomputed hashes',
    async (kind) => {
      const { preparation } = await f.seedSourceObservation(input);
      const observation = structuredClone(
        await f.left.sourceObserver.observeSource(preparation),
      );
      const raw = observation as unknown as Record<string, unknown>;
      if (kind === 'protocol')
        raw.protocol = 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1';
      if (kind === 'key')
        (raw.observation as Record<string, unknown>).key = 'foreign';
      if (kind === 'revision')
        (observation.observation.revision as { etag: string }).etag = 'foreign';
      if (kind === 'binding')
        (raw.binding as Record<string, unknown>).itemId = id(90);
      raw.observationHash = archiveHash(raw.observation);
      const from = f.commands.length;
      await unchangedBefore(async () =>
        f.left.itemCaptureStore.confirmSourceObservation(
          preparation,
          observation,
        ),
      );
      expect(businessWrites(from)).toEqual([]);
    },
  );
  it.each([true, false])(
    'preserves source and historical/staging evidence in either order (sourceFirst=%s)',
    async (sourceFirst) => {
      const { preparation } = await f.seedSourceObservation(input);
      if (sourceFirst) await f.left.source.prepare(preparation);
      const staging = await f.right.staging.prepare(preparation);
      const historical = (await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec())!;
      await f.left.source.prepare(preparation);
      expect(await f.left.staging.prepare(preparation)).toEqual({
        ...staging,
        replayed: true,
      });
      const stored = (await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec())!;
      expect(stored.historicalByteObservation).toEqual(
        historical.historicalByteObservation,
      );
      expect(stored.stagingCopyIntent).toEqual(historical.stagingCopyIntent);
      expect(stored.sourceByteObservation?.observation.revision).toEqual(
        stored.source,
      );
      expect(f.left.historicalReader.calls).toEqual([]); // Staging replay cannot silently read source or history.
      expect(f.right.historicalReader.calls).toHaveLength(4);
      expect(f.left.sourceReader.calls).toHaveLength(4);
    },
  );
  it.each(['id_1', 'archiveId_1_sourceKey_1'])(
    'denies source confirmation before I/O when file uniqueness %s is absent',
    async (index) => {
      const { preparation } = await f.seedSourceObservation(input);
      await f.left.rows.files.collection.dropIndex(index);
      const from = f.commands.length;
      await unchangedBefore(
        () => f.left.source.prepare(preparation),
        'could not be acknowledged',
      );
      expect(businessWrites(from)).toEqual([]);
      expect(f.left.sourceReader.calls).toEqual([]);
    },
  );
  it('does not reconstruct an absent original historical intent for source observation', async () => {
    const { preparation } = await f.seedHistoricalCopy(input),
      from = f.commands.length;
    await unchangedBefore(
      () => f.left.source.prepare(preparation),
      'persisted historical intent',
    );
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.sourceReader.calls).toEqual([]);
  });
  it('keeps persisted source reads observational if the synthetic object changes after final HEAD', async () => {
    const { preparation, file } = await f.seedSourceObservation(input);
    const pause = f.left.gate.arm('SOURCE_OBSERVED');
    const pending = f.observe(f.left.source.prepare(preparation));
    await pause.entered(); // The final HEAD response is already captured, not remote retention.
    f.left.sourceReader.revision.versionId = 'later-source';
    pause.release();
    expect(await pending).toMatchObject({
      value: {
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      },
    });
    const stored = await f.right.rows.files
      .findOne({ id: file.id })
      .lean()
      .exec();
    expect(stored?.sourceByteObservation?.observation.revision).toEqual(
      file.source,
    );
    expect(stored?.sourceByteObservation?.reservation).toBe('OBSERVED_ONLY');
  });
  it('reads staging context and probes its evidence slot without fences or staging I/O', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const before = await f.snapshot(),
      from = f.commands.length;
    const context = await f.left.itemCaptureStore.readStagingCopy(preparation);
    expect(context.file.stagingCopyIntent?.kind).toBe('RECIPIENT_STAGING');
    expect(
      await f.left.itemCaptureStore.resumeStagingObservation(preparation),
    ).toBeNull();
    expect(await f.snapshot()).toEqual(before);
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.stagingReader.calls).toEqual([]);
  });
  it.each([true, false])(
    'commits observed staging bytes with four original fences (versioned=%s)',
    async (versioned) => {
      const { preparation, file } = await f.seedStagingObservation(
        input,
        versioned,
      );
      const before = await f.snapshot(),
        from = f.commands.length;
      const historyCalls = f.left.historicalReader.calls.length;
      const start = f.left.connection.startSession.bind(f.left.connection);
      const sessions: Awaited<ReturnType<typeof start>>[] = [];
      jest
        .spyOn(f.left.connection, 'startSession')
        .mockImplementation(async (...args) => {
          const session = await start(...args);
          sessions.push(session);
          return session;
        });
      f.left.stagingReader.assertOutsideTransaction = () => {
        expect(sessions).toHaveLength(2); // Empty probe and the staging-context read have closed.
        expect(sessions.every((s) => s.hasEnded)).toBe(true);
        expect(businessWrites(from)).toEqual([]);
      };
      const capture = jest.spyOn(f.left.batch, 'captureBatch');
      const receipt = await f.left.staging.prepareObservation(preparation);
      expect(receipt).toMatchObject({
        replayed: false,
        fileId: file.id,
        reservation: 'FENCED_AT_PREPARATION',
        provenance: 'NOT_ASSESSED',
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(sessions).toHaveLength(3);
      expect(sessions.every((s) => s.hasEnded)).toBe(true);
      expect(f.left.stagingReader.calls).toEqual([
        'HEAD',
        'READ',
        'CLOSE',
        'HEAD',
      ]);
      expect(f.left.stagingReader.targets).toEqual(
        Array.from({ length: 3 }, () => ({
          bucket: preparation.bucket,
          key: file.recipientStagingKey,
        })),
      );
      expect(f.left.historicalReader.calls).toHaveLength(historyCalls);
      expect(f.left.sourceReader.calls).toEqual([]);
      const writes = businessWrites(from),
        commands = f.commands.slice(from);
      expect(writes.map((c) => c.collection)).toEqual([
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animal_ownership_controls',
        'animal_ownership_archive_files',
      ]);
      const transaction = writes[0].transaction;
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
      const stored = (await f.right.rows.files
        .findOne({ id: file.id })
        .lean()
        .exec())!;
      expect(stored.stagingByteObservation).toMatchObject({
        protocol: 'ITEM_STAGING_BYTE_OBSERVATION_V1',
        observationHash: receipt.observationHash,
        bytes: 'MATCH',
        reservation: 'OBSERVED_ONLY',
        observation: {
          key: file.recipientStagingKey,
          intentId: receipt.intentId,
          intentDefinitionHash: receipt.intentDefinitionHash,
          revision: f.left.stagingReader.revision,
          sha256: preparation.sourceSha256,
        },
      });
      expect(stored.stagingCopyIntent?.id).toBe(receipt.intentId);
      const { stagingByteObservation, ...unchanged } = stored;
      void stagingByteObservation;
      expect(unchanged).toEqual((before.files as unknown[])[0]);
      const after = await f.snapshot();
      for (const role of [
        'animals',
        'periods',
        'entries',
        'archives',
        'events',
        'notices',
        'outbox',
      ])
        expect(after[role]).toEqual(before[role]);
      expect(capture).not.toHaveBeenCalled();
      expect(JSON.stringify(receipt)).not.toMatch(
        /bucket|sourceKey|sha256|https:|leaseToken/,
      );
    },
  );
  it('replays staging byte evidence on the other client without object reads or replacement', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const first = await f.left.staging.prepareObservation(preparation);
    const files = await f.right.rows.files.find().lean().exec(),
      from = f.commands.length;
    expect(await f.right.staging.prepareObservation(preparation)).toEqual({
      ...first,
      replayed: true,
    });
    expect(f.right.stagingReader.calls).toEqual([]);
    expect(f.right.historicalReader.calls).toEqual([]);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(businessWrites(from).map((c) => c.collection)).toEqual([
      'animal_transfers',
      'animal_transfer_items',
      'animal_transfer_active_items',
      'animal_ownership_controls',
    ]);
  });
  it.each([
    'CAPTURE_ADMISSION',
    'ITEM',
    'CLAIM',
    'FENCE',
    'STAGING_OBSERVATION',
  ] as const)(
    'rolls back staging bytes and all four fences on %s failure',
    async (point) => {
      const { preparation } = await f.seedStagingObservation(input);
      f.left.gate.fail = point;
      await unchangedBefore(
        () => f.left.staging.prepareObservation(preparation),
        'could not be acknowledged',
      );
      const stored = await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec();
      expect(stored?.stagingByteObservation).toBeUndefined();
      expect(stored?.stagingCopyIntent).toBeDefined();
      expect(f.left.stagingReader.calls).toEqual([
        'HEAD',
        'READ',
        'CLOSE',
        'HEAD',
      ]);
    },
  );
  it('retries a staging confirmation snapshot as replay of the same observed revision', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const observed = await f.left.stagingObserver.observeStaging(preparation);
    const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT'); // Shared file query after the snapshot was established.
    const pending = f.observe(
      f.left.itemCaptureStore.confirmStagingObservation(preparation, observed),
    );
    await pause.entered();
    const winner = await f.right.itemCaptureStore.confirmStagingObservation(
      preparation,
      observed,
    );
    const files = await f.right.rows.files.find().lean().exec();
    pause.release();
    expect(await pending).toEqual({ value: { ...winner, replayed: true } });
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(f.right.stagingReader.calls).toEqual([]);
  });
  it('denies a competing staging revision after retry instead of replacing the winner', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const left = await f.left.stagingObserver.observeStaging(preparation);
    f.right.stagingReader.revision.versionId = 'synthetic-staging-v2';
    const right = await f.right.stagingObserver.observeStaging(preparation);
    const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT');
    const pending = f.observe(
      f.left.itemCaptureStore.confirmStagingObservation(preparation, left),
    );
    await pause.entered();
    await f.right.itemCaptureStore.confirmStagingObservation(
      preparation,
      right,
    );
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toMatchObject({
      error: { message: 'The staging byte observation cannot be replaced' },
    });
    expect(await f.snapshot()).toEqual(before);
  });
  it('allows duplicate staging reads but records only one immutable observation', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const pause = f.left.gate.arm('STAGING_OBSERVED');
    const pending = f.observe(f.left.staging.prepareObservation(preparation));
    await pause.entered();
    const winner = await f.right.staging.prepareObservation(preparation);
    const files = await f.right.rows.files.find().lean().exec();
    pause.release();
    expect(await pending).toEqual({ value: { ...winner, replayed: true } });
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
    expect(f.left.stagingReader.calls).toHaveLength(4);
    expect(f.right.stagingReader.calls).toHaveLength(4);
  });
  it.each(['epoch', 'claim', 'request', 'seal', 'history', 'intent'] as const)(
    'refuses stale staging evidence when original %s changes during synthetic I/O',
    async (kind) => {
      const { preparation, selected } = await f.seedStagingObservation(input);
      const pause = f.left.gate.arm('STAGING_OBSERVED');
      const pending = f.observe(f.left.staging.prepareObservation(preparation));
      await pause.entered();
      // Adversarial mutations only inside the owned fixture, never recovery/cancellation APIs.
      if (kind === 'epoch')
        await f.right.rows.controls.collection.updateOne(
          { animalId: selected.animalId },
          { $inc: { reservationEpoch: 1 } },
        );
      if (kind === 'claim')
        await f.right.rows.claims.collection.updateOne(
          { _id: selected.animalId } as never,
          { $set: { acceptanceOperationId: id(90) } },
        );
      if (kind === 'request')
        await f.right.rows.requests.collection.updateOne(
          { _id: input.transferId } as never,
          { $inc: { version: 1 } },
        );
      if (kind === 'seal')
        await f.right.rows.archives.collection.updateOne(
          { id: selected.archiveId },
          { $inc: { 'capture.revision': 1 } },
        );
      if (kind === 'history')
        await f.right.rows.files.collection.updateOne(
          { id: preparation.fileId },
          { $set: { historicalByteObservation: {} } } as never,
        );
      if (kind === 'intent')
        await f.right.rows.files.collection.updateOne(
          { id: preparation.fileId },
          { $set: { stagingCopyIntent: {} } } as never,
        );
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(await f.snapshot()).toEqual(before);
      expect(
        (
          await f.right.rows.files
            .findOne({ id: preparation.fileId })
            .lean()
            .exec()
        )?.stagingByteObservation,
      ).toBeUndefined();
    },
  );
  it('aborts all staging fences if reservation invalidation wins before the control write', async () => {
    const { preparation, selected } = await f.seedStagingObservation(input);
    const observed = await f.left.stagingObserver.observeStaging(preparation);
    const pause = f.left.gate.arm('FENCE');
    const pending = f.observe(
      f.left.itemCaptureStore.confirmStagingObservation(preparation, observed),
    );
    await pause.entered();
    await f.right.rows.controls.collection.updateOne(
      { animalId: selected.animalId },
      { $inc: { reservationEpoch: 1 } },
    );
    const before = await f.snapshot();
    pause.release();
    expect(await pending).toHaveProperty('error');
    expect(await f.snapshot()).toEqual(before);
  });
  it('reconciles staging application reply loss after acknowledged commit without another read', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const pause = f.left.gate.arm('STAGING_OBSERVED');
    const pending = f.observe(f.left.staging.prepareObservation(preparation));
    await pause.entered();
    f.loseNextCommitReply(f.left);
    pause.release();
    expect(await pending).toMatchObject({ error: { status: 503 } });
    const files = await f.right.rows.files.find().lean().exec();
    expect(files[0].stagingByteObservation?.bytes).toBe('MATCH');
    expect(await f.right.staging.prepareObservation(preparation)).toMatchObject(
      { replayed: true, copyDispatch: 'NOT_AUTHORIZED' },
    );
    expect(f.right.stagingReader.calls).toEqual([]);
    expect(f.left.stagingReader.calls).toHaveLength(4);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
  });
  it('preserves staging evidence after an application error following actual session close', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const observed = await f.left.stagingObserver.observeStaging(preparation);
    const start = f.left.connection.startSession.bind(f.left.connection);
    jest
      .spyOn(f.left.connection, 'startSession')
      .mockImplementationOnce(async (...args) => {
        const session = await start(...args),
          end = session.endSession.bind(session);
        jest
          .spyOn(session, 'endSession')
          .mockImplementationOnce(async (...endArgs) => {
            await end(...endArgs);
            throw new Error(
              'Injected application error after staging session close',
            );
          });
        return session;
      });
    await expect(
      f.left.itemCaptureStore.confirmStagingObservation(preparation, observed),
    ).rejects.toMatchObject({ status: 503 });
    const files = await f.right.rows.files.find().lean().exec();
    expect(files[0].stagingByteObservation).toBeDefined();
    expect(await f.right.staging.prepareObservation(preparation)).toMatchObject(
      { replayed: true },
    );
    expect(f.right.stagingReader.calls).toEqual([]);
    expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
  });
  it('keeps staging metadata and fences untouched when its synthetic reader fails', async () => {
    const { preparation } = await f.seedStagingObservation(input),
      from = f.commands.length;
    f.left.gate.fail = 'STAGING_READ';
    await unchangedBefore(
      () => f.left.staging.prepareObservation(preparation),
      'bytes could not be observed',
    );
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.stagingReader.calls).toEqual(['HEAD', 'READ']);
  });
  it('closes a mismatching synthetic staging stream without persisting evidence', async () => {
    const { preparation } = await f.seedStagingObservation(input),
      from = f.commands.length;
    f.left.stagingReader.bytes = Buffer.from('animal-byteX');
    await unchangedBefore(
      () => f.left.staging.prepareObservation(preparation),
      'does not match',
    );
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.stagingReader.calls).toEqual(['HEAD', 'READ', 'CLOSE']);
  });
  it('rejects a staging revision changed after its pinned synthetic stream', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const pause = f.left.gate.arm('STAGING_READ');
    const pending = f.observe(f.left.staging.prepareObservation(preparation));
    await pause.entered();
    const before = await f.snapshot();
    f.left.stagingReader.revision.versionId = 'synthetic-staging-v2';
    pause.release();
    expect(await pending).toHaveProperty('error');
    expect(await f.snapshot()).toEqual(before);
    expect(f.left.stagingReader.calls).toEqual([
      'HEAD',
      'READ',
      'CLOSE',
      'HEAD',
    ]);
  });
  it.each([
    'missingHistory',
    'missingStaging',
    'corruptHistory',
    'corruptStaging',
    'predecessorHash',
    'missingHistoricalIntent',
  ] as const)(
    'blocks a %s predecessor chain before any staging I/O or fences',
    async (kind) => {
      const { preparation } = await f.seedStagingObservation(input);
      const stored = (await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec())!;
      let update: Record<string, unknown>;
      if (kind === 'missingHistory')
        update = { $unset: { historicalByteObservation: '' } };
      else if (kind === 'missingStaging')
        update = { $unset: { stagingCopyIntent: '' } };
      else if (kind === 'corruptHistory')
        update = { $set: { historicalByteObservation: null } };
      else if (kind === 'corruptStaging')
        update = { $set: { stagingCopyIntent: {} } };
      else if (kind === 'missingHistoricalIntent')
        update = { $unset: { historicalCopyIntent: '' } };
      else {
        const intent = structuredClone(stored.stagingCopyIntent!);
        (intent.predecessor as { observationHash: string }).observationHash =
          'b'.repeat(64);
        update = { $set: { stagingCopyIntent: intent } };
      }
      await f.right.rows.files.collection.updateOne(
        { id: preparation.fileId },
        update,
      );
      const from = f.commands.length;
      await unchangedBefore(() =>
        f.left.staging.prepareObservation(preparation),
      );
      await unchangedBefore(() =>
        f.left.stagingObserver.observeStaging(preparation),
      );
      expect(businessWrites(from)).toEqual([]);
      expect(f.left.stagingReader.calls).toEqual([]);
    },
  );
  it.each(['null', 'hash', 'orphan'] as const)(
    'blocks persisted %s staging byte evidence without repairing it',
    async (kind) => {
      const { preparation } = await f.seedStagingObservation(input);
      await f.left.staging.prepareObservation(preparation);
      const stored = (await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec())!;
      let update: Record<string, unknown>;
      if (kind === 'null') update = { $set: { stagingByteObservation: null } };
      else if (kind === 'orphan')
        update = {
          $unset: { stagingCopyIntent: '', historicalByteObservation: '' },
        };
      else {
        const observed = structuredClone(stored.stagingByteObservation!);
        (observed as unknown as { observationHash: string }).observationHash =
          'b'.repeat(64);
        update = { $set: { stagingByteObservation: observed } };
      }
      await f.right.rows.files.collection.updateOne(
        { id: preparation.fileId },
        update,
      );
      const from = f.commands.length;
      await unchangedBefore(() =>
        f.right.staging.prepareObservation(preparation),
      );
      await unchangedBefore(() =>
        f.right.itemCapture.prepareHistoricalCopy(preparation),
      );
      expect(businessWrites(from)).toEqual([]);
      expect(f.right.stagingReader.calls).toEqual([]);
    },
  );
  it.each([
    'binding',
    'hash',
    'key',
    'size',
    'protocol',
    'permission',
  ] as const)(
    'rejects a mismatched staging collector %s despite recomputed observation hashes',
    async (kind) => {
      const { preparation } = await f.seedStagingObservation(input);
      const observed = structuredClone(
        await f.left.stagingObserver.observeStaging(preparation),
      );
      const raw = observed as unknown as Record<string, unknown>,
        payload = raw.observation as Record<string, unknown>;
      if (kind === 'binding')
        (raw.binding as Record<string, unknown>).itemId = id(90);
      if (kind === 'hash') raw.observationHash = 'b'.repeat(64);
      if (kind === 'key') payload.key = 'foreign';
      if (kind === 'size')
        (payload.revision as Record<string, unknown>).size = 13;
      if (kind === 'protocol')
        raw.protocol = 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1';
      if (kind === 'permission') raw.copyDispatch = 'AUTHORIZED';
      if (kind !== 'hash') raw.observationHash = archiveHash(payload);
      const from = f.commands.length;
      await unchangedBefore(async () =>
        f.left.itemCaptureStore.confirmStagingObservation(
          preparation,
          observed,
        ),
      );
      expect(businessWrites(from)).toEqual([]);
    },
  );
  it.each([true, false])(
    'keeps source/history/staging evidence and manifest integrity independent (sourceFirst=%s)',
    async (sourceFirst) => {
      const { preparation } = await f.seedStagingObservation(input);
      const digestInput = {
        selector: preparation.selector,
        expectedSealHash: preparation.expectedSealHash,
      };
      const digest = await f.left.manifestPreparer.prepare(digestInput);
      if (sourceFirst) await f.left.source.prepare(preparation);
      const staging = await f.left.staging.prepareObservation(preparation);
      const before = (await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec())!;
      await f.right.source.prepare(preparation);
      expect(await f.right.staging.prepareObservation(preparation)).toEqual({
        ...staging,
        replayed: true,
      });
      const after = (await f.right.rows.files
        .findOne({ id: preparation.fileId })
        .lean()
        .exec())!;
      expect(after.historicalByteObservation).toEqual(
        before.historicalByteObservation,
      );
      expect(after.stagingCopyIntent).toEqual(before.stagingCopyIntent);
      expect(after.stagingByteObservation).toEqual(
        before.stagingByteObservation,
      );
      expect(after.sourceByteObservation).toBeDefined();
      expect(
        (await f.right.manifestObserver.observe(digestInput)).manifestHash,
      ).toBe(digest.manifestHash);
      expect(await f.right.manifestPreparer.prepare(digestInput)).toEqual({
        ...digest,
        replayed: true,
      });
      expect(f.right.historicalReader.calls).toEqual([]);
      expect(f.right.stagingReader.calls).toEqual([]);
    },
  );
  it.each(['id_1', 'archiveId_1_sourceKey_1'])(
    'refuses staging observation before I/O when file uniqueness %s is absent',
    async (index) => {
      const { preparation } = await f.seedStagingObservation(input);
      await f.left.rows.files.collection.dropIndex(index);
      const from = f.commands.length;
      await unchangedBefore(
        () => f.left.staging.prepareObservation(preparation),
        'could not be acknowledged',
      );
      expect(businessWrites(from)).toEqual([]);
      expect(f.left.stagingReader.calls).toEqual([]);
    },
  );
  it('retains NOT_ASSESSED when staging changes after the final observed HEAD', async () => {
    const { preparation } = await f.seedStagingObservation(input);
    const revision = { ...f.left.stagingReader.revision };
    const pause = f.left.gate.arm('STAGING_OBSERVED');
    const pending = f.observe(f.left.staging.prepareObservation(preparation));
    await pause.entered();
    f.left.stagingReader.revision.versionId = 'later-staging';
    pause.release();
    expect(await pending).toMatchObject({
      value: {
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      },
    });
    const stored = await f.right.rows.files
      .findOne({ id: preparation.fileId })
      .lean()
      .exec();
    expect(stored?.stagingByteObservation?.observation.revision).toEqual(
      revision,
    );
    expect(stored?.stagingByteObservation?.reservation).toBe('OBSERVED_ONLY');
  });
  it('rejects staging MATCH input before a transaction or synthetic read starts', async () => {
    const { preparation } = await f.seedStagingObservation(input),
      from = f.commands.length;
    await unchangedBefore(
      () =>
        f.left.staging.prepareObservation({
          ...preparation,
          observation: { bytes: 'MATCH' },
        } as never),
      'Invalid',
    );
    expect(businessWrites(from)).toEqual([]);
    expect(f.left.stagingReader.calls).toEqual([]);
  });
  describe('copy gates and initial attempts', () => {
    function revoke(selector: ItemCaptureInput, expectedGateRevision?: number) {
      return {
        selector,
        requestId: id(902),
        evidenceRef: 'test:copy-gate-revocation',
        expectedGateRevision,
      };
    }
    async function prepareCopy(
      kind: ItemCopyDeclarationInput['kind'] = 'HISTORICAL',
    ) {
      const seeded = await f.seedStagingCopy(input);
      if (kind === 'RECIPIENT_STAGING')
        await f.left.staging.prepare(seeded.preparation);
      const declaration: ItemCopyDeclarationInput = {
        preparation: seeded.preparation,
        kind,
        attemptId: id(900),
        dispatcherInstanceId: id(901),
        origin: 'INITIAL',
        expectedGateRevision: 0,
      };
      return { ...seeded, declaration, selector: seeded.preparation.selector };
    }
    async function openCopy(kind?: ItemCopyDeclarationInput['kind']) {
      const prepared = await prepareCopy(kind);
      const opened = await f.left.itemCaptureStore.openCopyGate(
        prepared.selector,
      );
      return { ...prepared, opened };
    }
    function expectRecordTransaction(from: number, recordCommands: string[]) {
      const writes = businessWrites(from);
      expect(writes.map((c) => [c.command, c.collection])).toEqual([
        ['update', 'animal_transfers'],
        ['update', 'animal_transfer_items'],
        ['update', 'animal_transfer_active_items'],
        ['update', 'animal_ownership_controls'],
        ...recordCommands.map((command) => [
          command,
          ITEM_COPY_RECORD_COLLECTION,
        ]),
      ]);
      const transaction = writes[0].transaction;
      expect(transaction).toBeDefined();
      expect(writes.every((c) => c.transaction === transaction)).toBe(true);
      expect(f.commands.slice(from)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ transaction, snapshot: true }),
          expect.objectContaining({
            transaction,
            command: 'commitTransaction',
            majority: true,
          }),
        ]),
      );
    }

    describe('historical source delegation bound persistence', () => {
      async function setupBound() {
        const t = await openCopy();
        const declared = await f.left.itemCaptureStore.declareCopyAttempt(
          t.declaration,
        );
        const pins = {
          preparation: t.preparation,
          attemptId: t.declaration.attemptId,
          expectedAttemptDefinitionHash: declared.attemptDefinitionHash!,
          expectedGateRevision: declared.gateRevision,
          signerContextHash: 'b'.repeat(64),
        };
        const row = await f.right.rows.copyRecords
          .findOne({ id: pins.attemptId })
          .lean()
          .exec();
        if (row?.row !== 'ATTEMPT')
          throw new Error('Missing intended attempt fixture');
        const bound = buildItemSourceDelegationBound(
          {
            basis: 'ACCREDITED_LAST_SOURCE_READ',
            attemptDefinitionHash: pins.expectedAttemptDefinitionHash,
            signerContextHash: pins.signerContextHash,
            evidenceHash: 'c'.repeat(64),
            delegateBefore: '2026-11-07T15:20:00.000Z',
            lastReadAt: '2026-11-07T15:30:00.000Z',
            marginMs: 60_000,
          },
          row.definition,
          pins.signerContextHash,
        );
        return {
          ...t,
          pins,
          row,
          bound,
          record: (side = f.left, selection = pins, value = bound) =>
            side.itemCaptureStore.recordSourceDelegationBound(selection, value),
          read: (selection = pins) =>
            f.right.itemCaptureStore.readSourceDelegationBound(selection),
        };
      }

      it('stores the first bound and advances the gate with the four original fences', async () => {
        const t = await setupBound();
        const before = await f.snapshot(),
          fromRead = f.commands.length;
        await expect(t.read()).resolves.toBeNull();
        expect(businessWrites(fromRead)).toEqual([]);
        const from = f.commands.length;
        const receipt = await t.record();
        expectRecordTransaction(from, ['update', 'update']);
        expect(receipt).toEqual({
          bound: t.bound,
          gateRevision: t.pins.expectedGateRevision + 1,
          replayed: false,
          copyDispatch: 'NOT_AUTHORIZED',
          businessCommit: 'NOT_AUTHORIZED',
        });
        const saved = await f.snapshot();
        expect(saved.copyRecords).toEqual(
          (before.copyRecords as Array<{ id: string }>).map((row) =>
            row.id === t.pins.attemptId
              ? { ...row, delegationBound: t.bound }
              : { ...row, revision: receipt.gateRevision },
          ),
        );
        for (const role of ['archives', 'files', 'periods', 'animals'])
          expect(saved[role]).toEqual(before[role]);

        const current = {
          ...t.pins,
          expectedGateRevision: receipt.gateRevision,
        };
        const fromReplay = f.commands.length;
        await expect(t.read(current)).resolves.toEqual({
          ...receipt,
          replayed: true,
        });
        await expect(t.record(f.right, current)).resolves.toEqual({
          ...receipt,
          replayed: true,
        });
        expect(businessWrites(fromReplay)).toEqual([]);
        expect(await f.snapshot()).toEqual(saved);
        await expect(
          f.right.itemCaptureStore.declareCopyAttempt({
            ...t.declaration,
            expectedGateRevision: receipt.gateRevision,
          }),
        ).resolves.toMatchObject({
          replayed: true,
          attemptDefinitionHash: t.pins.expectedAttemptDefinitionHash,
        });
        expect(
          await f.right.rows.copyRecords
            .findOne({ id: t.pins.attemptId })
            .lean()
            .exec(),
        ).toEqual({
          ...t.row,
          delegationBound: t.bound,
        });
        for (const side of [f.left, f.right]) {
          expect(side.historicalReader.calls).toEqual([]);
          expect(side.sourceReader.calls).toEqual([]);
          expect(side.stagingReader.calls).toEqual([]);
        }
      });

      it.each([
        'CAPTURE_ADMISSION',
        'ITEM',
        'CLAIM',
        'FENCE',
        'COPY_GATE_CAS',
        'COPY_DELEGATION_BOUND_WRITE',
      ] as const)('rolls back every write when %s fails', async (point) => {
        const t = await setupBound();
        const from = f.commands.length;
        f.left.gate.fail = point;
        await unchangedBefore(() => t.record(), 'could not be acknowledged');
        expect(f.commands.slice(from)).toContainEqual(
          expect.objectContaining({
            side: 'left',
            command: 'abortTransaction',
          }),
        );
        await expect(t.read()).resolves.toBeNull();
      });

      it.each(['same', 'different'] as const)(
        'preserves the first bound when a concurrent client submits %s facts',
        async (kind) => {
          const t = await setupBound();
          const { protocol, boundHash, ...facts } = t.bound;
          const candidate =
            kind === 'same'
              ? t.bound
              : buildItemSourceDelegationBound(
                  { ...facts, marginMs: 30_000 },
                  t.row.definition,
                  t.pins.signerContextHash,
                );
          expect(candidate.protocol).toBe(protocol);
          expect(candidate.boundHash === boundHash).toBe(kind === 'same');
          const pause = f.left.gate.arm('CAPTURE_ADMISSION');
          const pending = f.observe(t.record(f.left, t.pins, candidate));
          await pause.entered();
          const winner = await t.record(f.right);
          const saved = await f.snapshot();
          pause.release();
          expect(await pending).toHaveProperty(
            'error.message',
            'The expected copy gate revision changed',
          );
          const from = f.commands.length;
          const current = {
            ...t.pins,
            expectedGateRevision: winner.gateRevision,
          };
          const replay = t.record(f.left, current, candidate);
          if (kind === 'same')
            await expect(replay).resolves.toEqual({
              ...winner,
              replayed: true,
            });
          else await expect(replay).rejects.toThrow('cannot be replaced');
          expect(businessWrites(from)).toEqual([]);
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      it('rejects a paused registration when revocation wins', async () => {
        const t = await setupBound();
        const pause = f.left.gate.arm('CAPTURE_ADMISSION');
        const pending = f.observe(t.record());
        await pause.entered();
        const revoked = await f.right.itemCaptureStore.revokeCopyGate(
          revoke(t.selector, t.pins.expectedGateRevision),
        );
        const saved = await f.snapshot();
        pause.release();
        expect(await pending).toHaveProperty(
          'error.message',
          'An original open copy gate is required',
        );
        await expect(
          t.read({ ...t.pins, expectedGateRevision: revoked.gateRevision }),
        ).rejects.toThrow('open copy gate');
        expect(await f.snapshot()).toEqual(saved);
      });

      it('requires revocation to refresh after registration wins, and retains the recorded bound', async () => {
        const t = await setupBound();
        const pause = f.left.gate.arm('CAPTURE_ADMISSION');
        const pending = f.observe(
          f.left.itemCaptureStore.revokeCopyGate(
            revoke(t.selector, t.pins.expectedGateRevision),
          ),
        );
        await pause.entered();
        const winner = await t.record(f.right);
        const saved = await f.snapshot();
        pause.release();
        expect(await pending).toHaveProperty(
          'error.message',
          'The expected copy gate revision changed',
        );
        expect(await f.snapshot()).toEqual(saved);
        const revoked = await f.right.itemCaptureStore.revokeCopyGate(
          revoke(t.selector, winner.gateRevision),
        );
        expect(revoked).toMatchObject({
          state: 'REVOKED',
          copyDispatch: 'NOT_AUTHORIZED',
        });
        expect(
          await f.right.rows.copyRecords
            .findOne({ id: t.pins.attemptId })
            .lean()
            .exec(),
        ).toEqual({
          ...t.row,
          delegationBound: t.bound,
        });
      });

      it('rolls back when the original reservation changes before the control fence', async () => {
        const t = await setupBound();
        const pause = f.left.gate.arm('FENCE');
        const pending = f.observe(t.record());
        await pause.entered();
        const changed = await f.right.rows.controls.collection.updateOne(
          { animalId: t.selected.animalId },
          { $inc: { reservationEpoch: 1 } },
        );
        expect(changed.modifiedCount).toBe(1);
        const saved = await f.snapshot();
        pause.release();
        expect(await pending).toHaveProperty('error');
        await expect(t.read()).rejects.toThrow();
        expect(await f.snapshot()).toEqual(saved);
      });

      it('recovers a lost response after the acknowledged native commit', async () => {
        const t = await setupBound();
        const from = f.commands.length;
        f.loseNextCommitReply(f.left);
        await expect(t.record()).rejects.toMatchObject({ status: 503 });
        expectRecordTransaction(from, ['update', 'update']);
        await expect(t.read()).rejects.toThrow('revision changed');
        const gate = await f.right.itemCaptureStore.readCopyGate(t.selector);
        const current = { ...t.pins, expectedGateRevision: gate!.revision };
        const saved = await f.snapshot(),
          fromReplay = f.commands.length;
        const receipt = await t.read(current);
        expect(receipt).toMatchObject({
          bound: t.bound,
          replayed: true,
          copyDispatch: 'NOT_AUTHORIZED',
        });
        await expect(t.record(f.right, current)).resolves.toEqual(receipt);
        expect(businessWrites(fromReplay)).toEqual([]);
        expect(await f.snapshot()).toEqual(saved);
      });

      it.each(['corrupt bound', 'wrong signer', 'missing attempt'] as const)(
        'rejects %s without writing or replacing metadata',
        async (kind) => {
          const t = await setupBound();
          const receipt = await t.record();
          const current = {
            ...t.pins,
            expectedGateRevision: receipt.gateRevision,
          };
          const rows = f.right.rows.copyRecords.collection;
          if (kind === 'wrong signer')
            current.signerContextHash = '0'.repeat(64);
          if (kind === 'corrupt bound') {
            const changed = await rows.updateOne(
              { id: t.pins.attemptId },
              { $set: { 'delegationBound.boundHash': '0'.repeat(64) } },
            );
            expect(changed.modifiedCount).toBe(1);
          }
          if (kind === 'missing attempt') {
            const removed = await rows.deleteOne({ id: t.pins.attemptId });
            expect(removed.deletedCount).toBe(1);
          }
          const from = f.commands.length;
          await unchangedBefore(() => t.read(current));
          await unchangedBefore(() => t.record(f.right, current));
          expect(businessWrites(from)).toEqual([]);
        },
      );
    });

    it('reads gates without writes and opens one with the four original fences', async () => {
      const {
        preparation: { selector },
      } = await f.seedHistoricalCopy(input);
      const before = await f.snapshot(),
        from = f.commands.length;
      expect(await f.right.itemCaptureStore.readCopyGate(selector)).toBeNull();
      expect(businessWrites(from)).toEqual([]);
      expect(await f.snapshot()).toEqual(before);

      const opened = await f.left.itemCaptureStore.openCopyGate(selector);
      expectRecordTransaction(from, ['insert']);
      expect(opened).toMatchObject({
        state: 'OPEN',
        gateRevision: 0,
        replayed: false,
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      const after = f.commands.length;
      expect(
        await f.right.itemCaptureStore.readCopyGate(selector),
      ).toMatchObject({
        id: opened.gateId,
        revision: 0,
        state: 'OPEN',
        identityIds: [opened.gateId],
      });
      expect(businessWrites(after)).toEqual([]);
    });

    it.each(['HISTORICAL', 'RECIPIENT_STAGING'] as const)(
      'persists the %s INITIAL declaration atomically with its gate revision',
      async (kind) => {
        const { declaration, opened } = await openCopy(kind);
        const files = await f.right.rows.files.find().lean().exec();
        const reads = [...f.left.historicalReader.calls],
          from = f.commands.length;
        const receipt =
          await f.left.itemCaptureStore.declareCopyAttempt(declaration);
        expectRecordTransaction(from, ['update', 'insert']);
        expect(receipt).toMatchObject({
          gateId: opened.gateId,
          gateRevision: 1,
          attemptId: declaration.attemptId,
          replayed: false,
          stableCut: 'NOT_ASSESSED',
          retention: 'NOT_ASSESSED',
          copyDispatch: 'NOT_AUTHORIZED',
          businessCommit: 'NOT_AUTHORIZED',
        });
        const row = await f.right.rows.copyRecords
          .findOne({ id: declaration.attemptId })
          .lean()
          .exec();
        expect(row).toMatchObject({
          row: 'ATTEMPT',
          state: 'INTENDED',
          gateId: opened.gateId,
          ordinal: 1,
          identityIds: [declaration.attemptId],
          definition: {
            definitionHash: receipt.attemptDefinitionHash,
            kind,
            origin: 'INITIAL',
          },
        });
        expect(row).not.toHaveProperty('authorizationId');
        expect(await f.right.rows.files.find().lean().exec()).toEqual(files);
        expect(f.left.historicalReader.calls).toEqual(reads);
        expect(f.left.stagingReader.calls).toEqual([]);
      },
    );

    it('uses a single gate for distinct files of the original item', async () => {
      const { files, manifest } = await f.seedManifest(input, 2);
      expect(files).toHaveLength(2);
      const { selector, expectedSealHash } = manifest;
      const opened = await f.left.itemCaptureStore.openCopyGate(selector);
      for (const [n, file] of files.entries()) {
        const preparation = {
          selector,
          expectedSealHash,
          fileId: file.id,
          expectedFileDefinitionHash: file.definitionHash,
          bucket: 'synthetic-archive-bucket',
          sourceSha256: 'a'.repeat(64),
        };
        await f.left.itemCapture.prepareHistoricalCopy(preparation);
        expect(
          await f.right.itemCaptureStore.declareCopyAttempt({
            preparation,
            kind: 'HISTORICAL',
            origin: 'INITIAL',
            attemptId: id(900 + n),
            dispatcherInstanceId: id(910),
            expectedGateRevision: n,
          }),
        ).toMatchObject({ gateId: opened.gateId, gateRevision: n + 1 });
      }
      expect(
        await f.right.rows.copyRecords.countDocuments({ row: 'GATE' }),
      ).toBe(1);
      expect(
        await f.right.rows.copyRecords.countDocuments({ row: 'ATTEMPT' }),
      ).toBe(2);
    });

    it('rejects stale and changed declarations before replaying the identical attempt with a fresh revision', async () => {
      const { selector, declaration } = await openCopy();
      const first =
        await f.left.itemCaptureStore.declareCopyAttempt(declaration);
      const records = await f.right.rows.copyRecords
        .find({ row: 'ATTEMPT' })
        .lean()
        .exec();
      await unchangedBefore(
        () => f.right.itemCaptureStore.declareCopyAttempt(declaration),
        'gate revision changed',
      );
      const gate = await f.right.itemCaptureStore.readCopyGate(selector);
      const fresh = { ...declaration, expectedGateRevision: gate!.revision };
      await unchangedBefore(
        () =>
          f.right.itemCaptureStore.declareCopyAttempt({
            ...fresh,
            dispatcherInstanceId: id(910),
          }),
        'record identity',
      );
      const from = f.commands.length;
      expect(await f.right.itemCaptureStore.declareCopyAttempt(fresh)).toEqual({
        ...first,
        gateRevision: 2,
        replayed: true,
      });
      expectRecordTransaction(from, ['update']);
      expect(
        await f.right.rows.copyRecords.find({ row: 'ATTEMPT' }).lean().exec(),
      ).toEqual(records);
      await unchangedBefore(
        () =>
          f.left.itemCaptureStore.declareCopyAttempt({
            ...fresh,
            attemptId: id(915),
            expectedGateRevision: 2,
          }),
        'already has its initial attempt',
      );
    });

    it('keeps an early revocation permanent and preserves its first audit reference', async () => {
      const { selector, declaration } = await prepareCopy();
      const from = f.commands.length;
      const revoked = await f.left.itemCaptureStore.revokeCopyGate(
        revoke(selector),
      );
      expectRecordTransaction(from, ['insert']);
      expect(revoked).toMatchObject({
        state: 'REVOKED',
        gateRevision: 0,
        replayed: false,
      });
      await unchangedBefore(
        () => f.right.itemCaptureStore.openCopyGate(selector),
        'gate is revoked',
      );
      await unchangedBefore(
        () => f.right.itemCaptureStore.declareCopyAttempt(declaration),
        'open copy gate',
      );
      await unchangedBefore(
        () =>
          f.right.itemCaptureStore.revokeCopyGate({
            ...revoke(selector, 0),
            evidenceRef: 'test:different-audit',
          }),
        'cannot be replaced',
      );
      expect(
        await f.right.itemCaptureStore.revokeCopyGate(revoke(selector, 0)),
      ).toEqual({
        ...revoked,
        gateRevision: 1,
        replayed: true,
      });
      expect(
        await f.right.itemCaptureStore.readCopyGate(selector),
      ).toMatchObject({
        state: 'REVOKED',
        revocation: {
          requestId: id(902),
          evidenceRef: 'test:copy-gate-revocation',
        },
        identityIds: [revoked.gateId, id(902)],
      });
    });

    it('requires the current revision and a free revocation identity while retaining the prior attempt', async () => {
      const { selector, declaration } = await openCopy();
      await f.left.itemCaptureStore.declareCopyAttempt(declaration);
      await unchangedBefore(
        () => f.right.itemCaptureStore.revokeCopyGate(revoke(selector, 0)),
        'gate revision changed',
      );
      await unchangedBefore(
        () =>
          f.right.itemCaptureStore.revokeCopyGate({
            ...revoke(selector, 1),
            requestId: declaration.attemptId,
          }),
        'already been used',
      );
      const attempts = await f.right.rows.copyRecords
        .find({ row: 'ATTEMPT' })
        .lean()
        .exec();
      expect(
        await f.right.itemCaptureStore.revokeCopyGate(revoke(selector, 1)),
      ).toMatchObject({
        state: 'REVOKED',
        gateRevision: 2,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(
        await f.right.rows.copyRecords.find({ row: 'ATTEMPT' }).lean().exec(),
      ).toEqual(attempts);
    });

    it.each([
      'CAPTURE_ADMISSION',
      'ITEM',
      'CLAIM',
      'FENCE',
      'COPY_GATE_CAS',
      'COPY_ATTEMPT_INSERT',
    ] as const)(
      'rolls back the declaration and all its writes when %s fails',
      async (point) => {
        const { declaration } = await openCopy();
        f.left.gate.fail = point;
        await unchangedBefore(
          () => f.left.itemCaptureStore.declareCopyAttempt(declaration),
          'could not be acknowledged',
        );
        expect(
          await f.right.rows.copyRecords.countDocuments({ row: 'ATTEMPT' }),
        ).toBe(0);
      },
    );

    it.each(['OPEN', 'REVOKE'] as const)(
      'rolls back all four fences on the first %s gate insert failure',
      async (mode) => {
        const {
          preparation: { selector },
        } = await f.seedHistoricalCopy(input);
        f.left.gate.fail = 'COPY_GATE_INSERT';
        await unchangedBefore(
          () =>
            mode === 'OPEN'
              ? f.left.itemCaptureStore.openCopyGate(selector)
              : f.left.itemCaptureStore.revokeCopyGate(revoke(selector)),
          'could not be acknowledged',
        );
        expect(
          await f.right.itemCaptureStore.readCopyGate(selector),
        ).toBeNull();
      },
    );

    it('replays opening after a competing client creates the same gate', async () => {
      const {
        preparation: { selector },
      } = await f.seedHistoricalCopy(input);
      const pause = f.left.gate.arm('CAPTURE_ADMISSION');
      const pending = f.observe(f.left.itemCaptureStore.openCopyGate(selector));
      await pause.entered();
      const winner = await f.right.itemCaptureStore.openCopyGate(selector);
      pause.release();
      expect(await pending).toEqual({
        value: { ...winner, gateRevision: 1, replayed: true },
      });
      expect(await f.right.rows.copyRecords.countDocuments()).toBe(1);
    });

    it('keeps the revocation when a pending opener retries its stale snapshot', async () => {
      const {
        preparation: { selector },
      } = await f.seedHistoricalCopy(input);
      const pause = f.left.gate.arm('CAPTURE_ADMISSION');
      const pending = f.observe(f.left.itemCaptureStore.openCopyGate(selector));
      await pause.entered();
      await f.right.itemCaptureStore.revokeCopyGate(revoke(selector));
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toMatchObject({
        error: { message: 'The item copy gate is revoked' },
      });
      expect(await f.snapshot()).toEqual(before);
    });

    it.each(['same', 'different'] as const)(
      'rejects a concurrent declaration with the %s attempt ID at a stale revision',
      async (identity) => {
        const { declaration } = await openCopy();
        const pause = f.left.gate.arm('CAPTURE_ADMISSION');
        const pending = f.observe(
          f.left.itemCaptureStore.declareCopyAttempt({
            ...declaration,
            attemptId: identity === 'same' ? declaration.attemptId : id(915),
          }),
        );
        await pause.entered();
        await f.right.itemCaptureStore.declareCopyAttempt(declaration);
        const before = await f.snapshot();
        pause.release();
        expect(await pending).toMatchObject({
          error: { message: 'The expected copy gate revision changed' },
        });
        expect(await f.snapshot()).toEqual(before);
        expect(
          await f.right.rows.copyRecords.countDocuments({ row: 'ATTEMPT' }),
        ).toBe(1);
      },
    );

    it('denies a paused declaration after revocation wins the gate and fences', async () => {
      const { selector, declaration } = await openCopy();
      const pause = f.left.gate.arm('CAPTURE_ADMISSION');
      const pending = f.observe(
        f.left.itemCaptureStore.declareCopyAttempt(declaration),
      );
      await pause.entered();
      await f.right.itemCaptureStore.revokeCopyGate(revoke(selector, 0));
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toMatchObject({
        error: { message: 'An original open copy gate is required' },
      });
      expect(await f.snapshot()).toEqual(before);
    });

    it('denies a stale revocation when a declaration advances the gate first', async () => {
      const { selector, declaration } = await openCopy();
      const pause = f.left.gate.arm('CAPTURE_ADMISSION');
      const pending = f.observe(
        f.left.itemCaptureStore.revokeCopyGate(revoke(selector, 0)),
      );
      await pause.entered();
      await f.right.itemCaptureStore.declareCopyAttempt(declaration);
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toMatchObject({
        error: { message: 'The expected copy gate revision changed' },
      });
      expect(await f.snapshot()).toEqual(before);
    });

    it('rolls back a declaration when the original reservation is invalidated before the control fence', async () => {
      const { selected, declaration } = await openCopy();
      const pause = f.left.gate.arm('FENCE');
      const pending = f.observe(
        f.left.itemCaptureStore.declareCopyAttempt(declaration),
      );
      await pause.entered();
      await f.right.rows.controls.collection.updateOne(
        { animalId: selected.animalId },
        { $inc: { reservationEpoch: 1 } },
      );
      // Read the externally invalidated state while the other transaction remains uncommitted.
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(await f.snapshot()).toEqual(before);
    });

    it('reconciles a lost application reply only after the actual declaration commit', async () => {
      const { selector, declaration } = await openCopy();
      f.loseNextCommitReply(f.left);
      await expect(
        f.left.itemCaptureStore.declareCopyAttempt(declaration),
      ).rejects.toMatchObject({ status: 503 });
      const gate = await f.right.itemCaptureStore.readCopyGate(selector);
      expect(gate).toMatchObject({ state: 'OPEN', revision: 1 });
      const rows = await f.right.rows.copyRecords
        .find({ row: 'ATTEMPT' })
        .lean()
        .exec();
      expect(rows).toEqual([
        expect.objectContaining({
          id: declaration.attemptId,
          state: 'INTENDED',
        }),
      ]);
      expect(
        await f.right.itemCaptureStore.declareCopyAttempt({
          ...declaration,
          expectedGateRevision: gate!.revision,
        }),
      ).toMatchObject({
        gateRevision: 2,
        replayed: true,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(
        await f.right.rows.copyRecords.find({ row: 'ATTEMPT' }).lean().exec(),
      ).toEqual(rows);
    });

    it.each([
      'id_1',
      'identityIds_1',
      'copyIntentId_1_ordinal_1',
      'gateId_1_row_1_id_1',
    ])(
      'fails closed without repairing missing copy record index %s',
      async (index) => {
        const { selector, declaration } = await openCopy();
        const collection = f.left.rows.copyRecords.collection;
        await collection.dropIndex(index);
        const from = f.commands.length;
        await expect(
          f.right.itemCaptureStore.readCopyGate(selector),
        ).rejects.toMatchObject({ status: 503 });
        await unchangedBefore(
          () => f.right.itemCaptureStore.declareCopyAttempt(declaration),
          'could not be acknowledged',
        );
        expect(businessWrites(from)).toEqual([]);
        expect(
          (await collection.indexes()).map((entry) => entry.name),
        ).not.toContain(index);
      },
    );

    it('requires the record collection only for record operations and never creates it on demand', async () => {
      const { selector, preparation } = await prepareCopy();
      await f.left.rows.copyRecords.collection.drop();
      const from = f.commands.length;
      await expect(
        f.right.itemCaptureStore.openCopyGate(selector),
      ).rejects.toMatchObject({ status: 503 });
      expect(businessWrites(from)).toEqual([]);
      expect(
        await f.right.itemCaptureStore.readHistoricalCopy(preparation),
      ).toMatchObject({
        file: { id: preparation.fileId },
      });
      const names = await f.right.connection
        .db!.listCollections({}, { nameOnly: true })
        .toArray();
      expect(names.map((entry) => entry.name)).not.toContain(
        ITEM_COPY_RECORD_COLLECTION,
      );
    });

    it.each([
      ['id', { id: 1 }],
      ['identityIds', { identityIds: 1 }],
      ['ordinal', { copyIntentId: 1, ordinal: 1 }],
    ] as const)(
      'enforces the %s uniqueness in Mongo independently of adapter checks',
      async (key, keyPattern) => {
        const { declaration } = await openCopy();
        await f.left.itemCaptureStore.declareCopyAttempt(declaration);
        const row = await f.left.rows.copyRecords
          .findOne({ id: declaration.attemptId })
          .select({ _id: 0 })
          .lean()
          .exec();
        if (!row || row.row !== 'ATTEMPT')
          throw new Error('Missing original attempt fixture');
        // Raw fixture write isolates one index violation at a time.
        const collision = {
          ...row,
          id: key === 'id' ? row.id : id(915),
          identityIds: key === 'identityIds' ? row.identityIds : [id(915)],
          copyIntentId: key === 'ordinal' ? row.copyIntentId : 'b'.repeat(64),
        };
        const before = await f.snapshot();
        await expect(
          f.right.rows.copyRecords.collection.insertOne(collision),
        ).rejects.toMatchObject({ code: 11000, keyPattern });
        expect(await f.snapshot()).toEqual(before);
      },
    );
  });

  describe('source profile state', () => {
    const request = { requestId: id(930), evidenceHash: 'd'.repeat(64) };
    const protocol = ITEM_SOURCE_PROFILE_STATE_PROTOCOL;
    function controls(generationId: string) {
      const configurationHash = 'c'.repeat(64);
      return {
        _id: itemSourceControlsHash(generationId, configurationHash),
        protocol,
        row: 'CONTROLS',
        state: 'ACTIVE',
        generationId,
        configurationHash,
      } as const;
    }
    function profile(
      profileId: string,
      controlsHash: string,
      selectorHash: string,
      revision = 1,
    ) {
      const definition = {
        protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_V1',
        id: profileId,
        revision,
        issuerId: id(931),
        selectorHash,
        signerContextHash: 'b'.repeat(64),
        controlsHash,
        validFrom: '2026-11-07T14:00:00.000Z',
        validUntil: '2026-11-07T16:00:00.000Z',
      } as const;
      return {
        _id: profileId,
        protocol,
        row: 'PROFILE',
        profile: {
          ...definition,
          state: 'ACTIVE',
          definitionHash: archiveHash(definition),
        },
      } as const;
    }
    function reference({
      profile: { id, revision, definitionHash },
    }: ReturnType<typeof profile>) {
      return { id, revision, definitionHash };
    }
    async function seedProfiles(selectorHash = 'a'.repeat(64)) {
      const shared = controls(id(932)),
        unrelated = controls(id(933));
      const first = profile(id(934), shared._id, selectorHash),
        second = profile(id(935), shared._id, 'e'.repeat(64)),
        other = profile(id(936), unrelated._id, 'f'.repeat(64));
      await f.left.sourceProfileRows.insertMany(
        [shared, unrelated, first, second, other],
        { writeConcern: { w: 'majority' } },
      );
      return { shared, unrelated, first, second, other };
    }
    async function seedLinkedProfile() {
      const { anchor, selected } = await f.seedHistoricalSourceAnchor(input);
      const source =
        await f.left.itemCaptureStore.readHistoricalSourceForAnchor(anchor);
      const selectorHash = sourceRetentionSelectorHash(
        source.source,
        f.left.sourceRetentionReader.expectedBucketOwner,
      );
      const seeded = await seedProfiles(selectorHash);
      return {
        ...seeded,
        selected,
        observationInput: { anchor, expectedProfile: reference(seeded.first) },
      };
    }
    function pauseCas(side = f.left) {
      const pause = side.gate.arm('SOURCE_PROFILE_WRITE');
      const rows = side.sourceProfileRows;
      const update = rows.updateOne.bind(rows);
      jest.spyOn(rows, 'updateOne').mockImplementationOnce(async (...args) => {
        await side.gate.before('SOURCE_PROFILE_WRITE');
        return update(...args);
      });
      return pause;
    }
    function pauseLeftSnapshot(onProfileRead: number) {
      const pause = f.left.gate.arm('SOURCE_PROFILE_SNAPSHOT');
      const rows = f.left.sourceProfileRows;
      const find = rows.findOne.bind(rows);
      let reads = 0;
      jest
        .spyOn(rows, 'findOne')
        .mockImplementation(async (filter, options) => {
          const row = await find(filter, options);
          if (
            options?.session?.inTransaction() &&
            row?.row === 'PROFILE' &&
            ++reads === onProfileRead
          )
            await f.left.gate.before('SOURCE_PROFILE_SNAPSHOT');
          return row;
        });
      return pause;
    }
    type Target = 'profile' | 'controls';
    function invalidate(
      side: typeof f.left,
      target: Target,
      seeded: Awaited<ReturnType<typeof seedProfiles>>,
      audit = request,
    ) {
      return target === 'profile'
        ? side.sourceProfiles.invalidateProfile(reference(seeded.first), audit)
        : side.sourceProfiles.invalidateSharedControls(
            seeded.shared._id,
            audit,
          );
    }

    it('reads profile and generation in one read-only snapshot using only the implicit ID index', async () => {
      const { first } = await seedProfiles();
      const before = await f.snapshot(),
        from = f.commands.length;
      expect(
        await f.right.sourceProfiles.readCurrentSourceProfile(first._id),
      ).toEqual(first.profile);
      const commands = f.commands.slice(from);
      const reads = commands.filter(
        (command) =>
          command.collection === ITEM_SOURCE_PROFILE_STATE_COLLECTION,
      );
      expect(reads).toHaveLength(2);
      const transaction = reads[0].transaction;
      expect(transaction).toBeDefined();
      expect(reads).toEqual([
        expect.objectContaining({
          side: 'right',
          command: 'find',
          transaction,
          snapshot: true,
        }),
        expect.objectContaining({
          side: 'right',
          command: 'find',
          transaction,
        }),
      ]);
      expect(commands).toContainEqual(
        expect.objectContaining({
          command: 'commitTransaction',
          transaction,
          majority: true,
        }),
      );
      expect(businessWrites(from)).toEqual([]);
      const indexes = await f.right.sourceProfileRows.indexes();
      expect(indexes).toEqual([
        expect.objectContaining({ name: '_id_', key: { _id: 1 } }),
      ]);
      expect(await f.snapshot()).toEqual(before);
    });

    it('blocks two selectors with one majority update and preserves a distinct generation of the same configuration', async () => {
      const t = await seedProfiles();
      const before = await f.snapshot(),
        from = f.commands.length;
      expect(await invalidate(f.left, 'controls', t)).toMatchObject({
        state: 'INVALIDATED',
        replayed: false,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(businessWrites(from)).toEqual([
        expect.objectContaining({
          collection: ITEM_SOURCE_PROFILE_STATE_COLLECTION,
          side: 'left',
          command: 'update',
          majority: true,
        }),
      ]);
      for (const dependent of [t.first, t.second])
        expect(
          await f.right.sourceProfiles.readCurrentSourceProfile(dependent._id),
        ).toEqual({ ...dependent.profile, state: 'INVALIDATED' });
      expect(
        await f.right.sourceProfiles.readCurrentSourceProfile(t.other._id),
      ).toEqual(t.other.profile);
      expect(await f.snapshot()).toEqual({
        ...before,
        sourceProfileStates: (
          before.sourceProfileStates as Array<{ _id: string }>
        ).map((row) =>
          row._id === t.shared._id
            ? { ...row, state: 'INVALIDATED', invalidation: request }
            : row,
        ),
      });
    });

    it('rejects a stale reference and invalidates only the pinned profile', async () => {
      const t = await seedProfiles(),
        from = f.commands.length;
      await unchangedBefore(() =>
        f.left.sourceProfiles.invalidateProfile(
          { ...reference(t.first), revision: 0 },
          request,
        ),
      );
      expect(businessWrites(from)).toEqual([]);
      await expect(invalidate(f.left, 'profile', t)).resolves.toMatchObject({
        replayed: false,
      });
      expect(
        await f.right.sourceProfiles.readCurrentSourceProfile(t.first._id),
      ).toEqual({ ...t.first.profile, state: 'INVALIDATED' });
      expect(
        await f.right.sourceProfiles.readCurrentSourceProfile(t.second._id),
      ).toEqual(t.second.profile);
      expect(
        await f.right.sourceProfileRows.findOne({ _id: t.shared._id }),
      ).toEqual(t.shared);
    });

    it('does not adopt a newer revision that replaced the profile before the CAS', async () => {
      const t = await seedProfiles(),
        pause = pauseCas();
      const pending = f.observe(invalidate(f.left, 'profile', t));
      await pause.entered();
      const newer = profile(
        t.first._id,
        t.shared._id,
        t.first.profile.selectorHash,
        2,
      );
      const changed = await f.right.sourceProfileRows.replaceOne(
        { _id: newer._id },
        newer,
        { writeConcern: { w: 'majority' } },
      );
      expect(changed.modifiedCount).toBe(1);
      const saved = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty(
        'error.message',
        expect.stringContaining('state changed'),
      );
      expect(
        await f.right.sourceProfiles.readCurrentSourceProfile(newer._id),
      ).toEqual(newer.profile);
      expect(await f.snapshot()).toEqual(saved);
    });

    it.each([
      ['profile', 'same'],
      ['profile', 'different'],
      ['controls', 'same'],
      ['controls', 'different'],
    ] as const)(
      'resolves a competing %s CAS with a %s request',
      async (target, kind) => {
        const t = await seedProfiles(),
          pause = pauseCas();
        const competing =
          kind === 'same' ? request : { ...request, requestId: id(937) };
        const pending = f.observe(invalidate(f.left, target, t, competing));
        await pause.entered();
        const winner = await invalidate(f.right, target, t);
        expect(winner.replayed).toBe(false);
        const saved = await f.snapshot(),
          from = f.commands.length;
        pause.release();
        if (kind === 'same')
          expect(await pending).toEqual({
            value: { ...winner, replayed: true },
          });
        else
          expect(await pending).toHaveProperty(
            'error.message',
            expect.stringContaining('state changed'),
          );
        expect(businessWrites(from)).toEqual([
          expect.objectContaining({
            side: 'left',
            collection: ITEM_SOURCE_PROFILE_STATE_COLLECTION,
            command: 'update',
            majority: true,
          }),
        ]);
        expect(await f.snapshot()).toEqual(saved);
      },
    );

    it.each(['profile', 'controls'] as const)(
      'recovers the %s receipt after a recognized write and lost application reply',
      async (target) => {
        const t = await seedProfiles();
        const rows = f.left.sourceProfileRows;
        const update = rows.updateOne.bind(rows);
        let recognized: Awaited<ReturnType<typeof update>> | undefined;
        jest
          .spyOn(rows, 'updateOne')
          .mockImplementationOnce(async (...args) => {
            recognized = await update(...args);
            throw new Error(
              'Injected application reply loss after native majority update',
            );
          });
        const from = f.commands.length;
        await expect(invalidate(f.left, target, t)).rejects.toThrow(
          'could not be acknowledged',
        );
        expect(recognized).toMatchObject({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
        });
        expect(businessWrites(from)).toEqual([
          expect.objectContaining({
            side: 'left',
            collection: ITEM_SOURCE_PROFILE_STATE_COLLECTION,
            command: 'update',
            majority: true,
          }),
        ]);
        const saved = await f.snapshot(),
          fromReplay = f.commands.length;
        await expect(invalidate(f.right, target, t)).resolves.toMatchObject({
          replayed: true,
          state: 'INVALIDATED',
          copyDispatch: 'NOT_AUTHORIZED',
        });
        await expect(
          invalidate(f.right, target, t, {
            ...request,
            evidenceHash: '1'.repeat(64),
          }),
        ).rejects.toThrow('state changed');
        expect(businessWrites(fromReplay)).toEqual([]);
        expect(await f.snapshot()).toEqual(saved);
      },
    );

    it('preserves a snapshot already opened before shared invalidation and rejects a fresh active read', async () => {
      const t = await seedProfiles(),
        pause = pauseLeftSnapshot(1);
      const pending = f.observe(
        f.left.sourceProfiles.readCurrentSourceProfile(t.first._id),
      );
      await pause.entered();
      await invalidate(f.right, 'controls', t);
      pause.release();
      expect(await pending).toEqual({ value: t.first.profile });
      expect(
        await f.left.sourceProfiles.readCurrentSourceProfile(t.first._id),
      ).toEqual({ ...t.first.profile, state: 'INVALIDATED' });
    });

    it.each(['absent', 'corrupt'] as const)(
      'fails closed with %s shared controls and makes no upsert',
      async (kind) => {
        const t = await seedProfiles();
        if (kind === 'absent') {
          const removed = await f.right.sourceProfileRows.deleteOne({
            _id: t.shared._id,
          });
          expect(removed.deletedCount).toBe(1);
        } else {
          const changed = await f.right.sourceProfileRows.updateOne(
            { _id: t.shared._id },
            { $set: { generationId: id(938) } },
          );
          expect(changed.modifiedCount).toBe(1);
        }
        const from = f.commands.length;
        const read = f.left.sourceProfiles.readCurrentSourceProfile(
          t.first._id,
        );
        if (kind === 'absent') await expect(read).resolves.toBeNull();
        else await expect(read).rejects.toThrow('state changed');
        await unchangedBefore(() => invalidate(f.left, 'controls', t));
        expect(businessWrites(from)).toEqual([]);
      },
    );

    it('links the current profile under the original reserve with a single synthetic stream and no writes', async () => {
      const t = await seedLinkedProfile();
      const before = await f.snapshot(),
        from = f.commands.length;
      const result =
        await f.right.manifestObserver.observeHistoricalSourceProfile(
          t.observationInput,
        );
      expect(result.profileObservation).toMatchObject({
        profile: reference(t.first),
        fixedSourceObservationHash: result.fixedSource.observationHash,
        storageObservationHash: result.storageObservation.observationHash,
        reservation: 'OBSERVED_ONLY',
        readability: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(result.storageObservation.classification).toBe(
        'STANDARD_IF_DIRECT_S3',
      );
      expect(f.right.sourceReader.calls).toEqual(['READ', 'CLOSE']);
      expect(businessWrites(from)).toEqual([]);
      expect(await f.snapshot()).toEqual(before);
    });

    it.each(['profile', 'controls'] as const)(
      'discards the linked observation when %s is invalidated while the synthetic read is paused',
      async (target) => {
        const t = await seedLinkedProfile();
        const pause = f.right.gate.arm('SOURCE_READ');
        const pending = f.observe(
          f.right.manifestObserver.observeHistoricalSourceProfile(
            t.observationInput,
          ),
        );
        await pause.entered();
        await invalidate(f.left, target, t);
        const saved = await f.snapshot(),
          from = f.commands.length;
        pause.release();
        expect(await pending).toHaveProperty(
          'error.message',
          expect.stringContaining('profile is unavailable'),
        );
        expect(f.right.sourceReader.calls).toEqual(['READ', 'CLOSE']);
        expect(businessWrites(from)).toEqual([]);
        expect(await f.snapshot()).toEqual(saved);
      },
    );

    it('discards the linked observation when the original reservation changes during the second profile snapshot', async () => {
      const t = await seedLinkedProfile(),
        pause = pauseLeftSnapshot(2);
      const pending = f.observe(
        f.left.manifestObserver.observeHistoricalSourceProfile(
          t.observationInput,
        ),
      );
      await pause.entered();
      const changed = await f.right.rows.controls.collection.updateOne(
        { animalId: t.selected.animalId },
        { $inc: { reservationEpoch: 1 } },
      );
      expect(changed.modifiedCount).toBe(1);
      const saved = await f.snapshot(),
        from = f.commands.length;
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(businessWrites(from)).toEqual([]);
      expect(await f.snapshot()).toEqual(saved);
    });

    describe('source profile fence', () => {
      const transactionOptions = {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
        timeoutMS: 15000,
      } as const;

      function inTransaction(
        side: typeof f.left,
        work: (session: mongo.ClientSession) => Promise<void>,
      ) {
        return side.connection
          .getClient()
          .withSession((session) =>
            session.withTransaction(work, transactionOptions),
          );
      }

      function fenceProfile(
        session: mongo.ClientSession,
        row: ReturnType<typeof profile>,
        side = f.left,
      ) {
        return side.sourceProfiles.fenceActiveSourceProfile(
          reference(row),
          session,
        );
      }

      it('increments exactly the pinned profile and generation in each caller commit', async () => {
        const t = await seedProfiles(),
          before = await f.snapshot(),
          from = f.commands.length;
        const fence = (session: mongo.ClientSession) =>
          fenceProfile(session, t.first);

        await expect(inTransaction(f.left, fence)).resolves.toBeUndefined();
        await expect(inTransaction(f.left, fence)).resolves.toBeUndefined();
        const writes = businessWrites(from);
        expect(writes).toHaveLength(4);
        const transactions = new Set(writes.map((write) => write.transaction));
        expect(transactions.size).toBe(2);
        for (const transaction of transactions) {
          expect(transaction).toBeDefined();
          const batch = writes.filter(
            (write) => write.transaction === transaction,
          );
          expect(batch).toHaveLength(2);
          for (const write of batch)
            expect(write).toMatchObject({
              side: 'left',
              command: 'update',
              collection: ITEM_SOURCE_PROFILE_STATE_COLLECTION,
            });
          expect(f.commands.slice(from)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                command: 'find',
                transaction,
                snapshot: true,
              }),
              expect.objectContaining({
                command: 'commitTransaction',
                transaction,
                majority: true,
              }),
            ]),
          );
        }
        expect(await f.snapshot()).toEqual({
          ...before,
          sourceProfileStates: (
            before.sourceProfileStates as Array<{ _id: string }>
          ).map((row) =>
            [t.first._id, t.shared._id].includes(row._id)
              ? { ...row, fenceRevision: 2 }
              : row,
          ),
        });
      });

      it('rolls back both successful writes when the caller aborts', async () => {
        const t = await seedProfiles(),
          before = await f.snapshot(),
          from = f.commands.length;
        const injected = new Error('Injected caller failure after both fences');
        await expect(
          inTransaction(f.left, async (session) => {
            await fenceProfile(session, t.first);
            for (const _id of [t.first._id, t.shared._id]) {
              expect(
                await f.left.sourceProfileRows.findOne({ _id }, { session }),
              ).toMatchObject({ fenceRevision: 1 });
            }
            throw injected;
          }),
        ).rejects.toBe(injected);
        const writes = businessWrites(from);
        expect(writes).toHaveLength(2);
        const transaction = writes[0].transaction;
        expect(transaction).toBeDefined();
        expect(writes[1].transaction).toBe(transaction);
        expect(f.commands.slice(from)).toContainEqual(
          expect.objectContaining({ command: 'abortTransaction', transaction }),
        );
        expect(await f.snapshot()).toEqual(before);
      });

      it('rolls back the first write when the shared counter is exhausted', async () => {
        const t = await seedProfiles();
        const changed = await f.right.sourceProfileRows.updateOne(
          { _id: t.shared._id },
          { $set: { fenceRevision: Number.MAX_SAFE_INTEGER } },
        );
        expect(changed.modifiedCount).toBe(1);
        const before = await f.snapshot(),
          from = f.commands.length;
        await expect(
          inTransaction(f.left, (session) => fenceProfile(session, t.first)),
        ).rejects.toThrow('state changed');
        const writes = businessWrites(from);
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({
          side: 'left',
          command: 'update',
          collection: ITEM_SOURCE_PROFILE_STATE_COLLECTION,
        });
        expect(writes[0].transaction).toBeDefined();
        expect(f.commands.slice(from)).toContainEqual(
          expect.objectContaining({
            command: 'abortTransaction',
            transaction: writes[0].transaction,
          }),
        );
        expect(await f.snapshot()).toEqual(before);
      });

      it('rejects a transaction from the other client before touching the profile rows', async () => {
        const t = await seedProfiles(),
          before = await f.snapshot(),
          from = f.commands.length;
        await expect(
          inTransaction(f.right, (session) => fenceProfile(session, t.first)),
        ).rejects.toThrow('state changed');
        expect(f.commands.slice(from)).toEqual([]);
        expect(await f.snapshot()).toEqual(before);
      });

      it.each(['profile', 'controls'] as const)(
        'fails before any write when the %s is already invalidated',
        async (target) => {
          const t = await seedProfiles();
          await invalidate(f.right, target, t);
          const before = await f.snapshot(),
            from = f.commands.length;
          await expect(
            inTransaction(f.left, (session) => fenceProfile(session, t.first)),
          ).rejects.toThrow(
            target === 'profile' ? 'profile is unavailable' : 'state changed',
          );
          expect(businessWrites(from)).toEqual([]);
          expect(await f.snapshot()).toEqual(before);
        },
      );

      it.each(['profile', 'controls', 'replacement'] as const)(
        'retries the native write conflict after %s wins and rejects the stale fence',
        async (winner) => {
          const t = await seedProfiles(),
            pause = pauseLeftSnapshot(1);
          const errors: unknown[] = [];
          let attempts = 0;
          const pending = f.observe(
            inTransaction(f.left, async (session) => {
              attempts++;
              try {
                await fenceProfile(session, t.first);
              } catch (error) {
                errors.push(error);
                throw error;
              }
            }),
          );
          await pause.entered();
          if (winner === 'replacement') {
            const newer = profile(
              t.first._id,
              t.shared._id,
              t.first.profile.selectorHash,
              2,
            );
            const result = await f.right.sourceProfileRows.replaceOne(
              { _id: newer._id },
              newer,
              { writeConcern: { w: 'majority' } },
            );
            expect(result.modifiedCount).toBe(1);
          } else {
            await invalidate(f.right, winner, t);
          }
          const saved = await f.snapshot(),
            from = f.commands.length;
          pause.release();
          expect(await pending).toHaveProperty(
            'error.message',
            expect.stringContaining(
              winner === 'controls'
                ? 'state changed'
                : 'profile is unavailable',
            ),
          );
          expect(attempts).toBe(2);
          const conflict = errors[0];
          expect(conflict).toBeInstanceOf(mongo.MongoServerError);
          expect(
            (conflict as mongo.MongoServerError).hasErrorLabel(
              'TransientTransactionError',
            ),
          ).toBe(true);
          expect(businessWrites(from)).toHaveLength(
            winner === 'controls' ? 2 : 1,
          );
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      it.each(['profile', 'controls'] as const)(
        'commits the fence before a pending %s invalidation reaches its CAS',
        async (target) => {
          const t = await seedProfiles(),
            pause = pauseCas(f.right);
          const pending = f.observe(invalidate(f.right, target, t));
          await pause.entered();
          await inTransaction(f.left, (session) =>
            fenceProfile(session, t.first),
          );
          pause.release();
          expect(await pending).toMatchObject({
            value: {
              state: 'INVALIDATED',
              replayed: false,
              copyDispatch: 'NOT_AUTHORIZED',
            },
          });
          const rows = f.left.sourceProfileRows;
          const profileInvalidation =
            target === 'profile'
              ? {
                  profile: { ...t.first.profile, state: 'INVALIDATED' },
                  invalidation: request,
                }
              : {};
          const controlsInvalidation =
            target === 'controls'
              ? { state: 'INVALIDATED', invalidation: request }
              : {};
          expect(await rows.findOne({ _id: t.first._id })).toEqual({
            ...t.first,
            ...profileInvalidation,
            fenceRevision: 1,
          });
          expect(await rows.findOne({ _id: t.shared._id })).toEqual({
            ...t.shared,
            ...controlsInvalidation,
            fenceRevision: 1,
          });
        },
      );

      it('serializes fences for two different selectors through their shared generation', async () => {
        const t = await seedProfiles(),
          pause = pauseLeftSnapshot(1);
        let attempts = 0;
        const pending = f.observe(
          inTransaction(f.left, async (session) => {
            attempts++;
            await fenceProfile(session, t.first);
          }),
        );
        await pause.entered();
        await inTransaction(f.right, (session) =>
          fenceProfile(session, t.second, f.right),
        );
        pause.release();
        expect(await pending).toEqual({ value: undefined });
        expect(attempts).toBe(2);
        const rows = f.right.sourceProfileRows;
        for (const profile of [t.first, t.second]) {
          expect(await rows.findOne({ _id: profile._id })).toEqual({
            ...profile,
            fenceRevision: 1,
          });
        }
        expect(await rows.findOne({ _id: t.shared._id })).toEqual({
          ...t.shared,
          fenceRevision: 2,
        });
        expect(await rows.findOne({ _id: t.unrelated._id })).toEqual(
          t.unrelated,
        );
      });
    });
    describe('source profile accreditation', () => {
      async function setupAccreditation() {
        const t = await seedProfiles();
        const ref = reference(t.first);
        const accreditation: ItemSourceOperationalAccreditation = {
          profileDefinitionHash: ref.definitionHash,
          endpoint: 'DIRECT_S3',
          evidenceHash: '1'.repeat(64),
          validFrom: '2026-11-07T14:15:00.000Z',
          validUntil: '2026-11-07T15:30:00.000Z',
        };
        return {
          ...t,
          ref,
          accreditation,
          provision: (side = f.left, facts = accreditation) =>
            side.sourceProfiles.provisionSourceAccreditation(ref, facts),
          read: (side = f.right) =>
            side.sourceProfiles.readActiveSourceAccreditation(ref),
        };
      }

      it('stores the first accreditation with the shared fence in a single majority commit', async () => {
        const t = await setupAccreditation();
        await expect(t.read()).resolves.toBeNull();
        const before = await f.snapshot(),
          from = f.commands.length;
        await expect(t.provision()).resolves.toEqual({
          accreditation: t.accreditation,
          replayed: false,
        });
        const writes = businessWrites(from);
        const transaction = writes[0]?.transaction;
        expect(transaction).toBeDefined();
        expect(writes).toHaveLength(2);
        for (const write of writes)
          expect(write).toMatchObject({
            side: 'left',
            command: 'update',
            collection: ITEM_SOURCE_PROFILE_STATE_COLLECTION,
            transaction,
          });
        const commands = f.commands.slice(from);
        expect(commands).toContainEqual(
          expect.objectContaining({
            command: 'find',
            transaction,
            snapshot: true,
          }),
        );
        expect(commands).toContainEqual(
          expect.objectContaining({
            command: 'commitTransaction',
            transaction,
            majority: true,
          }),
        );
        const fromReplay = f.commands.length;
        await expect(t.read()).resolves.toEqual({
          profile: t.first.profile,
          accreditation: t.accreditation,
        });
        await expect(t.provision(f.right)).resolves.toEqual({
          accreditation: t.accreditation,
          replayed: true,
        });
        expect(businessWrites(fromReplay)).toEqual([]);
        expect(await f.snapshot()).toEqual({
          ...before,
          sourceProfileStates: (
            before.sourceProfileStates as Array<{ _id: string }>
          ).map((row) => {
            if (row._id === t.first._id)
              return { ...row, accreditation: t.accreditation };
            if (row._id === t.shared._id) return { ...row, fenceRevision: 1 };
            return row;
          }),
        });
      });

      it.each(['before', 'after'] as const)(
        'rolls back both rows on failure %s the native controls write',
        async (point) => {
          const t = await setupAccreditation();
          const rows = f.left.sourceProfileRows;
          const update = rows.updateOne.bind(rows);
          const failure = new Error('Injected controls write failure');
          jest
            .spyOn(rows, 'updateOne')
            .mockImplementation(async (filter, change, options) => {
              if (
                filter.row !== 'CONTROLS' ||
                !options?.session?.inTransaction()
              )
                return update(filter, change, options);
              if (point === 'after') {
                const saved = await update(filter, change, options);
                expect(saved).toMatchObject({
                  matchedCount: 1,
                  modifiedCount: 1,
                });
              }
              throw failure;
            });
          const before = await f.snapshot(),
            from = f.commands.length;
          await expect(t.provision()).rejects.toBe(failure);
          const writes = businessWrites(from);
          expect(writes).toHaveLength(point === 'after' ? 2 : 1);
          expect(f.commands.slice(from)).toContainEqual(
            expect.objectContaining({
              side: 'left',
              command: 'abortTransaction',
              transaction: writes[0].transaction,
            }),
          );
          await expect(t.read()).resolves.toBeNull();
          expect(await f.snapshot()).toEqual(before);
        },
      );

      it.each(['same', 'different'] as const)(
        'preserves the first accreditation when two clients submit %s evidence',
        async (kind) => {
          const t = await setupAccreditation(),
            pause = pauseCas();
          const competing =
            kind === 'same'
              ? t.accreditation
              : { ...t.accreditation, evidenceHash: '2'.repeat(64) };
          const pending = f.observe(t.provision(f.left, competing));
          await pause.entered();
          const winner = await t.provision(f.right);
          expect(winner.replayed).toBe(false);
          const saved = await f.snapshot(),
            from = f.commands.length;
          pause.release();
          if (kind === 'same')
            expect(await pending).toEqual({
              value: { ...winner, replayed: true },
            });
          else
            expect(await pending).toHaveProperty(
              'error.message',
              expect.stringContaining('state changed'),
            );
          expect(businessWrites(from)).toHaveLength(1);
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      it.each(['profile', 'controls'] as const)(
        'leaves no accreditation when %s invalidation wins',
        async (target) => {
          const t = await setupAccreditation(),
            pause = pauseCas();
          const pending = f.observe(t.provision());
          await pause.entered();
          await invalidate(f.right, target, t);
          const saved = await f.snapshot(),
            from = f.commands.length;
          pause.release();
          expect(await pending).toHaveProperty(
            'error.message',
            expect.stringContaining(
              target === 'profile' ? 'profile is unavailable' : 'state changed',
            ),
          );
          expect(businessWrites(from)).toHaveLength(
            target === 'controls' ? 2 : 1,
          );
          await expect(t.read()).rejects.toThrow();
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      it.each(['profile', 'controls'] as const)(
        'blocks fresh reads and replays when a pending %s invalidation follows the provision commit',
        async (target) => {
          const t = await setupAccreditation(),
            pause = pauseCas(f.right);
          const pending = f.observe(invalidate(f.right, target, t));
          await pause.entered();
          await expect(t.provision()).resolves.toMatchObject({
            replayed: false,
          });
          pause.release();
          expect(await pending).toMatchObject({
            value: {
              state: 'INVALIDATED',
              replayed: false,
              copyDispatch: 'NOT_AUTHORIZED',
            },
          });
          const rows = f.left.sourceProfileRows;
          expect(await rows.findOne({ _id: t.first._id })).toMatchObject({
            accreditation: t.accreditation,
          });
          expect(await rows.findOne({ _id: t.shared._id })).toMatchObject({
            fenceRevision: 1,
          });
          const saved = await f.snapshot(),
            from = f.commands.length;
          await expect(t.read()).rejects.toThrow();
          await expect(t.provision(f.right)).rejects.toThrow();
          expect(businessWrites(from)).toEqual([]);
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      it('reconciles the exact accreditation after the driver acknowledged the commit and the app lost the reply', async () => {
        const t = await setupAccreditation();
        const client = f.left.connection.getClient();
        const start = client.startSession.bind(client);
        jest.spyOn(client, 'startSession').mockImplementationOnce((...args) => {
          const session = start(...args);
          const transaction = session.withTransaction.bind(session);
          jest
            .spyOn(session, 'withTransaction')
            .mockImplementationOnce(async (work, options) => {
              await transaction(work, options);
              throw new Error('Injected accreditation commit reply loss');
            });
          return session;
        });
        const from = f.commands.length;
        await expect(t.provision()).rejects.toThrow(
          'Injected accreditation commit reply loss',
        );
        const writes = businessWrites(from);
        expect(writes).toHaveLength(2);
        expect(f.commands.slice(from)).toContainEqual(
          expect.objectContaining({
            side: 'left',
            command: 'commitTransaction',
            majority: true,
            transaction: writes[0].transaction,
          }),
        );
        const saved = await f.snapshot(),
          fromReplay = f.commands.length;
        await expect(t.provision(f.right)).resolves.toEqual({
          accreditation: t.accreditation,
          replayed: true,
        });
        await expect(
          t.provision(f.right, {
            ...t.accreditation,
            evidenceHash: '2'.repeat(64),
          }),
        ).rejects.toThrow();
        expect(businessWrites(fromReplay)).toEqual([]);
        expect(await f.snapshot()).toEqual(saved);
      });

      it('keeps an old accreditation snapshot observational after shared invalidation', async () => {
        const t = await setupAccreditation();
        await t.provision();
        const pause = pauseLeftSnapshot(1);
        const pending = f.observe(t.read(f.left));
        await pause.entered();
        await invalidate(f.right, 'controls', t);
        const saved = await f.snapshot(),
          from = f.commands.length;
        pause.release();
        expect(await pending).toEqual({
          value: { profile: t.first.profile, accreditation: t.accreditation },
        });
        await expect(t.read()).rejects.toThrow();
        expect(businessWrites(from)).toEqual([]);
        expect(await f.snapshot()).toEqual(saved);
      });

      it.each(['corrupt accreditation', 'missing controls'] as const)(
        'rejects %s without repairing or creating technical rows',
        async (kind) => {
          const t = await setupAccreditation();
          await t.provision();
          const rows = f.right.sourceProfileRows;
          if (kind === 'corrupt accreditation') {
            const changed = await rows.updateOne(
              { _id: t.first._id },
              {
                $set: { 'accreditation.profileDefinitionHash': '0'.repeat(64) },
              },
            );
            expect(changed.modifiedCount).toBe(1);
          } else {
            const removed = await rows.deleteOne({ _id: t.shared._id });
            expect(removed.deletedCount).toBe(1);
          }
          const saved = await f.snapshot(),
            from = f.commands.length;
          await expect(t.read()).rejects.toThrow();
          await expect(t.provision(f.right)).rejects.toThrow();
          expect(businessWrites(from)).toEqual([]);
          expect(await f.snapshot()).toEqual(saved);
        },
      );
    });

    describe('persisted historical source read window', () => {
      async function setupWindow() {
        const t = await seedLinkedProfile();
        const { anchor, expectedProfile } = t.observationInput;
        const { observation } =
          await f.left.manifestPreparer.prepareHistoricalSourceProfile(
            t.observationInput,
          );
        const accreditation: ItemSourceOperationalAccreditation = {
          profileDefinitionHash: expectedProfile.definitionHash,
          endpoint: 'DIRECT_S3',
          evidenceHash: '1'.repeat(64),
          validFrom: '2026-11-07T14:30:00.000Z',
          validUntil: '2026-11-07T15:50:00.000Z',
        };
        const gate = await f.left.itemCaptureStore.openCopyGate(
          anchor.preparation.selector,
        );
        const attempt = await f.left.itemCaptureStore.declareCopyAttempt({
          preparation: anchor.preparation,
          kind: 'HISTORICAL',
          attemptId: id(941),
          dispatcherInstanceId: id(942),
          origin: 'INITIAL',
          expectedGateRevision: gate.gateRevision,
        });
        const request = {
          ...t.observationInput,
          attemptId: attempt.attemptId!,
          expectedAttemptDefinitionHash: attempt.attemptDefinitionHash!,
          expectedGateRevision: attempt.gateRevision,
        };
        const bound = {
          basis: 'ACCREDITED_LAST_SOURCE_READ',
          attemptDefinitionHash: request.expectedAttemptDefinitionHash,
          signerContextHash: t.first.profile.signerContextHash,
          evidenceHash: '2'.repeat(64),
          lastReadAt: '2026-11-07T15:30:00.000Z',
          marginMs: 60_000,
        } as const;
        const key = `${bound.attemptDefinitionHash}:${bound.signerContextHash}`;
        for (const side of [f.left, f.right]) {
          side.sourceReadBounds.set(key, bound);
          side.sourceReader.calls.length = 0;
        }
        return {
          ...t,
          request,
          accreditation,
          observation,
          bound,
          key,
          provision: () =>
            f.left.sourceProfiles.provisionSourceAccreditation(
              expectedProfile,
              accreditation,
            ),
        };
      }

      type WindowFixture = Awaited<ReturnType<typeof setupWindow>>;

      async function prepareRecordedBound(
        t: WindowFixture,
        overrides: Partial<
          Parameters<typeof buildItemSourceDelegationBound>[0]
        > = {},
      ) {
        const row = await f.right.rows.copyRecords
          .findOne({ id: t.request.attemptId })
          .lean()
          .exec();
        if (row?.row !== 'ATTEMPT')
          throw new Error('Missing intended attempt fixture');
        const facts = {
          ...t.bound,
          evidenceHash: '3'.repeat(64),
          delegateBefore: '2026-11-07T15:20:00.000Z',
          ...overrides,
        };
        const bound = buildItemSourceDelegationBound(
          facts,
          row.definition,
          facts.signerContextHash,
        );
        const collaboratorReads = [f.left, f.right].map((side) => {
          side.historicalReader.calls.length = 0;
          side.stagingReader.calls.length = 0;
          side.sourceRetentionReader.targets.length = 0;
          return jest.spyOn(side.sourceReadBounds, 'get');
        });
        const request = { ...t.request, expectedBoundHash: bound.boundHash };
        return {
          bound,
          request,
          record: async (side = f.left) => {
            const receipt =
              await side.itemCaptureStore.recordSourceDelegationBound(
                {
                  preparation: request.anchor.preparation,
                  attemptId: request.attemptId,
                  expectedAttemptDefinitionHash:
                    request.expectedAttemptDefinitionHash,
                  expectedGateRevision: request.expectedGateRevision,
                  signerContextHash: facts.signerContextHash,
                },
                bound,
              );
            return { ...request, expectedGateRevision: receipt.gateRevision };
          },
          expectNoReads: () => {
            for (const spy of collaboratorReads)
              expect(spy).not.toHaveBeenCalled();
            for (const side of [f.left, f.right]) {
              expect(side.sourceReader.calls).toEqual([]);
              expect(side.historicalReader.calls).toEqual([]);
              expect(side.stagingReader.calls).toEqual([]);
              expect(side.sourceRetentionReader.targets).toEqual([]);
            }
          },
        };
      }

      it.each(['collaborator', 'recorded'] as const)(
        'uses a single native snapshot with the %s bound without acquiring fences',
        async (mode) => {
          const t = await setupWindow();
          await t.provision();
          const recorded =
            mode === 'recorded' ? await prepareRecordedBound(t) : undefined;
          const request = recorded ? await recorded.record() : t.request;
          if (recorded)
            f.right.sourceRetentionReader.observedAt =
              '2026-11-07T15:19:59.999Z';
          const before = await f.snapshot(),
            from = f.commands.length;
          const result =
            await f.right.itemCaptureStore.assessSourceReadWindow(request);
          expect(result).toMatchObject({
            assessment: 'WINDOW_FITS',
            attemptDefinitionHash: t.request.expectedAttemptDefinitionHash,
            profileObservationHash:
              t.observation.profileObservation.observationHash,
            accreditationEvidenceHash: t.accreditation.evidenceHash,
            readBoundEvidenceHash: (recorded?.bound ?? t.bound).evidenceHash,
            limitAt: t.accreditation.validUntil,
            reservation: 'OBSERVED_ONLY',
            stableCut: 'NOT_ASSESSED',
            retention: 'NOT_ASSESSED',
            copyDispatch: 'NOT_AUTHORIZED',
            businessCommit: 'NOT_AUTHORIZED',
          });
          if (recorded) {
            expect(result).toMatchObject({
              protocol: 'ITEM_HISTORICAL_RECORDED_SOURCE_READ_WINDOW_V1',
              boundHash: recorded.bound.boundHash,
              delegateBefore: recorded.bound.delegateBefore,
              evaluatedAt: '2026-11-07T15:19:59.999Z',
            });
            const { assessmentHash, ...definition } = result;
            expect(assessmentHash).toBe(archiveHash(definition));
            recorded.expectNoReads();
          }
          const commands = f.commands.slice(from);
          const reads = commands.filter(
            (command) => command.command === 'find',
          );
          const transaction = reads[0]?.transaction;
          expect(transaction).toBeDefined();
          expect(reads[0]).toMatchObject({ side: 'right', snapshot: true });
          expect(
            reads.every(
              (read) =>
                read.side === 'right' && read.transaction === transaction,
            ),
          ).toBe(true);
          expect(reads.map((read) => read.collection)).toEqual([
            'animal_transfers',
            'animal_transfer_items',
            'animal_transfer_active_items',
            'animal_ownership_archives',
            'animal_ownership_controls',
            'animal_ownership_periods',
            'animal_ownership_periods',
            ITEM_COPY_RECORD_COLLECTION,
            'animal_ownership_archive_files',
            ITEM_COPY_RECORD_COLLECTION,
            ITEM_SOURCE_PROFILE_STATE_COLLECTION,
            ITEM_SOURCE_PROFILE_STATE_COLLECTION,
          ]);
          expect(
            commands.filter(
              (command) => command.command === 'commitTransaction',
            ),
          ).toEqual([
            expect.objectContaining({
              side: 'right',
              transaction,
              majority: true,
            }),
          ]);
          expect(businessWrites(from)).toEqual([]);
          expect(f.right.sourceReader.calls).toEqual([]);
          expect(await f.snapshot()).toEqual(before);
        },
      );

      it.each([
        ['profile', 'collaborator'],
        ['controls', 'collaborator'],
        ['gate', 'collaborator'],
        ['reservation', 'collaborator'],
        ['profile', 'recorded'],
        ['controls', 'recorded'],
        ['gate', 'recorded'],
        ['reservation', 'recorded'],
      ] as const)(
        'distinguishes the in-flight snapshot from a new assessment after changing %s with the %s bound',
        async (target, mode) => {
          const t = await setupWindow();
          await t.provision();
          const recorded =
            mode === 'recorded' ? await prepareRecordedBound(t) : undefined;
          const request = recorded ? await recorded.record() : t.request;
          const pause = pauseLeftSnapshot(1),
            from = f.commands.length;
          const pending = f.observe(
            f.left.itemCaptureStore.assessSourceReadWindow(request),
          );
          await pause.entered(); // The attempt and profile were read, but shared controls were not.
          if (target === 'gate') {
            await f.right.itemCaptureStore.revokeCopyGate({
              selector: request.anchor.preparation.selector,
              expectedGateRevision: request.expectedGateRevision,
              requestId: id(943),
              evidenceRef: 'test:window-gate-revocation',
            });
          } else if (target === 'reservation') {
            const changed = await f.right.rows.controls.collection.updateOne(
              { animalId: t.selected.animalId },
              { $inc: { reservationEpoch: 1 } },
            );
            expect(changed.modifiedCount).toBe(1);
          } else {
            await invalidate(f.right, target, t);
          }
          const saved = await f.snapshot(),
            fromFresh = f.commands.length;
          pause.release();
          expect(await pending).toMatchObject({
            value: {
              assessment: 'WINDOW_FITS',
              reservation: 'OBSERVED_ONLY',
              copyDispatch: 'NOT_AUTHORIZED',
              ...(recorded && { boundHash: recorded.bound.boundHash }),
            },
          });
          await expect(
            f.right.itemCaptureStore.assessSourceReadWindow(request),
          ).rejects.toThrow();
          expect(
            businessWrites(from).filter((write) => write.side === 'left'),
          ).toEqual([]);
          expect(businessWrites(fromFresh)).toEqual([]);
          expect(f.left.sourceReader.calls).toEqual([]);
          expect(f.right.sourceReader.calls).toEqual([]);
          recorded?.expectNoReads();
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      describe('recorded source bound', () => {
        it('observes no bound in the old snapshot after the other client records it', async () => {
          const t = await setupWindow();
          await t.provision();
          const recorded = await prepareRecordedBound(t);
          const pause = pauseLeftSnapshot(1),
            from = f.commands.length;
          const pending = f.observe(
            f.left.itemCaptureStore.assessSourceReadWindow(recorded.request),
          );
          await pause.entered();
          const current = await recorded.record(f.right);
          const saved = await f.snapshot(),
            fromFresh = f.commands.length;
          pause.release();
          expect(await pending).toHaveProperty(
            'error.message',
            'The historical source delegation bound is inconsistent',
          );
          await expect(
            f.right.itemCaptureStore.assessSourceReadWindow(recorded.request),
          ).rejects.toThrow('revision changed');
          await expect(
            f.right.itemCaptureStore.assessSourceReadWindow(current),
          ).resolves.toMatchObject({
            boundHash: recorded.bound.boundHash,
            reservation: 'OBSERVED_ONLY',
            copyDispatch: 'NOT_AUTHORIZED',
          });
          expect(
            businessWrites(from).filter((write) => write.side === 'left'),
          ).toEqual([]);
          expect(businessWrites(fromFresh)).toEqual([]);
          recorded.expectNoReads();
          expect(await f.snapshot()).toEqual(saved);
        });

        it.each([
          ['missing bound', 'delegation bound is inconsistent'],
          ['mismatched hash', 'delegation bound is inconsistent'],
          ['corrupt bound', 'delegation bound is inconsistent'],
          ['wrong signer', 'delegation bound is inconsistent'],
          ['exact deadline', 'delegation deadline has passed'],
          ['after deadline', 'delegation deadline has passed'],
          ['missing accreditation', 'operational accreditation is required'],
          ['margin reaches the limit', 'source read window is not established'],
        ] as const)(
          'rejects %s without writes or a fallback read',
          async (kind, message) => {
            const t = await setupWindow();
            if (kind !== 'missing accreditation') await t.provision();
            const recorded = await prepareRecordedBound(t, {
              ...(kind === 'wrong signer' && {
                signerContextHash: '0'.repeat(64),
              }),
              ...(kind === 'margin reaches the limit' && {
                lastReadAt: '2026-11-07T15:49:00.000Z',
              }),
            });
            const request =
              kind === 'missing bound'
                ? recorded.request
                : await recorded.record();
            if (kind === 'mismatched hash')
              request.expectedBoundHash = '0'.repeat(64);
            if (kind === 'corrupt bound') {
              const changed =
                await f.right.rows.copyRecords.collection.updateOne(
                  { id: request.attemptId },
                  { $set: { 'delegationBound.evidenceHash': '0'.repeat(64) } },
                );
              expect(changed.modifiedCount).toBe(1);
            }
            if (kind === 'exact deadline')
              f.right.sourceRetentionReader.observedAt =
                recorded.bound.delegateBefore;
            if (kind === 'after deadline')
              f.right.sourceRetentionReader.observedAt =
                '2026-11-07T15:20:00.001Z';
            const from = f.commands.length;
            await unchangedBefore(
              () => f.right.itemCaptureStore.assessSourceReadWindow(request),
              message,
            );
            expect(businessWrites(from)).toEqual([]);
            recorded.expectNoReads();
          },
        );
      });

      it.each([
        'missing bound',
        'foreign bound',
        'exact deadline',
        'missing accreditation',
        'gate revision',
        'attempt hash',
        'missing attempt',
        'corrupt attempt',
        'missing observation',
        'profile revision',
      ] as const)(
        'rejects %s without writing, persisting an assessment or reading objects',
        async (kind) => {
          const t = await setupWindow();
          if (kind !== 'missing accreditation') await t.provision();
          const request = { ...t.request };
          if (kind === 'missing bound') f.right.sourceReadBounds.delete(t.key);
          if (kind === 'foreign bound')
            f.right.sourceReadBounds.set(t.key, {
              ...t.bound,
              attemptDefinitionHash: '0'.repeat(64),
            });
          if (kind === 'exact deadline')
            f.right.sourceReadBounds.set(t.key, {
              ...t.bound,
              lastReadAt: '2026-11-07T15:49:00.000Z',
            });
          if (kind === 'gate revision') request.expectedGateRevision--;
          if (kind === 'attempt hash')
            request.expectedAttemptDefinitionHash = '0'.repeat(64);
          if (kind === 'profile revision')
            request.expectedProfile = {
              ...request.expectedProfile,
              revision: request.expectedProfile.revision + 1,
            };
          if (kind === 'missing attempt') {
            const removed = await f.right.rows.copyRecords.collection.deleteOne(
              { id: request.attemptId },
            );
            expect(removed.deletedCount).toBe(1);
          }
          if (kind === 'corrupt attempt') {
            const changed = await f.right.rows.copyRecords.collection.updateOne(
              { id: request.attemptId },
              { $set: { state: 'UNEXPECTED' } } as never,
            );
            expect(changed.modifiedCount).toBe(1);
          }
          if (kind === 'missing observation') {
            const changed = await f.right.rows.files.collection.updateOne(
              { id: request.anchor.preparation.fileId },
              { $unset: { sourceProfileObservationSet: '' } },
            );
            expect(changed.modifiedCount).toBe(1);
          }
          const from = f.commands.length;
          await unchangedBefore(() =>
            f.right.itemCaptureStore.assessSourceReadWindow(request),
          );
          expect(businessWrites(from)).toEqual([]);
          expect(f.right.sourceReader.calls).toEqual([]);
        },
      );
    });

    describe('source profile observation persistence', () => {
      const writeOrder = [
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animal_ownership_controls',
        ITEM_SOURCE_PROFILE_STATE_COLLECTION,
        ITEM_SOURCE_PROFILE_STATE_COLLECTION,
        'animal_ownership_archive_files',
      ];

      async function setupSet() {
        const t = await seedLinkedProfile();
        f.left.sourceReader.calls.length = 0;
        return {
          ...t,
          fileId: t.observationInput.anchor.preparation.fileId,
          prepare: (side = f.left) =>
            side.manifestPreparer.prepareHistoricalSourceProfile(
              t.observationInput,
            ),
        };
      }

      it('commits the whole set with both kinds of fences and replays it locally after invalidation', async () => {
        const t = await setupSet();
        await f.left.manifestPreparer.prepareHistoricalSourceRetention(
          t.observationInput.anchor,
        );
        const before = await f.snapshot(),
          from = f.commands.length;
        const client = f.left.connection.getClient();
        const startSession = client.startSession.bind(client);
        const sessions: mongo.ClientSession[] = [];
        jest.spyOn(client, 'startSession').mockImplementation((...args) => {
          const session = startSession(...args);
          sessions.push(session);
          return session;
        });
        f.left.sourceReader.assertOutsideTransaction = () => {
          expect(sessions.length).toBeGreaterThan(1);
          expect(sessions.every((session) => session.hasEnded)).toBe(true);
          expect(businessWrites(from)).toEqual([]);
        };
        const receipt = await t.prepare();
        expect(receipt).toMatchObject({
          replayed: false,
          observation: {
            fixedSource: { bytes: 'MATCH', eventHold: 'OFF' },
            storageObservation: { classification: 'STANDARD_IF_DIRECT_S3' },
            profileObservation: {
              profile: reference(t.first),
              reservation: 'OBSERVED_ONLY',
              copyDispatch: 'NOT_AUTHORIZED',
              businessCommit: 'NOT_AUTHORIZED',
            },
          },
        });
        expect(f.left.sourceReader.calls).toEqual(['READ', 'CLOSE']);
        const writes = businessWrites(from);
        expect(writes.map((write) => write.collection)).toEqual(writeOrder);
        const transaction = writes[0].transaction;
        expect(transaction).toBeDefined();
        expect(writes.every((write) => write.transaction === transaction)).toBe(
          true,
        );
        expect(f.commands.slice(from)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ transaction, snapshot: true }),
            expect.objectContaining({
              transaction,
              command: 'commitTransaction',
              majority: true,
            }),
          ]),
        );
        const saved = await f.snapshot();
        expect(saved.files).toEqual(
          (before.files as Array<{ id: string }>).map((row) =>
            row.id === t.fileId
              ? { ...row, sourceProfileObservationSet: receipt.observation }
              : row,
          ),
        );
        expect(saved.sourceProfileStates).toEqual(
          (before.sourceProfileStates as Array<{ _id: string }>).map((row) =>
            [t.first._id, t.shared._id].includes(row._id)
              ? { ...row, fenceRevision: 1 }
              : row,
          ),
        );
        expect(saved.archives).toEqual(before.archives);
        expect(saved.periods).toEqual(before.periods);
        expect(saved.animals).toEqual(before.animals);
        expect(saved.copyRecords).toEqual(before.copyRecords);
        await invalidate(f.right, 'controls', t);
        f.right.sourceRetentionReader.observedAt = '2028-01-01T00:00:00.000Z';
        const invalidated = await f.snapshot(),
          fromReplay = f.commands.length;
        await expect(t.prepare(f.right)).resolves.toEqual({
          ...receipt,
          replayed: true,
        });
        expect(f.right.sourceReader.calls).toEqual([]);
        expect(businessWrites(fromReplay)).toEqual([]);
        expect(await f.snapshot()).toEqual(invalidated);
      });

      it.each([
        ['CAPTURE_ADMISSION', 0],
        ['ITEM', 1],
        ['CLAIM', 2],
        ['FENCE', 3],
        ['SOURCE_PROFILE_SET_WRITE', 6],
      ] as const)(
        'rolls back the entire confirmation on %s failure',
        async (point, precedingWrites) => {
          const t = await setupSet();
          const from = f.commands.length;
          f.left.gate.fail = point;
          await unchangedBefore(() => t.prepare(), 'could not be acknowledged');
          expect(f.left.sourceReader.calls).toEqual(['READ', 'CLOSE']);
          expect(businessWrites(from).map((write) => write.collection)).toEqual(
            writeOrder.slice(0, precedingWrites),
          );
          expect(f.commands.slice(from)).toContainEqual(
            expect.objectContaining({
              side: 'left',
              command: 'abortTransaction',
            }),
          );
        },
      );

      it.each([
        ['PROFILE', 4],
        ['CONTROLS', 5],
      ] as const)(
        'rolls back preceding writes when the native %s fence is interrupted',
        async (target, precedingWrites) => {
          const t = await setupSet();
          const rows = f.left.sourceProfileRows;
          const update = rows.updateOne.bind(rows);
          jest
            .spyOn(rows, 'updateOne')
            .mockImplementation(async (filter, change, options) => {
              if (options?.session?.inTransaction() && filter.row === target)
                throw new Error('Injected failure before native profile fence');
              return update(filter, change, options);
            });
          const from = f.commands.length;
          await unchangedBefore(() => t.prepare(), 'could not be acknowledged');
          expect(businessWrites(from).map((write) => write.collection)).toEqual(
            writeOrder.slice(0, precedingWrites),
          );
          expect(f.commands.slice(from)).toContainEqual(
            expect.objectContaining({
              side: 'left',
              command: 'abortTransaction',
            }),
          );
        },
      );

      it.each(['same', 'different'] as const)(
        'preserves the first commit when a concurrent confirmation carries %s facts',
        async (kind) => {
          const t = await setupSet();
          if (kind === 'different')
            f.right.sourceRetentionReader.reportedRetainUntil =
              '2027-02-01T00:00:00.000Z';
          const pause = f.left.gate.arm('CAPTURE_ADMISSION');
          const pending = f.observe(t.prepare());
          await pause.entered();
          const winner = await t.prepare(f.right);
          expect(winner.replayed).toBe(false);
          const saved = await f.snapshot(),
            from = f.commands.length;
          pause.release();
          if (kind === 'same')
            expect(await pending).toEqual({
              value: { ...winner, replayed: true },
            });
          else
            expect(await pending).toHaveProperty(
              'error.message',
              expect.stringContaining('cannot be replaced'),
            );
          expect(businessWrites(from).map((write) => write.collection)).toEqual(
            ['animal_transfers'],
          );
          for (const side of [f.left, f.right])
            expect(side.sourceReader.calls).toEqual(['READ', 'CLOSE']);
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      it.each(['profile', 'controls'] as const)(
        'does not persist observations when %s invalidation wins against confirmation',
        async (target) => {
          const t = await setupSet(),
            pause = pauseCas();
          const pending = f.observe(t.prepare());
          await pause.entered();
          await invalidate(f.right, target, t);
          const saved = await f.snapshot();
          pause.release();
          expect(await pending).toHaveProperty(
            'error.message',
            expect.stringContaining(
              target === 'profile' ? 'profile is unavailable' : 'state changed',
            ),
          );
          expect(f.left.sourceReader.calls).toEqual(['READ', 'CLOSE']);
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      it.each([
        ['FENCE', 'reservation'],
        ['SOURCE_PROFILE_SET_WRITE', 'bytes'],
      ] as const)(
        'does not commit the set or fences when %s pauses and %s changes',
        async (point, prerequisite) => {
          const t = await setupSet(),
            pause = f.left.gate.arm(point);
          const pending = f.observe(t.prepare());
          await pause.entered();
          const changed =
            prerequisite === 'reservation'
              ? await f.right.rows.controls.collection.updateOne(
                  { animalId: t.selected.animalId },
                  { $inc: { reservationEpoch: 1 } },
                )
              : await f.right.rows.files.collection.updateOne(
                  { id: t.fileId },
                  { $unset: { sourceByteObservation: '' } },
                );
          expect(changed.modifiedCount).toBe(1);
          const saved = await f.snapshot();
          pause.release();
          expect(await pending).toHaveProperty('error');
          expect(f.left.sourceReader.calls).toEqual(['READ', 'CLOSE']);
          expect(await f.snapshot()).toEqual(saved);
        },
      );

      it('recovers the recorded set when the recognized confirmation reply is lost', async () => {
        const t = await setupSet(),
          pause = f.left.gate.arm('SOURCE_PROFILE_SET_OBSERVED');
        const pending = f.observe(t.prepare());
        await pause.entered();
        const from = f.commands.length;
        f.loseNextCommitReply(f.left);
        pause.release();
        expect(await pending).toMatchObject({ error: { status: 503 } });
        const writes = businessWrites(from);
        expect(writes.map((write) => write.collection)).toEqual(writeOrder);
        expect(f.commands.slice(from)).toContainEqual(
          expect.objectContaining({
            command: 'commitTransaction',
            transaction: writes[0].transaction,
            majority: true,
          }),
        );
        const file = await f.right.rows.files
          .findOne({ id: t.fileId })
          .lean()
          .exec();
        expect(
          file?.sourceProfileObservationSet?.profileObservation.reservation,
        ).toBe('OBSERVED_ONLY');
        const saved = await f.snapshot(),
          fromReplay = f.commands.length;
        await expect(t.prepare(f.right)).resolves.toEqual({
          observation: file?.sourceProfileObservationSet,
          replayed: true,
        });
        expect(businessWrites(fromReplay)).toEqual([]);
        expect(f.left.sourceReader.calls).toEqual(['READ', 'CLOSE']);
        expect(f.right.sourceReader.calls).toEqual([]);
        expect(await f.snapshot()).toEqual(saved);
      });

      it.each([
        'corrupt set',
        'different profile',
        'lost reservation',
      ] as const)(
        'rejects replay with %s before issuing another source read',
        async (kind) => {
          const t = await setupSet();
          await t.prepare();
          if (kind === 'corrupt set') {
            const changed = await f.right.rows.files.collection.updateOne(
              { id: t.fileId },
              {
                $unset: {
                  'sourceProfileObservationSet.storageObservation': '',
                },
              },
            );
            expect(changed.modifiedCount).toBe(1);
          }
          if (kind === 'lost reservation') {
            const changed = await f.right.rows.controls.collection.updateOne(
              { animalId: t.selected.animalId },
              { $inc: { reservationEpoch: 1 } },
            );
            expect(changed.modifiedCount).toBe(1);
          }
          const request = t.observationInput;
          const expectedProfile = {
            ...request.expectedProfile,
            revision:
              request.expectedProfile.revision +
              Number(kind === 'different profile'),
          };
          const from = f.commands.length;
          await unchangedBefore(() =>
            f.right.manifestPreparer.prepareHistoricalSourceProfile({
              ...request,
              expectedProfile,
            }),
          );
          expect(f.right.sourceReader.calls).toEqual([]);
          expect(businessWrites(from)).toEqual([]);
        },
      );
    });
  });

  describe('historical source retention report', () => {
    it('installs only the report with four fences and replays it after the reported date', async () => {
      const { anchor, files } = await f.seedHistoricalSourceAnchor(input);
      const file = files.find((row) => row.id === anchor.preparation.fileId)!;
      const before = await f.snapshot(),
        from = f.commands.length,
        reader = f.left.sourceRetentionReader;
      const start = f.left.connection.startSession.bind(f.left.connection);
      const sessions: Awaited<ReturnType<typeof start>>[] = [];
      jest
        .spyOn(f.left.connection, 'startSession')
        .mockImplementation(async (...args) => {
          const session = await start(...args);
          sessions.push(session);
          return session;
        });
      const readRetention = reader.readSourceRetention.bind(reader);
      jest
        .spyOn(reader, 'readSourceRetention')
        .mockImplementationOnce((target) => {
          expect(sessions.length).toBeGreaterThan(1);
          expect(sessions.every((session) => session.hasEnded)).toBe(true);
          expect(businessWrites(from)).toEqual([]);
          return readRetention(target);
        });
      const receipt =
        await f.left.manifestPreparer.prepareHistoricalSourceRetention(anchor);
      expect(receipt).toMatchObject({
        replayed: false,
        observation: {
          protocol: 'ITEM_HISTORICAL_SOURCE_RETENTION_OBSERVATION_V1',
          mode: 'COMPLIANCE',
          observedAt: reader.observedAt,
          reportedRetainUntil: reader.reportedRetainUntil,
          reservation: 'OBSERVED_ONLY',
          readability: 'NOT_ASSESSED',
          coverage: 'NOT_ASSESSED',
          stableCut: 'NOT_ASSESSED',
          retention: 'NOT_ASSESSED',
          copyDispatch: 'NOT_AUTHORIZED',
          businessCommit: 'NOT_AUTHORIZED',
        },
      });
      expect(reader.targets).toEqual([
        {
          bucket: anchor.preparation.bucket,
          key: file.sourceKey,
          versionId: file.source.versionId,
        },
      ]);
      const writes = businessWrites(from),
        transaction = writes[0].transaction;
      expect(writes.map((command) => command.collection)).toEqual([
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animal_ownership_controls',
        'animal_ownership_archive_files',
      ]);
      expect(transaction).toBeDefined();
      expect(
        writes.every((command) => command.transaction === transaction),
      ).toBe(true);
      expect(f.commands.slice(from)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ transaction, snapshot: true }),
          expect.objectContaining({
            transaction,
            command: 'commitTransaction',
            majority: true,
          }),
        ]),
      );
      const saved = await f.snapshot();
      expect(saved.files).toEqual(
        (before.files as Array<{ id: string }>).map((row) =>
          row.id === file.id
            ? { ...row, sourceRetentionObservation: receipt.observation }
            : row,
        ),
      );
      expect(saved.archives).toEqual(before.archives);
      expect(saved.periods).toEqual(before.periods);
      expect(saved.copyRecords).toEqual(before.copyRecords);
      const fromReplay = f.commands.length;
      f.right.sourceRetentionReader.observedAt = '2028-01-01T00:00:00.000Z';
      expect(
        await f.right.manifestPreparer.prepareHistoricalSourceRetention(anchor),
      ).toEqual({ ...receipt, replayed: true });
      expect(f.right.manifestPages).toEqual([]);
      expect(f.right.sourceRetentionReader.targets).toEqual([]);
      expect(businessWrites(fromReplay)).toEqual([]);
      expect(await f.snapshot()).toEqual(saved);
    });

    it.each([
      'CAPTURE_ADMISSION',
      'ITEM',
      'CLAIM',
      'FENCE',
      'SOURCE_RETENTION_WRITE',
    ] as const)(
      'rolls back the report and every fence on %s failure',
      async (point) => {
        const { anchor } = await f.seedHistoricalSourceAnchor(input);
        f.left.gate.fail = point;
        const from = f.commands.length;
        await unchangedBefore(
          () =>
            f.left.manifestPreparer.prepareHistoricalSourceRetention(anchor),
          'could not be acknowledged',
        );
        expect(f.left.sourceRetentionReader.targets).toHaveLength(1);
        expect(f.commands.slice(from)).toContainEqual(
          expect.objectContaining({
            side: 'left',
            command: 'abortTransaction',
          }),
        );
      },
    );

    it.each(['same', 'different'] as const)(
      'keeps the winning report when a competing confirmation carries %s facts',
      async (kind) => {
        const { anchor } = await f.seedHistoricalSourceAnchor(input);
        if (kind === 'different')
          f.right.sourceRetentionReader.reportedRetainUntil =
            '2027-02-01T00:00:00.000Z';
        const pause = f.left.gate.arm('CAPTURE_ADMISSION');
        const pending = f.observe(
          f.left.manifestPreparer.prepareHistoricalSourceRetention(anchor),
        );
        await pause.entered(); // The losing transaction read the empty report slot.
        const winner =
          await f.right.manifestPreparer.prepareHistoricalSourceRetention(
            anchor,
          );
        expect(winner.replayed).toBe(false);
        const saved = await f.snapshot(),
          from = f.commands.length;
        pause.release();
        const result = await pending;
        if (kind === 'same')
          expect(result).toEqual({ value: { ...winner, replayed: true } });
        else
          expect(result).toHaveProperty(
            'error.message',
            expect.stringContaining('cannot be replaced'),
          );
        expect(
          businessWrites(from).map((command) => command.collection),
        ).toEqual(['animal_transfers']);
        expect(f.left.sourceRetentionReader.targets).toHaveLength(1);
        expect(f.right.sourceRetentionReader.targets).toHaveLength(1);
        expect(await f.snapshot()).toEqual(saved);
      },
    );

    it('reconciles a lost application reply after the recognized report commit', async () => {
      const { anchor } = await f.seedHistoricalSourceAnchor(input);
      const pause = f.left.gate.arm('SOURCE_RETENTION_OBSERVED');
      const pending = f.observe(
        f.left.manifestPreparer.prepareHistoricalSourceRetention(anchor),
      );
      await pause.entered();
      const from = f.commands.length;
      f.loseNextCommitReply(f.left); // The next session belongs to confirmation.
      pause.release();
      expect(await pending).toMatchObject({ error: { status: 503 } });
      expect(f.commands.slice(from)).toContainEqual(
        expect.objectContaining({
          side: 'left',
          command: 'commitTransaction',
          majority: true,
        }),
      );
      const row = await f.right.rows.files
        .findOne({ id: anchor.preparation.fileId })
        .lean()
        .exec();
      expect(row?.sourceRetentionObservation).toMatchObject({
        reservation: 'OBSERVED_ONLY',
      });
      const saved = await f.snapshot(),
        fromReplay = f.commands.length;
      expect(
        await f.right.manifestPreparer.prepareHistoricalSourceRetention(anchor),
      ).toEqual({
        replayed: true,
        observation: row?.sourceRetentionObservation,
      });
      expect(f.left.sourceRetentionReader.targets).toHaveLength(1);
      expect(f.right.sourceRetentionReader.targets).toEqual([]);
      expect(businessWrites(fromReplay)).toEqual([]);
      expect(await f.snapshot()).toEqual(saved);
    });

    it.each([
      ['SOURCE_RETENTION_OBSERVED', 'digest'],
      ['SOURCE_RETENTION_OBSERVED', 'bytes'],
      ['SOURCE_RETENTION_OBSERVED', 'reservation'],
      ['FENCE', 'reservation'],
      ['SOURCE_RETENTION_WRITE', 'bytes'],
    ] as const)(
      'leaves no report or new fences when %s is paused and %s changes',
      async (point, kind) => {
        const { anchor, selected } = await f.seedHistoricalSourceAnchor(input);
        const pause = f.left.gate.arm(point);
        const pending = f.observe(
          f.left.manifestPreparer.prepareHistoricalSourceRetention(anchor),
        );
        await pause.entered();
        // Only mutate synthetic prerequisites that the paused transaction has not written.
        const rows = f.right.rows;
        const changed =
          kind === 'digest'
            ? await rows.archives.collection.updateOne(
                { id: selected.archiveId },
                { $unset: { manifestDigest: '' } },
              )
            : kind === 'bytes'
              ? await rows.files.collection.updateOne(
                  { id: anchor.preparation.fileId },
                  { $unset: { sourceByteObservation: '' } },
                )
              : await rows.controls.collection.updateOne(
                  { animalId: selected.animalId },
                  { $inc: { reservationEpoch: 1 } },
                );
        expect(changed.modifiedCount).toBe(1);
        const before = await f.snapshot(),
          from = f.commands.length;
        pause.release();
        expect(await pending).toHaveProperty('error');
        if (point === 'SOURCE_RETENTION_OBSERVED')
          expect(businessWrites(from)).toEqual([]);
        expect(f.left.sourceRetentionReader.targets).toHaveLength(1);
        expect(await f.snapshot()).toEqual(before);
      },
    );

    it.each(['wrong owner', 'null report'] as const)(
      'fails closed on replay with %s',
      async (kind) => {
        const { anchor } = await f.seedHistoricalSourceAnchor(input);
        await f.left.manifestPreparer.prepareHistoricalSourceRetention(anchor);
        if (kind === 'null report') {
          const changed = await f.right.rows.files.collection.updateOne(
            { id: anchor.preparation.fileId },
            { $set: { sourceRetentionObservation: null } } as never,
          );
          expect(changed.modifiedCount).toBe(1);
        }
        const from = f.commands.length;
        await unchangedBefore(
          () =>
            kind === 'wrong owner'
              ? f.right.itemCaptureStore.resumeSourceRetention({
                  anchor,
                  expectedBucketOwner: '987654321098',
                })
              : f.right.manifestPreparer.prepareHistoricalSourceRetention(
                  anchor,
                ),
          'identity is inconsistent',
        );
        expect(f.right.sourceRetentionReader.targets).toEqual([]);
        expect(businessWrites(from)).toEqual([]);
      },
    );
  });

  describe('historical source anchor', () => {
    async function rejectAfterTraversal(
      anchor: ItemHistoricalSourceAnchorInput,
      change: () => Promise<void>,
      message?: string,
    ) {
      const pause = f.left.gate.arm('HISTORICAL_SOURCE_ANCHOR');
      const pending = f.observe(
        f.left.manifestObserver.anchorHistoricalSource(anchor),
      );
      await pause.entered();
      expect(f.left.manifestPages.at(-1)).toEqual({ phase: 'COMPLETE' });
      await change();
      const before = await f.snapshot(),
        from = f.commands.length;
      pause.release();
      const result = await pending;
      expect(result).toHaveProperty('error');
      if (message)
        expect(result).toHaveProperty(
          'error.message',
          expect.stringContaining(message),
        );
      expect(businessWrites(from)).toEqual([]);
      expect(await f.snapshot()).toEqual(before);
    }

    it('anchors the last file across keyset pages and rereads its source in one final snapshot', async () => {
      const { anchor, source, archiveId } = await f.seedHistoricalSourceAnchor(
        input,
        103,
      );
      const before = await f.snapshot(),
        from = f.commands.length;
      const result =
        await f.right.manifestObserver.anchorHistoricalSource(anchor);
      const { anchorHash, ...definition } = result;
      expect(anchorHash).toBe(archiveHash(definition));
      expect(result).toMatchObject({
        protocol: 'ITEM_HISTORICAL_SOURCE_ANCHOR_V1',
        binding: {
          fileId: anchor.preparation.fileId,
          fileDefinitionHash: anchor.preparation.expectedFileDefinitionHash,
          observedSeal: { archiveId, expectedFileCount: 103 },
          observedSealHash: anchor.preparation.expectedSealHash,
        },
        manifestHash: anchor.expectedManifestHash,
        intentId: source.intentId,
        intentDefinitionHash: source.intentDefinitionHash,
        sourceObservationHash: source.observationHash,
        reservation: 'OBSERVED_ONLY',
        coverage: 'NOT_ASSESSED',
        provenance: 'NOT_ASSESSED',
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(f.right.manifestPages).toEqual([
        { phase: 'ENTRIES', count: 100 },
        { phase: 'ENTRIES', count: 3 },
        { phase: 'ENTRIES', count: 0 },
        { phase: 'FILES', count: 100 },
        { phase: 'FILES', count: 3 },
        { phase: 'FILES', count: 0 },
        { phase: 'COMPLETE' },
      ]);
      const commands = f.commands
        .slice(from)
        .filter((command) => command.side === 'right');
      const fileReads = commands.filter(
        (command) =>
          command.command === 'find' &&
          command.collection === 'animal_ownership_archive_files',
      );
      expect(fileReads).toHaveLength(4);
      const finalTransaction = fileReads.at(-1)?.transaction;
      expect(finalTransaction).toBeDefined();
      expect(
        fileReads
          .slice(0, -1)
          .every(
            (command) =>
              command.transaction !== undefined &&
              command.transaction !== finalTransaction,
          ),
      ).toBe(true);
      const finalReads = commands.filter(
        (command) =>
          command.command === 'find' &&
          command.transaction === finalTransaction,
      );
      expect(finalReads[0].snapshot).toBe(true);
      expect(finalReads.map((command) => command.collection)).toEqual([
        'animal_transfers',
        'animal_transfer_items',
        'animal_transfer_active_items',
        'animal_ownership_archives',
        'animal_ownership_controls',
        'animal_ownership_periods',
        'animal_ownership_periods',
        'animal_ownership_archive_files',
      ]);
      expect(JSON.stringify(result)).not.toMatch(
        /users\/|payload|sourceKey|sha256|leaseToken/,
      );
      expect(
        await f.left.manifestObserver.anchorHistoricalSource(anchor),
      ).toEqual(result);
      expect(businessWrites(from)).toEqual([]);
      expect(await f.snapshot()).toEqual(before);
      expect(f.left.sourceReader.calls).toEqual([
        'HEAD',
        'READ',
        'CLOSE',
        'HEAD',
      ]);
      expect(f.right.sourceReader.calls).toEqual([]);
      for (const side of [f.left, f.right]) {
        expect(side.historicalReader.calls).toEqual([]);
        expect(side.stagingReader.calls).toEqual([]);
      }
    });

    it('anchors after a server-sized short firstBatch and a genuine terminal empty page', async () => {
      const { anchor } = await f.seedHistoricalSourceAnchor(
        input,
        12,
        2 * 1024 * 1024,
      );
      const from = f.commands.length;
      expect(
        await f.right.manifestObserver.anchorHistoricalSource(anchor),
      ).toMatchObject({
        manifestHash: anchor.expectedManifestHash,
        reservation: 'OBSERVED_ONLY',
      });
      const entries = f.right.manifestPages.filter(
        (p) => p.phase === 'ENTRIES',
      );
      expect(entries[0].count).toBeGreaterThan(0);
      expect(entries[0].count).toBeLessThan(12);
      expect(entries.at(-1)?.count).toBe(0);
      expect(entries.reduce((n, page) => n + page.count!, 0)).toBe(12);
      expect(f.right.manifestPages.filter((p) => p.phase === 'FILES')).toEqual([
        { phase: 'FILES', count: 12 },
        { phase: 'FILES', count: 0 },
      ]);
      expect(f.right.manifestPages.at(-1)).toEqual({ phase: 'COMPLETE' });
      expect(
        f.commands.slice(from).some((command) => command.command === 'getMore'),
      ).toBe(false);
      expect(businessWrites(from)).toEqual([]);
      expect(f.right.sourceReader.calls).toEqual([]);
    });

    it.each(['file-id', 'definition-hash', 'manifest-hash'] as const)(
      'rejects a mismatched %s before the final source lookup',
      async (pin) => {
        const { anchor } = await f.seedHistoricalSourceAnchor(input);
        const altered = { ...anchor, preparation: { ...anchor.preparation } };
        if (pin === 'file-id') altered.preparation.fileId = 'a'.repeat(64);
        if (pin === 'definition-hash')
          altered.preparation.expectedFileDefinitionHash = 'b'.repeat(64);
        if (pin === 'manifest-hash')
          altered.expectedManifestHash = 'c'.repeat(64);
        const read = jest.spyOn(
          f.right.itemCaptureStore,
          'readHistoricalSourceForAnchor',
        );
        await unchangedBefore(
          () => f.right.manifestObserver.anchorHistoricalSource(altered),
          'expected manifest traversal',
        );
        expect(f.right.manifestPages.at(-1)).toEqual({ phase: 'COMPLETE' });
        expect(read).not.toHaveBeenCalled();
      },
    );

    it('rejects the old digest if a different file changes under the same seal', async () => {
      const { anchor, files, archiveId } =
        await f.seedHistoricalSourceAnchor(input);
      const other = files.find(
        (file) => file.id !== anchor.preparation.fileId,
      )!;
      const archive = (await f.right.rows.archives
        .findOne({ id: archiveId })
        .lean()
        .exec())!;
      const definition = captureItemArchiveFileDefinition(archive, other);
      const source = {
        ...definition.source,
        versionId: 'changed-unselected-file',
      };
      const changed = await f.right.rows.files.collection.updateOne(
        { id: other.id },
        {
          $set: {
            source,
            definitionHash: archiveHash({ ...definition, source }),
          },
        },
      );
      expect(changed.modifiedCount).toBe(1);
      const read = jest.spyOn(
        f.left.itemCaptureStore,
        'readHistoricalSourceForAnchor',
      );
      await unchangedBefore(
        () => f.left.manifestObserver.anchorHistoricalSource(anchor),
        'expected manifest traversal',
      );
      expect(read).not.toHaveBeenCalled();
    });

    it('cannot anchor a file in an explicitly complete zero-file manifest', async () => {
      const { manifest } = await f.seedManifest(input, 1, false);
      const digest = await f.left.manifestPreparer.prepare(manifest);
      const read = jest.spyOn(
        f.right.itemCaptureStore,
        'readHistoricalSourceForAnchor',
      );
      await unchangedBefore(
        () =>
          f.right.manifestObserver.anchorHistoricalSource({
            preparation: {
              ...manifest,
              fileId: 'a'.repeat(64),
              expectedFileDefinitionHash: 'b'.repeat(64),
              bucket: 'synthetic-archive-bucket',
              sourceSha256: 'c'.repeat(64),
            },
            expectedManifestHash: digest.manifestHash,
          }),
        'expected manifest traversal',
      );
      expect(f.right.manifestPages).toEqual([
        { phase: 'ENTRIES', count: 1 },
        { phase: 'ENTRIES', count: 0 },
        { phase: 'FILES', count: 0 },
        { phase: 'COMPLETE' },
      ]);
      expect(read).not.toHaveBeenCalled();
    });

    it.each(['manifest', 'source', 'intent'] as const)(
      'rejects a %s removed after traversal by the second client',
      async (kind) => {
        const { anchor, archiveId } = await f.seedHistoricalSourceAnchor(input);
        await rejectAfterTraversal(
          anchor,
          async () => {
            const updated =
              kind === 'manifest'
                ? await f.right.rows.archives.collection.updateOne(
                    { id: archiveId },
                    { $unset: { manifestDigest: '' } },
                  )
                : await f.right.rows.files.collection.updateOne(
                    { id: anchor.preparation.fileId },
                    {
                      $unset: {
                        [kind === 'source'
                          ? 'sourceByteObservation'
                          : 'historicalCopyIntent']: '',
                      },
                    },
                  );
            expect(updated.modifiedCount).toBe(1);
          },
          kind === 'intent'
            ? 'Source byte observation identity'
            : 'requires a persisted manifest and source byte observation',
        );
      },
    );

    it.each(['manifest', 'source'] as const)(
      'rejects a self-consistent %s substitution after traversal',
      async (kind) => {
        const { anchor, archiveId } = await f.seedHistoricalSourceAnchor(input);
        await rejectAfterTraversal(
          anchor,
          async () => {
            if (kind === 'manifest') {
              const header = await f.right.rows.archives
                .findOne({ id: archiveId })
                .lean()
                .exec();
              const { manifestHash, ...original } = header!.manifestDigest!;
              const changed = { ...original, entriesDigest: 'b'.repeat(64) };
              const next = archiveHash(changed);
              expect(next).not.toBe(manifestHash);
              expect(
                (
                  await f.right.rows.archives.collection.updateOne(
                    { id: archiveId },
                    {
                      $set: {
                        manifestDigest: { ...changed, manifestHash: next },
                      },
                    },
                  )
                ).modifiedCount,
              ).toBe(1);
            } else {
              const filter = { id: anchor.preparation.fileId };
              const file = await f.right.rows.files
                .findOne(filter)
                .lean()
                .exec();
              const previous = file!.sourceByteObservation!;
              const observation = {
                ...previous.observation,
                revision: {
                  ...previous.observation.revision,
                  versionId: 'different-source',
                },
              };
              expect(
                (
                  await f.right.rows.files.collection.updateOne(filter, {
                    $set: {
                      sourceByteObservation: {
                        ...previous,
                        observation,
                        observationHash: archiveHash(observation),
                      },
                    },
                  })
                ).modifiedCount,
              ).toBe(1);
            }
          },
          kind === 'manifest'
            ? 'persisted manifest hash changed'
            : 'Source byte observation identity',
        );
      },
    );

    it.each(['epoch', 'claim', 'request', 'seal', 'period', 'lease'] as const)(
      'revalidates %s between the terminal traversal and the final source snapshot',
      async (kind) => {
        const { anchor, archiveId, selected } =
          await f.seedHistoricalSourceAnchor(input);
        await rejectAfterTraversal(anchor, async () => {
          const rows = f.right.rows;
          if (kind === 'epoch')
            await rows.controls.collection.updateOne(
              { animalId: selected.animalId },
              { $inc: { reservationEpoch: 1 } },
            );
          if (kind === 'claim')
            await rows.claims.collection.updateOne(
              { _id: selected.animalId } as never,
              { $set: { acceptanceOperationId: id(90) } },
            );
          if (kind === 'request')
            await rows.requests.collection.updateOne(
              { _id: input.transferId } as never,
              { $inc: { version: 1 } },
            );
          if (kind === 'seal')
            await rows.archives.collection.updateOne(
              { id: archiveId },
              { $inc: { 'capture.revision': 1 } },
            );
          if (kind === 'period')
            await rows.periods.collection.deleteOne({
              animalId: selected.animalId,
              status: 'ACTIVE',
            });
          if (kind === 'lease')
            await rows.files.collection.updateOne(
              { id: anchor.preparation.fileId },
              { $set: { leaseToken: 'synthetic-lease' } },
            );
        });
      },
    );

    it('denies the anchor before the final source lookup if invalidation wins at the empty file page', async () => {
      const { anchor, selected } = await f.seedHistoricalSourceAnchor(input);
      const read = jest.spyOn(
        f.left.itemCaptureStore,
        'readHistoricalSourceForAnchor',
      );
      const pause = f.left.gate.arm('MANIFEST_TERMINAL');
      const pending = f.observe(
        f.left.manifestObserver.anchorHistoricalSource(anchor),
      );
      await pause.entered();
      await f.right.rows.controls.collection.updateOne(
        { animalId: selected.animalId },
        { $inc: { reservationEpoch: 1 } },
      );
      const before = await f.snapshot();
      pause.release();
      expect(await pending).toHaveProperty('error');
      expect(read).not.toHaveBeenCalled();
      expect(await f.snapshot()).toEqual(before);
    });

    it('returns an older observation if the final snapshot started before removal, then rejects a fresh read', async () => {
      const { anchor } = await f.seedHistoricalSourceAnchor(input);
      const original =
        await f.right.manifestObserver.anchorHistoricalSource(anchor);
      const pause = f.left.gate.arm('HISTORICAL_SNAPSHOT');
      const pending = f.observe(
        f.left.manifestObserver.anchorHistoricalSource(anchor),
      );
      await pause.entered(); // The final tx has read the header and control, but has not queried the file yet.
      expect(
        (
          await f.right.rows.files.collection.updateOne(
            { id: anchor.preparation.fileId },
            { $unset: { sourceByteObservation: '' } },
          )
        ).modifiedCount,
      ).toBe(1);
      const before = await f.snapshot(),
        from = f.commands.length;
      pause.release();
      expect(await pending).toEqual({ value: original });
      await expect(
        f.right.manifestObserver.anchorHistoricalSource(anchor),
      ).rejects.toThrow(
        'requires a persisted manifest and source byte observation',
      );
      expect(businessWrites(from)).toEqual([]);
      expect(await f.snapshot()).toEqual(before);
    });

    it('does not return a successful anchor when the application observes an error after closing the final session', async () => {
      const { anchor } = await f.seedHistoricalSourceAnchor(input);
      const pause = f.left.gate.arm('HISTORICAL_SOURCE_ANCHOR');
      const pending = f.observe(
        f.left.manifestObserver.anchorHistoricalSource(anchor),
      );
      await pause.entered();
      const start = f.left.connection.startSession.bind(f.left.connection);
      let ended = false;
      jest
        .spyOn(f.left.connection, 'startSession')
        .mockImplementationOnce(async (...args) => {
          const session = await start(...args),
            end = session.endSession.bind(session);
          jest
            .spyOn(session, 'endSession')
            .mockImplementationOnce(async (...endArgs) => {
              await end(...endArgs);
              ended = true;
              throw new Error(
                'Injected application error after final source session close',
              );
            });
          return session;
        });
      const before = await f.snapshot(),
        from = f.commands.length;
      pause.release();
      expect(await pending).toMatchObject({ error: { status: 503 } });
      expect(ended).toBe(true);
      expect(businessWrites(from)).toEqual([]);
      expect(await f.snapshot()).toEqual(before);
    });

    it('rejects caller-supplied anchor evidence before any Mongo command', async () => {
      const { anchor } = await f.seedHistoricalSourceAnchor(input);
      const from = f.commands.length;
      await expect(
        f.right.manifestObserver.anchorHistoricalSource({
          ...anchor,
          sourceObservation: { bytes: 'MATCH' },
        } as never),
      ).rejects.toThrow('Invalid historical source anchor input');
      expect(f.commands).toHaveLength(from);
      expect(f.right.manifestPages).toEqual([]);
    });

    it('uses the original pins when the caller mutates input before the final source read', async () => {
      const { anchor } = await f.seedHistoricalSourceAnchor(input);
      const mutable = {
        ...anchor,
        preparation: {
          ...anchor.preparation,
          selector: { ...anchor.preparation.selector },
        },
      };
      const pause = f.left.gate.arm('HISTORICAL_SOURCE_ANCHOR');
      const pending = f.observe(
        f.left.manifestObserver.anchorHistoricalSource(mutable),
      );
      await pause.entered();
      mutable.preparation.selector.itemId = id(90);
      mutable.preparation.fileId = 'a'.repeat(64);
      mutable.preparation.bucket = 'different-bucket';
      mutable.expectedManifestHash = 'c'.repeat(64);
      pause.release();
      expect(await pending).toMatchObject({
        value: {
          manifestHash: anchor.expectedManifestHash,
          binding: { fileId: anchor.preparation.fileId },
          copyDispatch: 'NOT_AUTHORIZED',
        },
      });
    });
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
