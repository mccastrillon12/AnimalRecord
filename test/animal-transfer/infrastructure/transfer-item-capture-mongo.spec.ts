import { MODULE_METADATA } from '@nestjs/common/constants';
import type {
  GetObjectCommand,
  GetObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { type ClientSession } from 'mongoose';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import { ItemStableCutEvidenceProducer } from '../../../src/context/animal-transfer/application/item-stable-cut-evidence-producer';
import type { StableCutVersionStorage } from '../../../src/context/animal-transfer/application/stable-cut-version-evidence';
import { TransferItemCapture } from '../../../src/context/animal-transfer/application/transfer-item-capture';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { TransferItemCaptureModule } from '../../../src/app/animal-transfer/transfer-item-capture.module';
import { AnimalTransferModule } from '../../../src/app/animal-transfer/animal-transfer.module';
import { ItemCaptureInput } from '../../../src/context/animal-transfer/domain/transfer-item-capture';
import { acceptanceStartStore } from '../fixtures/acceptance-start-store.fixture';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
import { ItemManifestObserver } from '../../../src/context/animal-transfer/application/item-manifest-observer';
import { ItemRecipientFinalCoverageObserver } from '../../../src/context/animal-transfer/application/item-recipient-final-coverage-observer';
import { ItemRecipientProjectionReader } from '../../../src/context/animal-transfer/application/item-recipient-projection-reader';
import { MongoOwnershipArchiveSource } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-source';
import { archiveDefinitionOnly } from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import {
  archiveHash,
  buildArchiveEntry,
  OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildItemCopyGateDefinition } from '../../../src/context/animal-transfer/domain/transfer-item-copy-record';
import {
  PUT_DESTINATION_WRITER_GROUPS,
  PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import {
  appendItemStableCutVersionsDigest,
  buildItemStableCutAccreditationRecord,
  buildItemStableCutScope,
  itemStableCutVersionsDigestSeed,
} from '../../../src/context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import {
  buildHistoricalPutVersionObservation,
  buildRecipientFinalPutVersionObservation,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import {
  AwsSignedItemStableCutCoverage,
  ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
  LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-signed-stable-cut-coverage';
import {
  Animal,
  type AnimalPrimitiveType,
} from '../../../src/context/animal/domain/animal';

async function setup(
  config?: ConstructorParameters<typeof MongoTransferItemCapture>[9],
) {
  const f = acceptanceStartStore(),
    receipt = await f.service.start(f.input),
    selected = receipt.binding.selected[0];
  const store = new MongoTransferItemCapture(
    ...([
      f.models[0],
      f.models[1],
      f.models[2],
      f.models[9],
      f.models[4],
      f.models[5],
      f.models[12],
      f.models[13],
      f.models[14],
      config,
      f.models[15],
    ] as unknown as ConstructorParameters<typeof MongoTransferItemCapture>),
  );
  const input: ItemCaptureInput = {
    actorId: f.recipientId,
    transferId: f.input.transferId,
    itemId: selected.itemId,
    decisionOperationId: f.input.operationId,
    expectedRequestVersion: 2,
    expectedCaptureRevision: 0,
  };
  const capture = {
    captureBatch: jest.fn(() => {
      const row = f.state.db.archives.find((a) => a.id === selected.archiveId)!;
      row.capture = { revision: 1, phase: 'DIARY', entryCount: 1 };
      f.state.epoch++;
      return Promise.resolve(row as never);
    }),
  };
  f.state.writes = 0;
  f.calls.length = 0;
  return {
    ...f,
    store,
    input,
    selected,
    capture,
    service: new TransferItemCapture(store, capture),
  };
}
describe('Per-item capture admission and progress, simulated transactions only', () => {
  async function sealed(state = 'COPYING', files = 2) {
    const f = await setup();
    Object.assign(f.state.db.archives[0], {
      state,
      capture: { revision: 3, phase: 'COMPLETE', entryCount: 1 },
      expectedEntryCount: 1,
      expectedFileCount: files,
    });
    return { ...f, input: { ...f.input, expectedCaptureRevision: 3 } };
  }
  it.each(['COPYING', 'READY'])(
    'inspects the original sealed %s binding in one read snapshot without granting copies',
    async (state) => {
      const f = await sealed(state),
        before = structuredClone(f.state.db),
        result = await f.service.inspectCopyPreparation(f.input);
      expect(result).toMatchObject({
        protocol: 'ITEM_COPY_PREPARATION_OBSERVATION_V1',
        transferId: f.input.transferId,
        itemId: f.input.itemId,
        requestVersion: 2,
        observedSeal: {
          acceptanceBindingHash: (
            before.requests[0].acceptanceStart as { bindingHash: string }
          ).bindingHash,
          archiveId: f.selected.archiveId,
          definitionHash: before.archives[0].definitionHash,
          reservationEpoch: 1,
          captureRevision: 3,
          expectedEntryCount: 1,
          expectedFileCount: 2,
        },
        status: 'BLOCKED',
        missingRequirements: [
          'STABLE_CUT_EVIDENCE',
          'COPY_EFFECT_PROTOCOL',
          'ARTIFACT_RETENTION',
        ],
        reservation: 'OBSERVED_ONLY',
        copyDispatch: 'NOT_AUTHORIZED',
        stableCut: 'NOT_ASSESSED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(result.observedSeal.reservationBindingHash).toEqual(
        (before.archives[0].reservation as { bindingHash: string }).bindingHash,
      );
      expect(result.observedSealHash).toMatch(/^[a-f0-9]{64}$/);
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      expect(f.calls.every((c) => c.session === f.sessions[1])).toBe(true);
      const archiveRead = f.calls.find((c) => c.role === 'archives')!;
      expect(archiveRead.projection).toMatchObject({
        expectedEntryCount: 1,
        expectedFileCount: 1,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /Brownie|sourceKey|leaseToken|nameHistory|payload|https:/,
      );
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.observedSeal)).toBe(true);
      expect(Object.isFrozen(result.missingRequirements)).toBe(true);
      expect(await f.service.inspectCopyPreparation(f.input)).toEqual(result);
    },
  );
  it('keeps an empty file manifest blocked and does not treat future unrecognized evidence as permission', async () => {
    const f = await sealed('READY', 0);
    f.state.db.archives[0].stableCut = { status: 'CLOSED' };
    f.state.db.archives[0].retention = { protected: true };
    const before = structuredClone(f.state.db);
    expect(await f.service.inspectCopyPreparation(f.input)).toMatchObject({
      observedSeal: { expectedFileCount: 0 },
      status: 'BLOCKED',
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(f.state.db).toEqual(before);
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it.each([
    'collecting',
    'phase',
    'stale',
    'future',
    'cursor',
    'entryMissing',
    'entryZero',
    'entryMismatch',
    'fileMissing',
    'fileNegative',
    'fileFraction',
    'fileOverflow',
  ])('rejects an unsupported sealed observation: %s', async (kind) => {
    const f = await sealed(),
      row = f.state.db.archives[0];
    if (kind === 'collecting') row.state = 'COLLECTING';
    if (kind === 'phase') (row.capture as { phase: string }).phase = 'MEDICAL';
    if (kind === 'stale') f.input.expectedCaptureRevision = 2;
    if (kind === 'future') f.input.expectedCaptureRevision = 4;
    if (kind === 'cursor')
      (row.capture as { afterId?: string }).afterId = f.id(99);
    if (kind === 'entryMissing') delete row.expectedEntryCount;
    if (kind === 'entryZero') row.expectedEntryCount = 0;
    if (kind === 'entryMismatch') row.expectedEntryCount = 2;
    if (kind === 'fileMissing') delete row.expectedFileCount;
    if (kind === 'fileNegative') row.expectedFileCount = -1;
    if (kind === 'fileFraction') row.expectedFileCount = 0.5;
    if (kind === 'fileOverflow')
      row.expectedFileCount = Number.MAX_SAFE_INTEGER + 1;
    const before = structuredClone(f.state.db);
    await expect(f.service.inspectCopyPreparation(f.input)).rejects.toThrow();
    expect(f.state.db).toEqual(before);
    expect(f.state.writes).toBe(0);
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it.each(['epoch', 'claim', 'period', 'consumed', 'legacy', 'recipient'])(
    'revalidates %s for a sealed copy inspection',
    async (kind) => {
      const f = await sealed();
      if (kind === 'epoch') f.state.db.controls[0].reservationEpoch = 3;
      if (kind === 'claim') f.state.db.claims[0].transferId = f.id(90);
      if (kind === 'period') f.state.db.periods[0].status = 'CLOSED';
      if (kind === 'consumed') f.state.db.archives[0].evidenceConsumption = {};
      if (kind === 'legacy') delete f.state.db.archives[0].reservation;
      if (kind === 'recipient') f.input.actorId = f.actorId;
      const before = structuredClone(f.state.db);
      await expect(f.service.inspectCopyPreparation(f.input)).rejects.toThrow();
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
      if (kind === 'recipient')
        expect(f.calls.map((c) => c.method)).toEqual(['findById']);
    },
  );
  it('compares only local seal identity across COPYING/READY and detects a changed persisted count', async () => {
    const f = await sealed(),
      first = await f.service.inspectCopyPreparation(f.input);
    f.state.db.archives[0].state = 'READY';
    expect(
      (await f.service.inspectCopyPreparation(f.input)).observedSealHash,
    ).toBe(first.observedSealHash);
    f.state.db.archives[0].expectedFileCount = 3;
    expect(
      (await f.service.inspectCopyPreparation(f.input)).observedSealHash,
    ).not.toBe(first.observedSealHash);
    // Counts are observations, not a recount of files or proof of remote effects.
    expect(f.state.writes).toBe(0);
  });
  it.each(['reply', 'session'])(
    'fails closed after an uncertain inspection %s without invoking work',
    async (kind) => {
      const f = await sealed(),
        before = structuredClone(f.state.db);
      if (kind === 'reply') f.state.loseReply = true;
      else f.state.endFailure = true;
      await expect(
        f.service.inspectCopyPreparation(f.input),
      ).rejects.toMatchObject({
        status: 503,
      });
      expect(f.state.db).toEqual(before);
      expect(f.state.writes).toBe(0);
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
    },
  );
  it('fences request/item/claim/control before exactly one bound callback and returns only minimal observed progress', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db),
      result = await f.service.advance(f.input);
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
    expect(f.capture.captureBatch).toHaveBeenCalledWith(f.selected.archiveId, {
      definitionHash: before.archives[0].definitionHash,
      reservationEpoch: 1,
      revision: 0,
    });
    expect(result).toMatchObject({
      captureRevision: 1,
      phase: 'DIARY',
      entryCount: 1,
      stage: 'COLLECTING',
      callback: 'RETURNED',
      reservation: 'OBSERVED_ONLY',
      businessCommit: 'NOT_AUTHORIZED',
      stableCut: 'NOT_ASSESSED',
    });
    for (const role of ['requests', 'items', 'claims'] as const)
      expect(f.state.db[role][0].captureStepRevision).toBe(1);
    expect(f.state.db.controls[0].archivePreparationRevision).toBe(2);
    expect(f.state.db.controls[0].reservationEpoch).toBe(1);
    expect(f.state.db.requests[0].version).toBe(2);
    expect(f.state.db.animals).toEqual(before.animals);
    expect(f.state.db.periods).toEqual(before.periods);
    expect(f.state.db.events).toEqual(before.events);
    const writes = f.calls.filter((c) =>
      [
        'updateOne',
        'updateMany',
        'deleteMany',
        'create',
        'findOneAndUpdate',
      ].includes(c.method),
    );
    expect(writes.map((c) => c.role)).toEqual([
      'requests',
      'items',
      'claims',
      'controls',
    ]);
    expect(writes.every((c) => c.session === f.sessions[1])).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /Brownie|archiveId|definitionHash|token|nameHistory|proof/,
    );
  });
  it('does not invoke another page or write admission counters when the same expected revision is retried', async () => {
    const f = await setup();
    await f.service.advance(f.input);
    const before = structuredClone(f.state.db);
    expect(await f.service.advance(f.input)).toMatchObject({
      captureRevision: 1,
      callback: 'NOT_INVOKED',
    });
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
    expect(f.state.db).toEqual(before);
  });
  it('observes progress without writing a fence or invoking capture', async () => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    expect(await f.service.observe(f.input)).toMatchObject({
      captureRevision: 0,
      reservation: 'OBSERVED_ONLY',
    });
    expect(f.state.db).toEqual(before);
    expect(f.state.writes).toBe(0);
  });
  it.each([1, 2, 3, 4])(
    'rolls back admission write %i without invoking work or releasing its reservation',
    async (n) => {
      const f = await setup(),
        before = structuredClone(f.state.db);
      f.state.failAtWrite = n;
      await expect(f.service.advance(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      expect(f.state.db).toEqual(before);
    },
  );
  it.each([
    'request',
    'recipient',
    'version',
    'operation',
    'item',
    'claim',
    'header',
    'epoch',
    'writers',
    'period',
    'cursor',
    'consumed',
    'legacy',
  ] as const)(
    'denies mismatched %s before work without repairs',
    async (kind) => {
      const f = await setup();
      if (kind === 'request') f.state.db.requests[0].status = 'PENDING';
      if (kind === 'recipient') f.state.db.requests[0].recipientId = f.actorId;
      if (kind === 'version') f.state.db.requests[0].version = 3;
      if (kind === 'operation')
        f.state.db.requests[0].decisionOperationId = f.id(90);
      if (kind === 'item') f.state.db.items[0].status = 'REJECTED';
      if (kind === 'claim')
        f.state.db.claims[0].acceptanceOperationId = f.id(90);
      if (kind === 'header') f.state.db.archives[0].ownerId = f.id(90);
      if (kind === 'epoch') f.state.db.controls[0].reservationEpoch = 3;
      if (kind === 'writers')
        f.state.db.controls[0].activeWrites = [{ token: 'private' }];
      if (kind === 'period') f.state.db.periods[0].status = 'UNKNOWN';
      if (kind === 'cursor') delete f.state.db.archives[0].capture;
      if (kind === 'consumed') f.state.db.archives[0].evidenceConsumption = {};
      if (kind === 'legacy') delete f.state.db.requests[0].acceptanceStart;
      const before = structuredClone(f.state.db);
      await expect(f.service.advance(f.input)).rejects.toThrow();
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      expect(f.state.db).toEqual(before);
    },
  );
  it('authorizes the recipient before loading associated sources', async () => {
    const f = await setup();
    await expect(
      f.service.advance({ ...f.input, actorId: f.actorId }),
    ).rejects.toThrow('recipient');
    expect(f.calls.map((c) => c.method)).toEqual(['findById']);
  });
  it.each(['requests', 'items', 'claims'] as const)(
    'denies exhausted %s admission fences',
    async (role) => {
      const f = await setup();
      f.state.db[role][0].captureStepRevision = Number.MAX_SAFE_INTEGER;
      const before = structuredClone(f.state.db);
      await expect(f.service.advance(f.input)).rejects.toThrow('exhausted');
      expect(f.state.db).toEqual(before);
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
    },
  );
  it('distinguishes missing counters from persisted zero when acquiring their fences', async () => {
    const f = await setup();
    for (const role of ['requests', 'items', 'claims'] as const)
      f.state.db[role][0].captureStepRevision = 0;
    await f.service.advance(f.input);
    expect(
      f.calls
        .filter(
          (c) =>
            ['requests', 'items', 'claims'].includes(c.role) &&
            c.method === 'updateOne',
        )
        .every((c) => c.filter.captureStepRevision === 0),
    ).toBe(true);
  });
  it('retains admitted counters and the reservation after a lost admission reply, without invoking a callback', async () => {
    const f = await setup();
    f.state.loseReply = true;
    await expect(f.service.advance(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.state.db.items[0].captureStepRevision).toBe(1);
    expect(f.state.db.controls[0].transferLock).toBeDefined();
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it('keeps callback errors sanitized and reconciles an already advanced cursor without rerunning it', async () => {
    const f = await setup(),
      run = f.capture.captureBatch.getMockImplementation()!;
    f.capture.captureBatch.mockImplementationOnce(async () => {
      await run();
      throw new Error('private token storage URL');
    });
    const error: unknown = await f.service
      .advance(f.input)
      .catch((e: unknown) => e);
    expect(String(error)).not.toMatch(/private|token|URL/);
    expect(f.state.db.controls[0].transferLock).toBeDefined();
    expect(await f.service.advance(f.input)).toMatchObject({
      callback: 'NOT_INVOKED',
      captureRevision: 1,
    });
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
  });
  it('never changes the admission snapshot into authority after an external control change before commit', async () => {
    const f = await setup();
    f.state.beforeCommit = () => {
      f.state.db.controls[0].reservationEpoch = 3;
      f.state.epoch++;
    };
    await expect(f.service.advance(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(f.state.db.items[0].captureStepRevision).toBeUndefined();
  });
  it('reports sealed capture without invoking copying or declaring ownership accepted', async () => {
    const f = await setup();
    f.state.db.archives[0].capture = {
      revision: 3,
      phase: 'COMPLETE',
      entryCount: 1,
    };
    f.state.db.archives[0].state = 'COPYING';
    expect(
      await f.service.advance({ ...f.input, expectedCaptureRevision: 3 }),
    ).toMatchObject({
      stage: 'CAPTURE_SEALED',
      callback: 'NOT_INVOKED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(f.state.db.items[0].status).toBe('PROCESSING');
  });
  it('rejects future revisions and selectors containing caller-supplied archive identities', async () => {
    const f = await setup();
    await expect(
      f.service.advance({ ...f.input, expectedCaptureRevision: 1 }),
    ).rejects.toThrow('progress');
    await expect(
      f.service.advance({
        ...f.input,
        archiveId: f.selected.archiveId,
      } as ItemCaptureInput),
    ).rejects.toThrow('Invalid');
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it.each([
    'requests.updateOne',
    'items.updateOne',
    'claims.updateOne',
    'controls.updateOne',
  ])('denies a no-op fence %s without invoking capture', async (target) => {
    const f = await setup(),
      before = structuredClone(f.state.db);
    f.state.noOp = target;
    await expect(f.service.advance(f.input)).rejects.toThrow('fence');
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(f.state.db).toEqual(before);
  });
  it.each(['collection', 'index', 'connection'] as const)(
    'denies bad %s storage without reading associated business data',
    async (kind) => {
      const f = await setup();
      if (kind === 'collection')
        f.state.missingCollection = 'animal_ownership_archives';
      if (kind === 'index') f.state.badIndex = 'animal_ownership_controls';
      if (kind === 'connection') f.models[9].db = { ...f.connection };
      await expect(f.service.advance(f.input)).rejects.toMatchObject({
        status: 503,
      });
      expect(f.capture.captureBatch).not.toHaveBeenCalled();
      expect(f.calls).toEqual([]);
    },
  );
  it('retains a committed admission if closing the session fails, without calling capture', async () => {
    const f = await setup();
    f.state.endFailure = true;
    await expect(f.service.advance(f.input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
    expect(f.state.db.items[0].captureStepRevision).toBe(1);
    expect(f.state.db.controls[0].transferLock).toBeDefined();
  });
  it('captures the immutable selector before storage awaits and ignores later caller mutation', async () => {
    const f = await setup(),
      raw = { ...f.input };
    const result = f.service.advance(raw);
    raw.itemId = f.id(999);
    raw.expectedCaptureRevision = 9;
    expect(await result).toMatchObject({
      itemId: f.input.itemId,
      captureRevision: 1,
    });
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
  });
  it('does not report a successful observation if the original reserve is invalidated after the callback', async () => {
    const f = await setup(),
      run = f.capture.captureBatch.getMockImplementation()!;
    f.capture.captureBatch.mockImplementationOnce(async () => {
      const result = await run();
      f.state.db.controls[0].reservationEpoch = 3;
      return result;
    });
    await expect(f.service.advance(f.input)).rejects.toThrow(
      'original matching',
    );
    expect(f.capture.captureBatch).toHaveBeenCalledTimes(1);
    expect(f.state.db.items[0].status).toBe('PROCESSING');
    expect(f.state.db.controls[0].transferLock).toBeDefined();
  });
  it('preserves a recipient denial when ending its read session also fails', async () => {
    const f = await setup();
    f.state.endFailure = true;
    await expect(
      f.service.advance({ ...f.input, actorId: f.actorId }),
    ).rejects.toThrow('recipient');
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it('keeps the module outside the graph and requires explicit capture composition', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AnimalTransferModule),
    ).not.toContain(TransferItemCaptureModule);
    expect(() =>
      TransferItemCaptureModule.register(undefined as never),
    ).toThrow('explicit');
    expect(
      TransferItemCaptureModule.register({ captureBatch: jest.fn() }).exports,
    ).toEqual([TransferItemCapture, 'ItemCopyRecordStore']);
  });
});

async function prepareInitialOwnership(seedAccreditation = true) {
  const recordedAt = '2026-10-29T12:02:00.000Z';
  const effectiveAt = '2026-10-29T12:03:00.000Z';
  let at = effectiveAt;
  const now = () => new Date(at);
  const fenceActiveSharedControls = jest.fn().mockResolvedValue(undefined);
  const f = await setup({
    now,
    profiles: {
      fenceActiveSourceProfile: jest.fn(),
      fenceActiveSharedControls,
    },
  });
  const archive = f.state.db.archives.find(
    (row) => row.id === f.selected.archiveId,
  )! as unknown as OwnershipArchive;
  const definition = archiveDefinitionOnly(archive);
  const animal = f.state.db.animals.find(
    (row) => row.id === archive.animalId,
  )! as unknown as AnimalPrimitiveType;
  const { entry } = buildArchiveEntry(
    definition,
    { kind: 'ANIMAL', data: Animal.fromPrimitives(animal).toPrimitives() },
    f.keys.keyFromUrl,
  );
  Object.assign(archive, {
    state: 'COPYING',
    capture: { revision: 3, phase: 'COMPLETE', entryCount: 1 },
    expectedEntryCount: 1,
    expectedFileCount: 0,
  });
  f.state.db.entries.push(entry);
  const selector = { ...f.input, expectedCaptureRevision: 3 };
  const { observedSealHash: expectedSealHash } =
    await f.service.inspectCopyPreparation(selector);
  const manifestInput = { selector, expectedSealHash };
  const manifest = await new ItemManifestObserver(
    f.store,
    f.keys.keyFromUrl,
  ).observe(manifestInput);
  await f.store.confirmManifestDigest(manifestInput, manifest);
  const urls = {
    keyFromUrl: f.keys.keyFromUrl,
    urlForKey: (key: string) => `https://synthetic.invalid/${key}`,
  };
  const { selection } = await new ItemRecipientProjectionReader(
    f.store,
    new ItemRecipientFinalCoverageObserver(f.store),
    urls,
  ).prepareSelection({
    ...manifestInput,
    expectedManifestHash: manifest.manifestHash,
    requiredThrough: '2026-10-29T12:05:00.000Z',
  });
  const session = await f.connection.startSession();
  let scope: Awaited<
    ReturnType<typeof f.store.readItemStableCutScopeWithinTransaction>
  >['scope'];
  try {
    const read = (await session.withTransaction(
      () =>
        f.store.readItemStableCutScopeWithinTransaction(
          selection,
          session as unknown as ClientSession,
          urls,
        ),
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      },
    )) as Awaited<
      ReturnType<typeof f.store.readItemStableCutScopeWithinTransaction>
    >;
    scope = read.scope;
  } finally {
    await session.endSession();
  }
  const coverage = {
    disposition: 'ISOLATED' as const,
    evidenceHash: archiveHash('coverage'),
  };
  const report = {
    protocol: 'ITEM_STABLE_CUT_ACCREDITATION_V1' as const,
    issuerId: f.recipientId,
    scopeHash: scope.scopeHash,
    controlsHash: archiveHash('controls'),
    writerInventoryHash: archiveHash('writers'),
    writers: Object.fromEntries(
      PUT_DESTINATION_WRITER_GROUPS.map((group) => [group, coverage]),
    ) as PutDestinationWriters,
    copyEffects: coverage,
    validFrom: recordedAt,
    validUntil: '2026-10-29T12:06:00.000Z',
  };
  const pins = {
    selection,
    expectedScopeHash: scope.scopeHash,
    expectedAccreditationHash: archiveHash(report),
  };
  if (seedAccreditation)
    f.state.db.copyRecords.push(
      buildItemStableCutAccreditationRecord(
        scope,
        report,
        buildItemCopyGateDefinition(manifest.binding).id,
        pins.expectedAccreditationHash,
        recordedAt,
      ),
    );
  const source = new MongoOwnershipArchiveSource(
    ...([
      f.models[3],
      f.models[7],
      f.models[6],
      f.models[5],
    ] as unknown as ConstructorParameters<typeof MongoOwnershipArchiveSource>),
  );
  const models = {
    users: f.models[11],
    events: f.models[10],
    notices: f.models[16],
    outbox: f.models[17],
  } as unknown as Parameters<typeof f.store.commitItemOwnership>[3];
  f.state.writes = 0;
  f.calls.length = 0;
  return {
    ...f,
    definition,
    entry,
    pins,
    scope,
    report,
    now,
    fenceActiveSharedControls,
    effectiveAt,
    commit: () => f.store.commitItemOwnership(pins, urls, source, models),
    produceAndRegister: (
      producer: Parameters<typeof f.store.produceAndRegisterItemStableCut>[2],
    ) => f.store.produceAndRegisterItemStableCut(pins, urls, producer),
    setTime: (time: string) => {
      at = time;
    },
  };
}

function initialCutEvidence(
  f: Awaited<ReturnType<typeof prepareInitialOwnership>>,
  scope = f.scope,
  protocol: string = ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
) {
  const {
    issuerId,
    controlsHash,
    writerInventoryHash,
    writers,
    copyEffects,
    validFrom,
    validUntil,
  } = f.report;
  const report = {
    scopeHash: scope.scopeHash,
    issuerId,
    controlsHash,
    writerInventoryHash,
    writers,
    copyEffects,
    validFrom,
    validUntil,
  };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signature = sign(
    null,
    Buffer.from(archiveHash({ protocol, report }), 'hex'),
    privateKey,
  ).toString('base64');
  const envelope = Buffer.from(JSON.stringify({ protocol, report, signature }));
  const bucketOwner = '123456789012';
  const send = jest.fn<Promise<GetObjectCommandOutput>, [GetObjectCommand]>();
  send.mockImplementation(() =>
    Promise.resolve({
      $metadata: { httpStatusCode: 200 },
      VersionId: 'writer-coverage-version',
      Body: Readable.from([envelope]) as NonNullable<
        GetObjectCommandOutput['Body']
      >,
      ContentLength: envelope.length,
    }),
  );
  const readVersion = jest.fn<
    ReturnType<StableCutVersionStorage['readVersion']>,
    Parameters<StableCutVersionStorage['readVersion']>
  >();
  const readSourceRetention = jest.fn<
    ReturnType<StableCutVersionStorage['readSourceRetention']>,
    Parameters<StableCutVersionStorage['readSourceRetention']>
  >();
  const storage = { readVersion, readSourceRetention };
  const coverage = new AwsSignedItemStableCutCoverage(
    { send } as unknown as Pick<S3Client, 'send'>,
    {
      bucket: 'synthetic-cut-audit',
      bucketOwner,
      issuerId,
      controlsHash,
      publicKey,
      maxBytes: 4096,
    },
    f.now,
  );
  return {
    producer: new ItemStableCutEvidenceProducer(coverage, storage, f.now),
    coverage,
    storage,
    send,
    bucketOwner,
  };
}

function selectedInitialVersions(
  f: Awaited<ReturnType<typeof prepareInitialOwnership>>,
) {
  const bytes = Buffer.from('synthetic first-transfer bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  function copy(leg: 'historical' | 'final') {
    const target = {
      bucket: 'synthetic-archive',
      expectedBucketOwner: '123456789012',
      key: `users/test/${leg}.pdf`,
    };
    const scope = {
      authorizationId: f.id(187),
      target,
      permissionHash: archiveHash([leg, 'permission']),
      size: bytes.length,
      sha256,
    };
    const evidence = {
      issuerId: f.recipientId,
      scopeHash: archiveHash(scope),
      revision: {
        versionId: `${leg}-version`,
        etag: `"${leg}-etag"`,
        size: bytes.length,
      },
      provenanceEvidenceHash: archiveHash([leg, 'provenance']),
      conservationEvidenceHash: archiveHash([leg, 'retention']),
      conservationControlsHash: archiveHash([leg, 'controls']),
      validFrom: f.report.validFrom,
      validUntil: f.report.validUntil,
    };
    return { scope, evidence };
  }
  const historical = copy('historical');
  const final = copy('final');
  const historicalEvidence = {
    ...historical.evidence,
    protocol: 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const finalEvidence = {
    ...final.evidence,
    protocol: 'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const horizon = f.scope.selection.requiredThrough;
  const file = {
    fileId: archiveHash('initial file'),
    fileDefinitionHash: archiveHash('initial file definition'),
    historical: buildHistoricalPutVersionObservation(
      historical.scope,
      historicalEvidence,
      archiveHash(historicalEvidence),
      f.now().getTime(),
      horizon,
    ),
    final: buildRecipientFinalPutVersionObservation(
      final.scope,
      finalEvidence,
      archiveHash(finalEvidence),
      f.now().getTime(),
      horizon,
    ),
  };
  const scope = buildItemStableCutScope(
    f.scope.selection,
    f.scope.copyInventory,
    {
      fileCount: 1,
      versionsDigest: appendItemStableCutVersionsDigest(
        itemStableCutVersionsDigestSeed(),
        file,
      ),
      conservationControlsHashes: [
        file.historical.conservationControlsHash,
        file.final.conservationControlsHash,
      ].sort(),
    },
  );
  return { scope, file, bytes };
}

describe('Initial item stable-cut evidence', () => {
  it('registers signed coverage for an empty dossier before the existing business commit', async () => {
    const f = await prepareInitialOwnership(false);
    const e = initialCutEvidence(f);
    e.send.mockImplementationOnce(() => {
      expect(f.calls[0]?.session?.inTransaction()).toBe(false);
      return Promise.reject(new Error('synthetic unavailable bucket'));
    });
    await expect(f.produceAndRegister(e.producer)).rejects.toThrow(
      'could not read the signed',
    );
    const registered = await f.produceAndRegister(e.producer);
    expect(e.storage.readSourceRetention).not.toHaveBeenCalled();
    expect(e.storage.readVersion).not.toHaveBeenCalled();
    expect(registered.record.accreditation).toEqual(f.report);
    expect(registered.observation.businessCommit).toBe('NOT_AUTHORIZED');
    expect(f.state.db.items[0].status).toBe('PROCESSING');
    expect(f.state.db.copyRecords).toContainEqual(registered.record);
    await expect(f.commit()).resolves.toMatchObject({
      archiveId: f.definition.id,
    });
  });

  it('checks both exact versions and binds their shortest retention to the report', async () => {
    const f = await prepareInitialOwnership(false);
    const { scope, file, bytes } = selectedInitialVersions(f);
    const e = initialCutEvidence(f, scope);
    e.storage.readSourceRetention
      .mockResolvedValueOnce({
        mode: 'COMPLIANCE',
        expectedBucketOwner: e.bucketOwner,
        reportedRetainUntil: '2026-10-29T12:05:30.000Z',
      })
      .mockResolvedValueOnce({
        mode: 'COMPLIANCE',
        expectedBucketOwner: e.bucketOwner,
        reportedRetainUntil: f.report.validUntil,
      });
    const close = jest.fn();
    e.storage.readVersion.mockImplementation((_target, revision) =>
      Promise.resolve({ revision, body: Readable.from([bytes]), close }),
    );
    const result = await e.producer.produce({ scope, retainedFiles: [file] });
    expect(e.send.mock.calls[0][0].input.Key).toBe(
      `stable-cut-writer-coverage/v1/${scope.scopeHash}.json`,
    );
    expect(e.storage.readVersion.mock.calls).toEqual([
      [file.historical.scope.target, file.historical.revision],
      [file.final.scope.target, file.final.revision],
    ]);
    expect(close).toHaveBeenCalledTimes(2);
    expect(result.accreditation.validUntil).toBe('2026-10-29T12:05:30.000Z');
    expect(result.accreditation.retainedVersionsEvidenceHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('rejects changing an observed revision without changing its hash', async () => {
    const f = await prepareInitialOwnership(false);
    const { scope, file } = selectedInitialVersions(f);
    const e = initialCutEvidence(f, scope);
    await expect(
      e.producer.produce({
        scope,
        retainedFiles: [
          {
            ...file,
            historical: {
              ...file.historical,
              revision: {
                ...file.historical.revision,
                versionId: 'swapped-version',
              },
            },
          },
        ],
      }),
    ).rejects.toThrow('evidence is inconsistent');
    expect(e.send).not.toHaveBeenCalled();
    expect(e.storage.readVersion).not.toHaveBeenCalled();
  });

  it('rejects a signed report from the later-period protocol', async () => {
    const f = await prepareInitialOwnership(false);
    const e = initialCutEvidence(
      f,
      f.scope,
      LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    );
    await expect(e.coverage.readCoverage(f.scope)).rejects.toThrow(
      'coverage is inconsistent',
    );
  });

  it('does not register if a control generation is revoked after verification', async () => {
    const f = await prepareInitialOwnership(false);
    const e = initialCutEvidence(f);
    await expect(
      f.produceAndRegister({
        produce: async (selected) => {
          const evidence = await e.producer.produce(selected);
          f.fenceActiveSharedControls.mockRejectedValueOnce(
            new Error('initial cut controls revoked'),
          );
          return evidence;
        },
      }),
    ).rejects.toThrow('initial cut controls revoked');
    expect(f.state.db.copyRecords).toHaveLength(0);
    expect(f.state.db.items[0].status).toBe('PROCESSING');
  });
});

describe('Published ownership period discovery', () => {
  it('paginates own closed periods and opens only the matching verified publication', async () => {
    const f = await prepareInitialOwnership();
    const { definition: archive, entry, effectiveAt } = f;
    const receipt = await f.commit();
    expect(
      f.state.db.animals.find((row) => row.id === receipt.animalId)?.ownerId,
    ).toBe(f.recipientId);
    f.state.writes = 0;
    f.state.db.periods.push({
      id: f.id(180),
      animalId: f.id(90),
      ownerId: f.actorId,
      status: 'CLOSED',
      ownershipVersion: 1,
      endedAt: effectiveAt,
    });
    const reader = new PublishedOwnershipHistoryReader(
      f.store,
      f.keys.keyFromUrl,
    );
    const first = await reader.list({ actorId: f.actorId, limit: 1 });
    expect(first.periods).toEqual([]);
    expect(first.nextCursor).toEqual({
      actorId: f.actorId,
      afterPeriodId: f.id(180),
    });
    const next = await reader.list({
      actorId: f.actorId,
      limit: 1,
      after: first.nextCursor,
    });
    expect(next.nextCursor).toBeUndefined();
    expect(next.periods).toEqual([
      expect.objectContaining({
        periodId: archive.periodId,
        publicationHash: receipt.commitHash,
      }),
    ]);
    const period = {
      actorId: f.actorId,
      periodId: next.periods[0].periodId,
      publicationHash: next.periods[0].publicationHash,
      limit: 1,
    };
    await expect(reader.read(period)).resolves.toMatchObject({
      entries: [{ entryId: entry.id }],
    });
    await expect(
      reader.read({ ...period, publicationHash: archiveHash('other') }),
    ).rejects.toThrow('publication changed');
    await expect(
      reader.list({ actorId: f.recipientId, limit: 1 }),
    ).resolves.toMatchObject({ periods: [] });
    await expect(
      reader.read({ ...period, actorId: f.recipientId }),
    ).rejects.toThrow('not found');
    expect(f.state.writes).toBe(0);
  });
});

describe('Acknowledged initial-period ownership changes', () => {
  it('caps the transaction to the remaining evidence window and observes its saved receipt', async () => {
    const f = await prepareInitialOwnership();
    f.setTime('2026-10-29T12:04:58.000Z');
    const receipt = await f.commit();
    expect(f.calls[0].session?.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        timeoutMS: 2000,
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority', wtimeoutMS: 10000 },
      }),
    );
    expect(receipt).toMatchObject({
      ownershipVersion: 2,
      effectiveAt: '2026-10-29T12:04:58.000Z',
    });
    await expect(f.store.readItemOwnershipCommit(f.pins)).resolves.toEqual(
      receipt,
    );
  });

  it('leaves an expired decision in processing with its original reservation', async () => {
    const f = await prepareInitialOwnership();
    const before = structuredClone(f.state.db);
    f.setTime(f.pins.selection.requiredThrough);
    await expect(f.commit()).rejects.toThrow('commit window has ended');
    expect(f.calls).toEqual([]);
    expect(f.state.db).toEqual(before);
    await expect(f.store.readItemOwnershipCommit(f.pins)).resolves.toBeNull();
  });

  it('rolls back the initial evidence, period transition and notices after an outbox write failure', async () => {
    const f = await prepareInitialOwnership();
    const before = structuredClone(f.state.db);
    let interrupted: typeof f.state.db | undefined;
    jest
      .spyOn(f.models[17], 'insertMany')
      .mockImplementationOnce((_, options) => {
        interrupted = options.session?.current;
        throw new Error('Synthetic outbox failure');
      });
    await expect(f.commit()).rejects.toThrow('could not be acknowledged');
    expect(interrupted?.notices).toHaveLength(2);
    expect(
      interrupted?.periods.find((row) => row.id === f.definition.periodId),
    ).toMatchObject({
      status: 'CLOSED',
      endedAt: f.effectiveAt,
    });
    expect(f.state.db).toEqual(before);
    await expect(f.store.readItemOwnershipCommit(f.pins)).resolves.toBeNull();
  });

  it('reads the exact first-transfer receipt after an unacknowledged close and horizon expiry', async () => {
    const f = await prepareInitialOwnership();
    f.state.loseReply = true;
    await expect(f.commit()).rejects.toThrow('could not be acknowledged');
    const written = f.state.db.items.find(
      (row) => row._id === f.selected.itemId,
    )?.ownershipCommit;
    expect(written).toMatchObject({
      protocol: 'TRANSFER_ITEM_OWNERSHIP_COMMIT_V1',
      effectiveAt: f.effectiveAt,
    });
    const writes = f.state.writes;
    f.setTime('2026-10-29T12:07:00.000Z');
    await expect(f.store.readItemOwnershipCommit(f.pins)).resolves.toEqual(
      written,
    );
    await expect(
      f.store.readItemOwnershipCommit({
        ...f.pins,
        expectedAccreditationHash: archiveHash('another report'),
      }),
    ).rejects.toThrow('inconsistent with the selected decision');
    expect(f.state.writes).toBe(writes);
  });
});
