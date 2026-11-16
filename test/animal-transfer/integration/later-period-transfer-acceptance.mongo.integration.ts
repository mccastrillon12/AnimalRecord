import {
  GetObjectCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { PutVersionAuditSelectionReader } from '../../../src/context/animal-transfer/application/put-version-audit-selection';
import { PublishedOwnershipHistoryDownloader } from '../../../src/context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { publishedHistoryFinalCoverageSelection } from '../../../src/context/animal-transfer/domain/published-history-final-coverage';
import { buildPublishedHistoryFinalPermission } from '../../../src/context/animal-transfer/domain/published-history-final-permission';
import { publishedHistoryFinalPutVersionScope } from '../../../src/context/animal-transfer/domain/published-history-final-reconciliation';
import {
  ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
  itemSourceControlsHash,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-item-source-profile-state';
import { MongoOwnershipArchiveHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { ITEM_PUT_AUDIT_METADATA } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { AwsPutVersionEvidencePublication } from '../../../src/context/animal-transfer/infrastructure/storage/aws-put-version-evidence-publication';
import { AwsPutVersionEvidenceReconciliation } from '../../../src/context/animal-transfer/infrastructure/storage/aws-put-version-evidence-reconciliation';
import { s3CreatedPutNotificationsKey } from '../../../src/context/animal-transfer/infrastructure/storage/aws-s3-created-put-notifications';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';
import { restoreNodeDisposeSymbolForSuite } from './support/restore-node-dispose-symbol';
import {
  type AcceptanceSide,
  TransferAcceptanceMongoFixture,
} from './support/transfer-acceptance-mongo-fixture';
import { readAcceptanceMongoSettings } from './support/transfer-acceptance-mongo-safety';

type Dossier = Awaited<ReturnType<typeof publishedLaterPeriod>>;
type ClosePins = Dossier['commitSelection'];

function activeControls(purpose: string) {
  const generationId = randomUUID();
  const configurationHash = archiveHash(purpose);
  return {
    _id: itemSourceControlsHash(generationId, configurationHash),
    protocol: ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
    row: 'CONTROLS',
    state: 'ACTIVE',
    generationId,
    configurationHash,
  } as const;
}

/** Seed the same original decision with two sealed dossiers. Evidence and file contents are synthetic. */
async function seedSecondTransfer(fixture: TransferAcceptanceMongoFixture) {
  const input = await fixture.seedAcceptance(3, '2026-10-29T11:59:00.000Z');
  const dossiers = await Promise.all(
    ([0, 1] as const).map(async (selectedIndex) => {
      const retained = activeControls('synthetic retained conservation');
      const live = activeControls('synthetic second-period photo conservation');
      const dossier = await publishedLaterPeriod('processing', {
        bothLater: true,
        selectedIndex,
        controls: { retained: retained._id, live: live._id },
      });
      return { dossier, retained, live };
    }),
  );
  await fixture.left.sourceProfileRows.insertMany(
    dossiers.flatMap(({ retained, live }) => [retained, live]),
    { writeConcern: { w: 'majority' } },
  );
  const [first, second] = dossiers.map(({ dossier }) => dossier);
  const rows = fixture.left.rows;
  const { _id, ...decision } = first.state.db.requests[0];
  expect(_id).toBe(input.transferId);
  expect(decision.acceptanceStart).toEqual(
    second.state.db.requests[0].acceptanceStart,
  );
  expect(
    await rows.requests
      .updateOne(
        { _id: input.transferId, status: 'PENDING' },
        { $set: decision },
      )
      .exec(),
  ).toMatchObject({ modifiedCount: 1 });
  await rows.users.collection.updateOne(
    { id: input.actorId },
    { $set: { transferRequestRevision: 1 } },
  );
  for (const dossier of [first, second]) {
    const { animalId, itemId } = dossier.expectedReceipt;
    const db = dossier.state.db;
    await rows.requests.create([dossier.predecessorRequest], { w: 'majority' });
    await rows.items.create([dossier.predecessorItem], { w: 'majority' });
    const { _id: seedItemId, ...item } = db.items.find(
      (row) => row._id === itemId,
    )!;
    expect(
      await rows.items
        .updateOne(
          { _id: String(seedItemId), status: 'PENDING' },
          { $set: item },
        )
        .exec(),
    ).toMatchObject({ modifiedCount: 1 });
    expect(
      await rows.claims
        .updateOne(
          { _id: animalId, transferId: input.transferId },
          { $set: { acceptanceOperationId: input.operationId } },
        )
        .exec(),
    ).toMatchObject({ modifiedCount: 1 });
    const control = db.controls.find((row) => row.animalId === animalId)!;
    expect(
      await rows.controls.collection.updateOne({ animalId }, { $set: control }),
    ).toMatchObject({ modifiedCount: 1 });
    const animal = Object.fromEntries(
      Object.entries(dossier.live.animal).filter(
        ([, value]) => value !== undefined,
      ),
    );
    expect(
      await rows.animals.collection.updateOne(
        { id: animalId },
        { $set: animal },
      ),
    ).toMatchObject({ modifiedCount: 1 });
    const periods = db.periods.filter((row) => row.animalId === animalId);
    expect(
      await rows.periods.collection.updateOne(
        { animalId, status: 'ACTIVE' },
        {
          $set: {
            ...periods.find((row) => row.status === 'ACTIVE'),
            startProvenance: 'TRANSFER',
          },
        },
      ),
    ).toMatchObject({ modifiedCount: 1 });
    await rows.periods.collection.insertOne({
      ...periods.find((row) => row.status === 'CLOSED'),
      startedAtKnown: false,
      startProvenance: 'UNKNOWN',
    });
    await rows.archives.collection.insertMany(
      db.archives.filter((row) => row.animalId === animalId),
    );
    await rows.entries.collection.insertMany(
      db.entries.map((entry) => ({ ...entry })),
    );
    await rows.files.collection.insertMany(db.files);
    // The driver adds _id in place. Keep the hashed projection's registrations intact.
    await rows.registrations.collection.insertMany(
      db.registrations.map((registration) => ({ ...registration })),
    );
    await rows.copyRecords.collection.insertMany(
      db.copyRecords.map((record) => ({ ...record })),
    );
  }
  const rejected = first.state.db.items.find(
    (row) => row.status === 'REJECTED',
  )!;
  expect(
    await rows.items
      .updateOne(
        { _id: String(rejected._id), status: 'PENDING' },
        { $set: { status: 'REJECTED' } },
      )
      .exec(),
  ).toMatchObject({ modifiedCount: 1 });
  expect(
    await rows.claims.deleteOne({ _id: String(rejected.animalId) }).exec(),
  ).toMatchObject({ deletedCount: 1 });
  return { first, second, input };
}

function closeOn(side: AcceptanceSide, now: Dossier['now']) {
  const { rows, archiveSource, sourceProfiles: controls } = side;
  const store = new MongoTransferItemCapture(
    rows.requests,
    rows.items,
    rows.claims,
    rows.archives,
    rows.controls,
    rows.periods,
    rows.files,
    rows.entries,
    rows.copyRecords,
    { profiles: controls, now },
    rows.registrations,
  );
  const history = new MongoOwnershipArchiveHistory(
    rows.archives,
    rows.entries,
    rows.files,
    rows.periods,
    rows.controls,
    store,
    { controls, now, accreditationFor: () => null },
    rows.registrations,
    rows.copyRecords,
  );
  return {
    store,
    history,
    commit: (dossier: Dossier) =>
      store.commitLaterPeriodItemOwnership(
        dossier.commitSelection,
        dossier.urls,
        archiveSource,
        history,
        rows,
      ),
    read: (pins: ClosePins) => store.readLaterPeriodItemOwnershipCommit(pins),
  };
}

describe('Opt-in Mongo ownership commit of a later period', () => {
  let fixture: TransferAcceptanceMongoFixture;
  let seed: Awaited<ReturnType<typeof seedSecondTransfer>>;
  restoreNodeDisposeSymbolForSuite();
  beforeEach(async () => {
    fixture = new TransferAcceptanceMongoFixture();
    await fixture.open(readAcceptanceMongoSettings(process.env));
    seed = await seedSecondTransfer(fixture);
  });
  afterEach(async () => {
    try {
      await fixture.close();
    } finally {
      jest.restoreAllMocks();
    }
  });

  async function prepareRetainedPutEvidence(first: Dossier) {
    const file = first.retainedFile;
    const { binding } = first.retainedScope;
    const requiredThrough = binding.requiredThrough;
    const beforeVersion = file.publishedHistoryFinalPutVersion;
    const declaration = file.publishedHistoryFinalPutDeclaration;
    const original = file.publishedHistoryFinalPutPermission;
    const marker = 'a'.repeat(64);
    const auditMarkerHash = archiveHash(marker);
    const selection = {
      ...publishedHistoryFinalCoverageSelection(
        {
          archiveId: binding.archiveId,
          expectedArchiveDefinitionHash: binding.archiveDefinitionHash,
          expectedReservationEpoch: binding.reservationEpoch,
          expectedPublicationHash: binding.publicationHash,
          expectedSourceManifestHash: binding.sourceManifestHash,
          requiredThrough,
        },
        file,
      ),
      auditMarkerHash,
    };
    const permission = buildPublishedHistoryFinalPermission(
      selection,
      declaration,
      {
        openedArtifactSeal: original.artifact,
        transportRequestHash: original.transportRequestHash,
        auditMarkerHash,
      },
      original.admittedAt,
    );
    const filter = { archiveId: file.archiveId, id: file.id };
    // Start with MAY_RUN and its predecessors, before the final version was observed.
    expect(
      await fixture.left.rows.files
        .updateOne(filter, {
          $set: { publishedHistoryFinalPutPermission: permission },
          $unset: { publishedHistoryFinalPutVersion: '' },
        })
        .exec(),
    ).toMatchObject({ modifiedCount: 1 });

    const { target } = publishedHistoryFinalPutVersionScope({
      definition: declaration.attempt,
      permission,
    });
    const { revision } = beforeVersion.observation;
    const { versionId } = revision;
    if (!versionId)
      throw new Error('Expected an explicit synthetic PUT version');
    const notFound = () =>
      new NoSuchKey({
        message: 'Synthetic versioned object absent',
        $metadata: { httpStatusCode: 404 },
      });
    const ok = { $metadata: { httpStatusCode: 200 } };
    const read = (bytes: Buffer, versionId: string) => ({
      ...ok,
      VersionId: versionId,
      ContentLength: bytes.length,
      Body: Readable.from([bytes]),
    });
    const feed = {
      auditBucket: 'synthetic-put-notifications',
      auditBucketOwner: '123456789013',
      sourceBucket: target.bucket,
      sourceBucketOwner: target.expectedBucketOwner,
      sourceRegion: 'us-east-1',
      notificationConfigurationId: 'synthetic-retained-put',
      maxBytes: 4096,
    };
    const reportConfig = {
      bucket: 'synthetic-put-evidence',
      bucketOwner: '123456789014',
      issuerId: beforeVersion.evidence.issuerId,
      maxBytes: 4096,
    };
    const auditKey = s3CreatedPutNotificationsKey(target);
    const event = Buffer.from(
      JSON.stringify({
        sourceBucketOwner: target.expectedBucketOwner,
        Records: [
          {
            eventVersion: '2.6',
            eventSource: 'aws:s3',
            eventName: 'ObjectCreated:Put',
            awsRegion: feed.sourceRegion,
            eventTime: permission.admittedAt,
            responseElements: {
              'x-amz-request-id': 'synthetic-retained-final',
            },
            s3: {
              s3SchemaVersion: '1.0',
              configurationId: feed.notificationConfigurationId,
              bucket: {
                name: target.bucket,
                arn: `arn:aws:s3:::${target.bucket}`,
              },
              object: {
                key: encodeURIComponent(target.key),
                size: revision.size,
                eTag: revision.etag.replace(/^"|"$/g, ''),
                versionId: revision.versionId,
              },
            },
          },
        ],
      }),
    );
    const reports = new Map<string, Buffer>();
    let eventAvailable = false;
    type Command =
      | GetObjectCommand
      | GetObjectRetentionCommand
      | HeadObjectCommand
      | PutObjectCommand;
    const respond = (command: Command) => {
      const { Bucket, Key } = command.input;
      if (
        Bucket === feed.auditBucket &&
        Key === auditKey &&
        command instanceof GetObjectCommand
      ) {
        if (!eventAvailable) throw notFound();
        return read(event, 'notification-version');
      }
      if (
        Bucket === reportConfig.bucket &&
        typeof Key === 'string' &&
        Key.startsWith('put-version-evidence/v1/')
      ) {
        if (command instanceof PutObjectCommand) {
          if (
            command.input.IfNoneMatch !== '*' ||
            !Buffer.isBuffer(command.input.Body) ||
            reports.has(Key)
          )
            throw new Error('Expected one conditional report archive write');
          reports.set(Key, command.input.Body);
          return { ...ok, VersionId: 'report-version' };
        }
        if (command instanceof GetObjectCommand) {
          const body = reports.get(Key);
          if (!body) throw notFound();
          return read(body, 'report-version');
        }
      }
      if (
        Bucket === target.bucket &&
        Key === target.key &&
        !(command instanceof PutObjectCommand)
      ) {
        expect(command.input).toMatchObject({
          ExpectedBucketOwner: target.expectedBucketOwner,
          VersionId: revision.versionId,
        });
        if (command instanceof GetObjectRetentionCommand)
          return {
            ...ok,
            Retention: {
              Mode: 'COMPLIANCE',
              RetainUntilDate: new Date(beforeVersion.evidence.validUntil),
            },
          };
        expect(command.input.IfMatch).toBe(revision.etag);
        if (command instanceof HeadObjectCommand)
          return {
            ...ok,
            VersionId: revision.versionId,
            ETag: revision.etag,
            ContentLength: revision.size,
            Metadata: { [ITEM_PUT_AUDIT_METADATA]: marker },
          };
        return {
          ...read(first.bytes, versionId),
          ETag: revision.etag,
        };
      }
      throw new Error('Unexpected synthetic S3 operation');
    };
    const send = jest.fn((command: Command) =>
      Promise.resolve().then(() => respond(command)),
    );
    const client = { send } as unknown as Pick<S3Client, 'send'>;
    const left = closeOn(fixture.left, first.now);
    const publication = new AwsPutVersionEvidencePublication(
      new PutVersionAuditSelectionReader(left.store, left.history),
      {
        notificationArchive: client,
        objectVersions: client,
        evidenceArchive: client,
      },
      {
        notificationArchive: feed,
        evidenceArchive: reportConfig,
        conservationControlsHash: first.originalControlsHash,
      },
      first.now,
    );
    const reconcileOn = (side: AcceptanceSide) => {
      const { store, history } = closeOn(side, first.now);
      return new AwsPutVersionEvidenceReconciliation(
        store,
        history,
        client,
        client,
        { evidenceArchive: reportConfig, objectVersions: target },
        first.now,
      );
    };
    const pins = {
      protocol: beforeVersion.evidence.protocol,
      selection,
      expectedPermissionHash: permission.permissionHash,
    };
    return {
      pins,
      publication,
      reconcileOn,
      requiredThrough,
      send,
      reports,
      revision,
      deliverEvent: () => {
        eventAvailable = true;
      },
      readFile: () => fixture.right.rows.files.findOne(filter).lean().exec(),
    };
  }

  it('replays the retained final PUT receipt after the acknowledged Mongo recording loses its reply', async () => {
    const t = await prepareRetainedPutEvidence(seed.first);
    const before = await fixture.snapshot();
    await expect(
      t.publication.publish(t.pins, t.requiredThrough),
    ).resolves.toBeNull();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.reports.size).toBe(0);
    t.deliverEvent();
    const receipt = await t.publication.publish(t.pins, t.requiredThrough);
    if (!receipt) throw new Error('Expected synthetic evidence publication');
    expect(t.reports.size).toBe(1);
    expect(await fixture.snapshot()).toEqual(before);
    const from = fixture.commands.length;
    fixture.loseNextCommitReply(fixture.left);
    await expect(
      t
        .reconcileOn(fixture.left)
        .reconcileAndRecord(t.pins, receipt, t.requiredThrough),
    ).rejects.toThrow('Injected application commit reply loss');
    const commands = fixture.commands.slice(from);
    const writes = commands.filter(({ command }) =>
      ['insert', 'update', 'delete', 'findAndModify'].includes(command),
    );
    expect(writes.map(({ collection }) => collection)).toEqual([
      fixture.left.sourceProfileRows.collectionName,
      fixture.left.rows.files.collection.name,
    ]);
    const transaction = writes[0].transaction;
    expect(transaction).toBeDefined();
    expect(writes.every((write) => write.transaction === transaction)).toBe(
      true,
    );
    expect(commands).toContainEqual(
      expect.objectContaining({
        side: 'left',
        command: 'commitTransaction',
        transaction,
        majority: true,
      }),
    );
    const saved = (await t.readFile())?.publishedHistoryFinalPutVersion;
    expect(saved).toMatchObject({
      observation: { evidenceHash: receipt.evidenceHash, revision: t.revision },
      evidence: { scopeHash: receipt.scopeHash },
    });
    const calls = t.send.mock.calls.length;
    const after = await fixture.snapshot();
    await expect(
      t
        .reconcileOn(fixture.right)
        .reconcileAndRecord(t.pins, receipt, t.requiredThrough),
    ).resolves.toEqual(saved);
    expect(t.send).toHaveBeenCalledTimes(calls);
    expect(t.reports.size).toBe(1);
    expect(await fixture.snapshot()).toEqual(after);
  });

  it('rejects a different original reservation epoch in publication and reconciliation', async () => {
    const t = await prepareRetainedPutEvidence(seed.first);
    const { staging } = t.pins.selection;
    const changed = {
      ...t.pins,
      selection: {
        ...t.pins.selection,
        staging: {
          ...staging,
          selection: {
            ...staging.selection,
            expectedReservationEpoch:
              staging.selection.expectedReservationEpoch + 1,
          },
        },
      },
    };
    const before = await fixture.snapshot();
    t.deliverEvent();
    await expect(
      t.publication.publish(changed, t.requiredThrough),
    ).rejects.toThrow('recorded PUT permission');
    expect(t.send).not.toHaveBeenCalled();
    const receipt = await t.publication.publish(t.pins, t.requiredThrough);
    if (!receipt) throw new Error('Expected synthetic evidence publication');
    const calls = t.send.mock.calls.length;
    await expect(
      t
        .reconcileOn(fixture.right)
        .reconcileAndRecord(changed, receipt, t.requiredThrough),
    ).rejects.toThrow('under the exact permission');
    expect(t.send).toHaveBeenCalledTimes(calls);
    expect(await fixture.snapshot()).toEqual(before);
  });

  async function assertPeriodRotation(receipt: Dossier['expectedReceipt']) {
    const periods = await fixture.right.rows.periods
      .find({ animalId: receipt.animalId })
      .sort({ ownershipVersion: 1 })
      .lean()
      .exec();
    expect(periods).toMatchObject([
      { ownershipVersion: 1, status: 'CLOSED' },
      {
        id: receipt.closedPeriodId,
        ownerId: receipt.previousOwnerId,
        ownershipVersion: 2,
        status: 'CLOSED',
        endedAt: receipt.effectiveAt,
        archiveId: receipt.archiveId,
      },
      {
        id: receipt.activePeriodId,
        ownerId: receipt.ownerId,
        ownershipVersion: 3,
        status: 'ACTIVE',
        startedAt: receipt.effectiveAt,
        sourceTransferId: receipt.transferId,
      },
    ]);
  }

  it('closes and opens ownership in the same snapshot/majority transaction under the installed unique index', async () => {
    const { first } = seed;
    const r = fixture.right.rows;
    expect(await r.periods.listIndexes()).toContainEqual(
      expect.objectContaining({
        key: { animalId: 1 },
        unique: true,
        partialFilterExpression: { status: 'ACTIVE' },
      }),
    );
    const from = fixture.commands.length;
    const receipt = await closeOn(fixture.left, first.now).commit(first);
    expect(receipt).toEqual(first.expectedReceipt);
    await assertPeriodRotation(receipt);
    const commands = fixture.commands.slice(from);
    const periodWrites = commands.filter(
      ({ command, collection }) =>
        collection === 'animal_ownership_periods' &&
        ['update', 'insert'].includes(command),
    );
    expect(periodWrites.map(({ command }) => command)).toEqual([
      'update',
      'insert',
    ]);
    const transaction = periodWrites[0].transaction;
    expect(transaction).toBeDefined();
    expect(periodWrites[1].transaction).toBe(transaction);
    expect(
      commands.some(
        (command) => command.transaction === transaction && command.snapshot,
      ),
    ).toBe(true);
    expect(commands).toContainEqual(
      expect.objectContaining({
        transaction,
        command: 'commitTransaction',
        majority: true,
      }),
    );
    await expect(
      closeOn(fixture.right, first.now).read(first.commitSelection),
    ).resolves.toEqual(receipt);
  });

  it('retries a stale snapshot when two clients close distinct animals of the same decision', async () => {
    const { first, second, input } = seed;
    const left = closeOn(fixture.left, first.now);
    const right = closeOn(fixture.right, second.now);
    const from = fixture.commands.length;
    const pause = fixture.left.gate.arm('CAPTURE_ADMISSION');
    const pending = fixture.observe(left.commit(first));
    let winner: Dossier['expectedReceipt'];
    try {
      await pause.entered();
      winner = await right.commit(second);
      expect(winner).toEqual(second.expectedReceipt);
      expect(
        await fixture.right.rows.requests
          .findById(input.transferId)
          .lean()
          .exec(),
      ).toMatchObject({
        version: 3,
        acceptedItemCount: 1,
        status: 'PROCESSING',
      });
      await expect(right.read(first.commitSelection)).resolves.toBeNull();
    } finally {
      pause.release();
    }
    const result = await pending;
    if ('error' in result) throw result.error;
    const resumed = result.value;
    expect(resumed).toMatchObject({
      itemId: first.expectedReceipt.itemId,
      requestVersion: 4,
    });
    await assertPeriodRotation(winner);
    await assertPeriodRotation(resumed);
    const commands = fixture.commands
      .slice(from)
      .filter(({ side }) => side === 'left');
    const snapshots = commands.filter((command) => command.snapshot);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    const staleTransaction = snapshots[0].transaction;
    expect(commands).toContainEqual(
      expect.objectContaining({
        transaction: staleTransaction,
        command: 'abortTransaction',
      }),
    );
    expect(
      commands.some(
        (command) =>
          command.command === 'commitTransaction' &&
          command.transaction === staleTransaction,
      ),
    ).toBe(false);

    const r = fixture.right.rows;
    const request = await r.requests.findById(input.transferId).lean().exec();
    expect(request).toMatchObject({
      version: 4,
      acceptedItemCount: 2,
      status: 'PARTIALLY_ACCEPTED',
    });
    expect(request?.acceptanceStart).toEqual(
      first.state.db.requests[0].acceptanceStart,
    );
    expect(
      await r.claims.countDocuments({ transferId: input.transferId }),
    ).toBe(0);
    expect(
      await r.events.countDocuments({
        type: 'ITEM_ACCEPTED',
        transferId: input.transferId,
      }),
    ).toBe(2);
    expect(
      await r.notices.countDocuments({ transferId: input.transferId }),
    ).toBe(4);
    expect(
      await r.outbox.countDocuments({ transferId: input.transferId }),
    ).toBe(4);
    const beforeReplay = await fixture.snapshot();
    await expect(left.commit(first)).resolves.toEqual(resumed);
    await expect(right.commit(second)).resolves.toEqual(winner);
    expect(await fixture.snapshot()).toEqual(beforeReplay);
  });

  it('lists and pages the second closed dossier from the receipt on another client', async () => {
    const { first } = seed;
    const { store } = closeOn(fixture.right, first.now);
    const reader = new PublishedOwnershipHistoryReader(store, first.keyFromUrl);
    const { previousOwnerId: actorId, closedPeriodId: periodId } =
      first.expectedReceipt;
    const page = { actorId, periodId, limit: 1 };
    await expect(reader.list({ actorId, limit: 2 })).resolves.toMatchObject({
      periods: [],
    });
    await expect(reader.read(page)).rejects.toThrow(
      'Published ownership history not found',
    );

    const receipt = await closeOn(fixture.left, first.now).commit(first);
    const before = await fixture.snapshot();
    const { periods } = await reader.list({ actorId, limit: 2 });
    expect(periods).toMatchObject([
      {
        periodId,
        animalId: receipt.animalId,
        ownershipVersion: 2,
        endedAt: receipt.effectiveAt,
        publicationHash: receipt.commitHash,
        mode: 'HISTORICAL_READ_ONLY',
      },
    ]);
    const selection = { ...page, publicationHash: periods[0].publicationHash };
    const initial = await reader.read(selection);
    expect(initial.entries).toHaveLength(1);
    expect(initial.nextCursor).toEqual({
      publicationHash: receipt.commitHash,
      afterEntryId: initial.entries[0].entryId,
    });
    const remaining = await reader.read({
      ...selection,
      after: initial.nextCursor,
    });
    expect(remaining.entries).toHaveLength(1);
    expect(remaining.nextCursor).toBeUndefined();
    expect([...initial.entries, ...remaining.entries]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: first.liveSelection.entryId,
          kind: 'ANIMAL',
          media: [
            expect.objectContaining({ fileId: first.liveSelection.fileId }),
          ],
        }),
        expect.objectContaining({
          entryId: first.selection.entryId,
          kind: 'RETAINED_RECORD',
          media: [expect.objectContaining({ fileId: first.selection.fileId })],
        }),
      ]),
    );
    await expect(
      reader.read({ ...selection, actorId: receipt.ownerId }),
    ).rejects.toThrow('Published ownership history not found');
    await expect(
      reader.read({
        ...selection,
        after: {
          publicationHash: archiveHash('other publication'),
          afterEntryId: initial.entries[0].entryId,
        },
      }),
    ).rejects.toThrow('The selected history publication changed');
    expect(await fixture.snapshot()).toEqual(before);
  });

  it('downloads both versions selected by the second-period receipt and rejects the revoked generation', async () => {
    const { first } = seed;
    const receipt = await closeOn(fixture.left, first.now).commit(first);
    const { store, history, read } = closeOn(fixture.right, first.now);
    await expect(read(first.commitSelection)).resolves.toEqual(receipt);

    const live = first.live.media.historical;
    const objects = [
      { target: live.target, revision: live.revision, bytes: first.live.bytes },
      { target: first.target, revision: first.revision, bytes: first.bytes },
    ];
    const readVersion = jest.fn(
      (target: (typeof objects)[number]['target']) => {
        const object = objects.find(
          ({ target: stored }) => stored.key === target.key,
        );
        if (!object) throw new Error('Unexpected historical key');
        const body = Readable.from([object.bytes]);
        return Promise.resolve({
          revision: object.revision,
          body,
          close: () => body.destroy(),
        });
      },
    );
    const downloader = new PublishedOwnershipHistoryDownloader(
      store.publishedHistoryVersionSource(history),
      { readVersion },
      first.keyFromUrl,
      5000,
      first.now,
    );
    const bodies: Buffer[][] = [];
    const open = jest.fn(() => {
      const chunks: Buffer[] = [];
      bodies.push(chunks);
      return new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
      });
    });
    const liveInput = {
      ...first.liveSelection,
      publicationHash: receipt.commitHash,
    };
    const retainedInput = {
      ...first.selection,
      publicationHash: receipt.commitHash,
    };
    const before = await fixture.snapshot();
    await expect(
      downloader.download({ ...retainedInput, fileId: liveInput.fileId }, open),
    ).rejects.toThrow('Historical file not found');
    expect(readVersion).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    await downloader.download(liveInput, open);
    await downloader.download(retainedInput, open);
    expect(readVersion).toHaveBeenCalledTimes(objects.length);
    for (const [index, { target, revision }] of objects.entries())
      expect(readVersion).toHaveBeenNthCalledWith(
        index + 1,
        target,
        revision,
        expect.any(AbortSignal),
      );
    expect(bodies.map((chunks) => Buffer.concat(chunks))).toEqual(
      objects.map(({ bytes }) => bytes),
    );
    expect(await fixture.snapshot()).toEqual(before);

    const files = fixture.left.rows.files;
    const filter = { archiveId: receipt.archiveId, id: retainedInput.fileId };
    const { publishedHistoryStagingPutPermission } = first.retainedFile;
    expect(
      await files
        .updateOne(filter, {
          $unset: { publishedHistoryStagingPutPermission: '' },
        })
        .exec(),
    ).toMatchObject({ modifiedCount: 1 });
    await expect(downloader.download(retainedInput, open)).rejects.toThrow(
      'The retained file has an incomplete copy permission chain',
    );
    expect(readVersion).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(2);
    expect(
      await files
        .updateOne(filter, { $set: { publishedHistoryStagingPutPermission } })
        .exec(),
    ).toMatchObject({ modifiedCount: 1 });

    await fixture.left.sourceProfiles.invalidateSharedControls(
      first.originalControlsHash,
      {
        requestId: randomUUID(),
        evidenceHash: archiveHash(
          'synthetic retained conservation invalidation',
        ),
      },
    );
    await expect(downloader.download(retainedInput, open)).rejects.toThrow(
      'shared controls state changed or is invalid',
    );
    expect(readVersion).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(2);
    await downloader.download(liveInput, open);
    expect(readVersion).toHaveBeenCalledTimes(3);
    expect(bodies).toHaveLength(3);
    expect(Buffer.concat(bodies[2])).toEqual(first.live.bytes);
  });

  it('rolls back the period rotation and all associated writes when publication fails', async () => {
    const { first } = seed;
    const left = closeOn(fixture.left, first.now);
    const before = await fixture.snapshot();
    const from = fixture.commands.length;
    fixture.left.gate.fail = 'OWNERSHIP_PUBLICATION';
    await expect(left.commit(first)).rejects.toThrow(
      'The later-period ownership commit could not be acknowledged',
    );
    expect(await fixture.snapshot()).toEqual(before);
    const commands = fixture.commands.slice(from);
    const inserted = commands.find(
      (command) =>
        command.side === 'left' &&
        command.command === 'insert' &&
        command.collection === 'animal_ownership_periods',
    );
    expect(inserted?.transaction).toBeDefined();
    expect(commands).toContainEqual(
      expect.objectContaining({
        side: 'left',
        transaction: inserted?.transaction,
        command: 'abortTransaction',
      }),
    );
    await expect(left.read(first.commitSelection)).resolves.toBeNull();
    await expect(left.commit(first)).resolves.toEqual(first.expectedReceipt);
  });
});
