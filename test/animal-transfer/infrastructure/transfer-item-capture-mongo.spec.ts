import { type DynamicModule, Global, Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type {
  GetObjectCommand,
  GetObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { type ClientSession } from 'mongoose';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { ItemStableCutEvidenceProducer } from '../../../src/context/animal-transfer/application/item-stable-cut-evidence-producer';
import { ItemStableCutPutEvidenceSource } from '../../../src/context/animal-transfer/application/item-stable-cut-put-evidence-source';
import { OwnershipArchiveCapture } from '../../../src/context/animal-transfer/application/ownership-archive-capture';
import { OwnershipArchivePreparer } from '../../../src/context/animal-transfer/application/ownership-archive-preparer';
import {
  STABLE_CUT_COVERAGE_GROUPS,
  StableCutInventoryEvidenceReader,
  type StableCutWriterEvidenceReader,
  type StableCutWriterFindings,
  type StableCutWriterInventory,
} from '../../../src/context/animal-transfer/application/stable-cut-writer-evidence';
import type { StableCutVersionStorage } from '../../../src/context/animal-transfer/application/stable-cut-version-evidence';
import { TransferItemCapture } from '../../../src/context/animal-transfer/application/transfer-item-capture';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import {
  ITEM_OWNERSHIP_CLOSER,
  ITEM_STABLE_CUT_REGISTRAR,
  TransferItemCaptureModule,
  type ItemOwnershipCloser,
  type ItemStableCutRegistrar,
} from '../../../src/app/animal-transfer/transfer-item-capture.module';
import { AnimalTransferModule } from '../../../src/app/animal-transfer/animal-transfer.module';
import { InitialTransferAcceptanceModule } from '../../../src/app/animal-transfer/initial-transfer-acceptance.module';
import { OwnershipArchiveModule } from '../../../src/app/animal-transfer/ownership-archive.module';
import { MongoItemSourceProfileState } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-item-source-profile-state';
import { transferRecordId } from '../../../src/context/animal-transfer/domain/transfer-record-id';
import {
  TRANSFER_ACCEPTANCE_PROGRESS,
  type TransferAcceptanceProgress,
} from '../../../src/context/animal-transfer/application/transfer-acceptance-execution';
import { OwnershipHistoryController } from '../../../src/app/animal-transfer/ownership-history.controller';
import { ItemCaptureInput } from '../../../src/context/animal-transfer/domain/transfer-item-capture';
import { acceptanceStartStore } from '../fixtures/acceptance-start-store.fixture';
import {
  startAcceptanceHttp,
  type AcceptanceHttpHistory,
} from '../fixtures/acceptance-http.fixture';
import { acceptanceAt } from '../fixtures/transfer-acceptance-preparation.fixture';
import { restoreNodeDisposeSymbolForSuite } from '../integration/support/restore-node-dispose-symbol';
import { PublishedOwnershipHistoryDownloader } from '../../../src/context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
import type { PublishedHistoryFileInput } from '../../../src/context/animal-transfer/domain/published-ownership-history';
import type { ArchiveProjectionUrls } from '../../../src/context/animal-transfer/domain/ownership-archive-recipient-projection';
import { ItemManifestPreparer } from '../../../src/context/animal-transfer/application/item-manifest-preparer';
import { ItemSourceObservationPreparer } from '../../../src/context/animal-transfer/application/item-source-observation-preparer';
import { initialCutReconciledMedia } from '../fixtures/initial-cut-reconciled-media.fixture';
import { runInitialItemCopies } from '../fixtures/initial-item-copy-protocol.fixture';
import { archiveMedicalDocument } from '../fixtures/ownership-archive.fixture';
import { ItemRecipientProjectionReader } from '../../../src/context/animal-transfer/application/item-recipient-projection-reader';
import { MongoOwnershipArchiveSource } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-source';
import { MongoOwnershipArchiveRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-repository';
import { MongoAnimalOwnershipRepository } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-ownership-repository';
import {
  TRANSFER_EVENT_MODEL,
  TRANSFER_NOTICE_MODEL,
  TRANSFER_OUTBOX_MODEL,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/transfer-request.schema';
import { UserEntity } from '../../../src/context/user/infrastructure/persistence/mongo/user.schema';
import { archiveDefinitionOnly } from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import {
  type ArchiveEntry,
  type ArchiveFile,
  type ObjectRevision,
  archiveHash,
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
  matchItemStableCutCopyPermissionIdentities,
} from '../../../src/context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import {
  buildHistoricalPutVersionObservation,
  buildRecipientFinalPutVersionObservation,
  type ItemHistoricalPutVersionScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import {
  AwsSignedItemStableCutCoverage,
  ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
  LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-signed-stable-cut-coverage';
import { StableCutWriterCoverageIssuer } from '../../../src/context/animal-transfer/infrastructure/storage/signed-stable-cut-coverage';
import {
  MedicalDocument,
  MedicalDocumentStatus,
} from '../../../src/context/medical-document/domain/medical-document';

@Global()
@Module({
  providers: [
    {
      provide: getConnectionToken(),
      useValue: { models: {}, model: () => ({}) },
    },
  ],
  exports: [getConnectionToken()],
})
class SimulatedConnectionModule {}

@Module({})
class SimulatedOwnershipArchiveModule {}

function startItemCaptureRehearsal(
  itemModule: DynamicModule,
  store: MongoTransferItemCapture,
  models: ReadonlyArray<readonly [string, unknown]> = [],
) {
  const builder = Test.createTestingModule({
    imports: [SimulatedConnectionModule, itemModule],
  })
    .overrideProvider('ItemCaptureStore')
    .useValue(store);
  for (const [name, model] of models)
    builder.overrideProvider(getModelToken(name)).useValue(model);
  return builder.compile();
}

async function setup(
  config?: ConstructorParameters<typeof MongoTransferItemCapture>[9],
  f = acceptanceStartStore(),
  beforeStart?: (store: MongoTransferItemCapture) => Promise<void>,
) {
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
  await beforeStart?.(store);
  const decision = await f.service.start(f.input);
  const [selected] = decision.binding.selected;
  const input: ItemCaptureInput = {
    actorId: f.recipientId,
    transferId: f.input.transferId,
    itemId: selected.itemId,
    decisionOperationId: f.input.operationId,
    expectedRequestVersion: decision.requestVersion,
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
    decision,
    store,
    input,
    selected,
    capture,
    service: new TransferItemCapture(store, capture),
  };
}

function captureIdentity({ actorId, transferId, itemId }: ItemCaptureInput) {
  return { actorId, transferId, itemId };
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
  it('recovers the original decision version after a sibling advances the request version', async () => {
    const f = await setup();
    const [, sibling] = f.decision.binding.selected;
    f.state.db.items.find(({ _id }) => _id === sibling.itemId)!.status =
      'ACCEPTED';
    Object.assign(f.state.db.requests[0], { version: 3, acceptedItemCount: 1 });
    const before = structuredClone(f.state.db);

    await expect(
      f.service.readResumePoint(captureIdentity(f.input)),
    ).resolves.toMatchObject({
      selector: f.input,
      progress: {
        requestVersion: 2,
        stage: 'COLLECTING',
        reservation: 'OBSERVED_ONLY',
      },
    });
    expect(f.state.db).toEqual(before);
    expect(f.state.writes).toBe(0);
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
  });
  it('validates the caller and the saved decision before reading the associated item', async () => {
    const f = await setup();
    const identity = captureIdentity(f.input);
    expect(() => f.service.readResumePoint(f.input)).toThrow(
      'Invalid item capture identity',
    );
    expect(f.calls).toEqual([]);
    await expect(
      f.service.readResumePoint({ ...identity, actorId: f.actorId }),
    ).rejects.toThrow('recipient');
    f.state.db.requests[0].decisionExpectedVersion = 2;
    await expect(f.service.readResumePoint(identity)).rejects.toThrow(
      'immutable start receipt',
    );
    expect(f.calls.map(({ method, role }) => [role, method])).toEqual([
      ['requests', 'findById'],
      ['requests', 'findById'],
    ]);
  });
  it('refuses recovery after replacing the original reservation or closing the initial period', async () => {
    const f = await setup();
    const identity = captureIdentity(f.input);
    const control = f.state.db.controls.find(
      ({ animalId }) => animalId === f.selected.animalId,
    )!;
    control.reservationEpoch = f.selected.reservationEpoch + 1;
    await expect(f.service.readResumePoint(identity)).rejects.toThrow(
      'original matching',
    );
    control.reservationEpoch = f.selected.reservationEpoch;
    f.state.db.periods.find(
      ({ animalId }) => animalId === f.selected.animalId,
    )!.status = 'CLOSED';
    await expect(f.service.readResumePoint(identity)).rejects.toThrow(
      'initial active period',
    );
    expect(f.state.writes).toBe(0);
    expect(f.capture.captureBatch).not.toHaveBeenCalled();
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
    const writes = f.state.writes;
    await expect(
      f.service.readResumePoint(captureIdentity(f.input)),
    ).resolves.toMatchObject({
      selector: { ...f.input, expectedCaptureRevision: 1 },
      progress: {
        phase: 'DIARY',
        captureRevision: 1,
        businessCommit: 'NOT_AUTHORIZED',
      },
    });
    expect(f.state.writes).toBe(writes);
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
    expect(() =>
      TransferItemCaptureModule.register({ captureBatch: jest.fn() }, {
        keyFromUrl: undefined,
      } as never),
    ).toThrow('manifest key resolver');
    expect(() =>
      TransferItemCaptureModule.register(
        { captureBatch: jest.fn() },
        { keyFromUrl: jest.fn() },
        undefined,
        undefined,
        undefined,
        { produce: jest.fn() },
      ),
    ).toThrow('explicit stable-cut producer and URL codec');
    expect(() =>
      TransferItemCaptureModule.register(
        { captureBatch: jest.fn() },
        { keyFromUrl: jest.fn(), urlForKey: jest.fn() },
        undefined,
        undefined,
        undefined,
        undefined,
        {} as never,
      ),
    ).toThrow('explicit ownership archive source and URL codec');
  });
});

async function captureAndPrepareFromOriginalReservation(
  f: Awaited<ReturnType<typeof setup>>,
  source: MongoOwnershipArchiveSource,
  sourceKey: string | undefined,
  sourceRevision: ObjectRevision,
  bytes: Buffer,
) {
  const ownership = new MongoAnimalOwnershipRepository(
    ...([
      f.models[5],
      f.models[4],
      f.models[3],
      undefined,
    ] as unknown as ConstructorParameters<
      typeof MongoAnimalOwnershipRepository
    >),
  );
  const repository = new MongoOwnershipArchiveRepository(
    ...([
      f.models[9],
      f.models[13],
      f.models[12],
      f.models[5],
      f.models[4],
    ] as unknown as ConstructorParameters<
      typeof MongoOwnershipArchiveRepository
    >),
  );
  const inspect = jest.fn((key: string) => {
    expect(key).toBe(sourceKey);
    expect(f.sessions.some((session) => session.inTransaction())).toBe(false);
    return Promise.resolve(sourceRevision);
  });
  const storage = {
    keyFromUrl: f.keys.keyFromUrl,
    assertTransferSafe: jest.fn((key: string) => {
      expect(key).toBe(sourceKey);
      return Promise.resolve();
    }),
    inspect,
    copyAndVerify: jest.fn(() => {
      throw new Error('Capture must not copy objects');
    }),
  };
  const preparer = new OwnershipArchivePreparer(ownership, repository, storage);
  const capture = new OwnershipArchiveCapture(
    ownership,
    repository,
    source,
    storage,
    preparer,
  );
  const head = jest.fn((target: { bucket: string; key: string }) => {
    expect(target).toEqual({ bucket: 'synthetic-cut-media', key: sourceKey });
    expect(f.sessions.every((session) => !session.inTransaction())).toBe(true);
    return Promise.resolve({ ...target, ...sourceRevision });
  });
  const read = jest.fn((_target: unknown, revision: ObjectRevision) => {
    expect(revision).toEqual(sourceRevision);
    expect(f.sessions.every((session) => !session.inTransaction())).toBe(true);
    return Promise.resolve({
      revision,
      body: Readable.from([bytes]),
      close: () => undefined,
    });
  });
  const module = await startItemCaptureRehearsal(
    TransferItemCaptureModule.register(capture, storage, { head, read }),
    f.store,
  );
  try {
    const service = module.get(TransferItemCapture);
    const manifestPreparer = module.get(ItemManifestPreparer);
    const control = f.state.db.controls.find(
      ({ animalId }) => animalId === f.selected.animalId,
    )!;
    const reservation = structuredClone(control.transferLock);
    expect(f.state.db.entries).toEqual([]);
    expect(f.state.db.files).toEqual([]);
    const expectedPhases = ['DIARY', 'MEDICAL', 'COMPLETE'] as const;
    const identity = captureIdentity(f.input);
    let { selector } = await service.readResumePoint(identity);
    expect(selector).toEqual(f.input);
    f.state.allowCaptureReads = true;
    try {
      for (const phase of expectedPhases) {
        const progress = await service.advance(selector);
        expect(progress).toMatchObject({
          callback: 'RETURNED',
          phase,
          captureRevision: selector.expectedCaptureRevision + 1,
          stage: 'COLLECTING',
        });
        if (phase === 'DIARY') {
          const writes = f.state.writes;
          await expect(service.advance(selector)).resolves.toMatchObject({
            phase,
            captureRevision: progress.captureRevision,
            callback: 'NOT_INVOKED',
          });
          expect(f.state.writes).toBe(writes);
        }
        selector = {
          ...selector,
          expectedCaptureRevision: progress.captureRevision,
        };
      }
      const sealed = await service.advance(selector);
      expect(sealed).toMatchObject({
        callback: 'RETURNED',
        phase: 'COMPLETE',
        stage: 'CAPTURE_SEALED',
        captureRevision: selector.expectedCaptureRevision,
        stableCut: 'NOT_ASSESSED',
        businessCommit: 'NOT_AUTHORIZED',
      });
    } finally {
      f.state.allowCaptureReads = false;
    }
    const writes = f.state.writes;
    const sealed = await service.readResumePoint(identity);
    expect(sealed.selector).toEqual(selector);
    expect(sealed.progress).toMatchObject({
      stage: 'CAPTURE_SEALED',
      stableCut: 'NOT_ASSESSED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    await expect(service.advance(f.input)).resolves.toMatchObject({
      stage: 'CAPTURE_SEALED',
      callback: 'NOT_INVOKED',
    });
    expect(f.state.writes).toBe(writes);
    expect(inspect).toHaveBeenCalledTimes(sourceKey ? 1 : 0);
    if (sourceKey)
      expect(f.state.db.files).toMatchObject([
        {
          archiveId: f.selected.archiveId,
          sourceKey,
          source: sourceRevision,
          state: 'PENDING',
        },
      ]);
    expect(storage.copyAndVerify).not.toHaveBeenCalled();
    expect(
      f.state.db.controls.find(
        ({ animalId }) => animalId === f.selected.animalId,
      ),
    ).toMatchObject({
      reservationEpoch: f.selected.reservationEpoch,
      transferLock: reservation,
    });
    expect(f.state.db.requests[0].status).toBe('PROCESSING');
    expect(
      f.state.db.items.find(({ _id }) => _id === f.selected.itemId)?.status,
    ).toBe('PROCESSING');
    await expect(
      f.store.readCopyResumePoint({ selector }),
    ).resolves.toMatchObject({
      manifest: null,
      attempt: null,
      copyDispatch: 'NOT_AUTHORIZED',
    });
    expect(f.state.writes).toBe(writes);
    const manifest = await manifestPreparer.prepareFromCapture(selector);
    expect(manifest).toMatchObject({
      archiveId: f.selected.archiveId,
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
      replayed: false,
    });
    const file = f.state.db.files[0] as unknown as ArchiveFile | undefined;
    const anchor = file && {
      expectedManifestHash: manifest.manifestHash,
      preparation: {
        selector,
        fileId: file.id,
        expectedFileDefinitionHash: file.definitionHash,
        expectedSealHash: manifest.observedSealHash,
        bucket: 'synthetic-cut-media',
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
    if (anchor) {
      const observation = await module
        .get(ItemSourceObservationPreparer)
        .prepareFromManifest(anchor);
      expect(observation).toMatchObject({
        fileId: anchor.preparation.fileId,
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
    }
    expect(read).toHaveBeenCalledTimes(anchor ? 1 : 0);
    expect(f.state.db.copyRecords).toEqual([]);
    expect(storage.copyAndVerify).not.toHaveBeenCalled();
    return { selector, manifest, anchor };
  } finally {
    await module.close();
  }
}

async function prepareInitialOwnership(
  seedAccreditation = true,
  mediaKind: 'none' | 'photo' | 'document' = 'none',
  fixture = acceptanceStartStore(),
  runCopyProtocol = false,
  beforeStart?: (
    store: MongoTransferItemCapture,
    urls: ArchiveProjectionUrls,
    now: () => Date,
  ) => Promise<void>,
) {
  const recordedAt = '2026-10-29T12:02:00.000Z';
  const effectiveAt = '2026-10-29T12:03:00.000Z';
  let at = effectiveAt;
  const now = () => new Date(at);
  const fenceActiveSharedControls = jest.fn().mockResolvedValue(undefined);
  const assertActiveSharedControls = jest.fn().mockResolvedValue(undefined);
  const bytes = Buffer.from(`synthetic ${mediaKind} from the original owner`);
  const [animalId] = [...fixture.input.acceptedAnimalIds].sort();
  const prefix = `users/${fixture.actorId}/animals/${animalId}/`;
  const photoKey = `${prefix}profile_123.jpeg`;
  const originalPhoto = `https://synthetic.invalid/${photoKey}`;
  let sourceKey: string | undefined;
  if (mediaKind === 'photo') {
    sourceKey = photoKey;
    fixture.state.db.animals.find(
      ({ id }) => id === animalId,
    )!.profilePictureUrl = originalPhoto;
    fixture.state.db.media.push({
      finalKey: photoKey,
      pinned: { sha256: createHash('sha256').update(bytes).digest('hex') },
      sealed: { etag: '"source-photo-etag"', size: bytes.length },
    });
  } else if (mediaKind === 'document') {
    const original = archiveMedicalDocument(fixture.id(191));
    const storageKey = `${prefix}medical-documents/prescriptions/${original.id}/revisions/${original.version}/source.pdf`;
    sourceKey = storageKey;
    const document = MedicalDocument.fromPrimitives({
      ...original,
      ownerId: fixture.actorId,
      animalIds: [animalId],
      fileSize: bytes.length,
      storageKey,
      documentLocations: [{ animalId, storageKey }],
      assignments: [{ animalId, extractedItemIds: [] }],
    }).toPrimitives();
    fixture.state.db.medical.push(document);
  }
  const config = {
    now,
    profiles: {
      fenceActiveSourceProfile: jest.fn(),
      fenceActiveSharedControls,
      assertActiveSharedControls,
    },
  };
  const urls = {
    keyFromUrl: fixture.keys.keyFromUrl,
    urlForKey: (key: string) => `https://synthetic.invalid/${key}`,
  };
  const f = await setup(
    config,
    fixture,
    beforeStart && ((store) => beforeStart(store, urls, now)),
  );
  const source = new MongoOwnershipArchiveSource(
    ...([
      f.models[3],
      f.models[7],
      f.models[6],
      f.models[5],
    ] as unknown as ConstructorParameters<typeof MongoOwnershipArchiveSource>),
  );
  const sourceRevision = {
    versionId: `source-${mediaKind}-version`,
    etag: `"source-${mediaKind}-etag"`,
    size: bytes.length,
  };
  const { selector, manifest, anchor } =
    await captureAndPrepareFromOriginalReservation(
      f,
      source,
      sourceKey,
      sourceRevision,
      bytes,
    );
  const archive = f.state.db.archives.find(
    (row) => row.id === f.selected.archiveId,
  )! as unknown as OwnershipArchive;
  const definition = archiveDefinitionOnly(archive);
  const entry = f.state.db.entries.find(
    (row) => row.archiveId === archive.id && row.kind === 'ANIMAL',
  ) as unknown as ArchiveEntry | undefined;
  if (!entry) throw new Error('Expected the captured animal record');
  const { observedSealHash: expectedSealHash, manifestHash } = manifest;
  const manifestInput = { selector, expectedSealHash };
  const requiredThrough = '2026-10-29T12:05:00.000Z';
  const validUntil = '2026-10-29T12:06:00.000Z';
  const coverage = {
    disposition: 'ISOLATED' as const,
    evidenceHash: archiveHash('coverage'),
  };
  const writers = Object.fromEntries(
    PUT_DESTINATION_WRITER_GROUPS.map((group) => [group, coverage]),
  ) as PutDestinationWriters;
  let media:
    | ReturnType<typeof initialCutReconciledMedia>
    | Awaited<ReturnType<typeof runInitialItemCopies>>
    | undefined;
  if (anchor) {
    const { preparation } = anchor;
    if (runCopyProtocol) {
      expect(f.state.db.copyRecords).toEqual([]);
      media = await runInitialItemCopies({
        store: f.store,
        config,
        anchor,
        startFinalModule: (evidence) =>
          startItemCaptureRehearsal(
            TransferItemCaptureModule.register(
              f.capture,
              undefined,
              undefined,
              undefined,
              evidence,
            ),
            f.store,
          ),
        keyFromUrl: f.keys.keyFromUrl,
        bytes,
        id: f.id,
        issuerId: f.recipientId,
        writers,
        validFrom: recordedAt,
        validUntil,
        requiredThrough,
        automatic: fixture.state.db.animals.length === 1,
        outsideTransaction: () =>
          f.sessions.every((session) => !session.inTransaction()),
        hasRecordedPermission: (auditMarkerHash) => {
          const control = f.state.db.controls.find(
            ({ animalId }) => animalId === f.selected.animalId,
          );
          return (
            control?.ownerId === f.actorId &&
            control.reservationEpoch === f.selected.reservationEpoch &&
            f.state.db.requests[0].status === 'PROCESSING' &&
            f.state.db.copyRecords.some(({ permission }) => {
              const record = permission as
                | { auditMarkerHash?: string; state?: string }
                | undefined;
              return (
                record?.state === 'MAY_RUN' &&
                record.auditMarkerHash === auditMarkerHash
              );
            })
          );
        },
      });
    } else {
      const saved = initialCutReconciledMedia(
        await f.store.readHistoricalCopy(preparation),
        {
          manifestHash,
          issuerId: f.recipientId,
          id: f.id,
          writers,
          expectedBucketOwner: '123456789012',
          checkedAt: recordedAt,
          requiredThrough,
          validUntil,
          contentType:
            mediaKind === 'document' ? 'application/pdf' : 'image/jpeg',
        },
      );
      Object.assign(f.state.db.files[0], saved.file);
      f.state.db.copyRecords.push(...saved.rows);
      media = saved;
    }
  }
  const projectionInput = {
    ...manifestInput,
    expectedManifestHash: manifestHash,
    requiredThrough,
  };
  const module = await startItemCaptureRehearsal(
    TransferItemCaptureModule.register(f.capture, urls),
    f.store,
  );
  let selection: Awaited<
    ReturnType<ItemRecipientProjectionReader['prepareSelection']>
  >['selection'];
  try {
    const reader = module.get(ItemRecipientProjectionReader);
    const animalsBefore = structuredClone(f.state.db.animals);
    if (runCopyProtocol && fixture.state.db.animals.length === 2) {
      await expect(reader.prepareSelection(projectionInput)).rejects.toThrow(
        'exact prepared media registration',
      );
      await expect(
        reader.prepareFromFinalVersions({
          ...projectionInput,
          expectedManifestHash: archiveHash('another manifest'),
        }),
      ).rejects.toThrow(/manifest/i);
      expect(f.state.db.registrations).toEqual([]);

      const register = f.store.registerRecipientFinalMedia.bind(f.store);
      const registration = jest
        .spyOn(f.store, 'registerRecipientFinalMedia')
        .mockImplementationOnce((input) => {
          f.state.loseReply = true;
          return register(input);
        });
      try {
        await expect(
          reader.prepareFromFinalVersions(projectionInput),
        ).rejects.toMatchObject({ status: 503 });
      } finally {
        registration.mockRestore();
      }
      expect(f.state.db.registrations).toHaveLength(1);
    }
    const candidate = await reader.prepareFromFinalVersions(projectionInput);
    selection = candidate.selection;
    expect(candidate.projection).toMatchObject({
      manifestHash,
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(candidate.projection.media).toHaveLength(media ? 1 : 0);
    if (media)
      expect(candidate.projection.media[0]).toMatchObject({
        fileId: media.fileId,
        key: media.finalVersion.observation.scope.target.key,
        revision: media.finalVersion.observation.revision,
        state: 'PREPARED',
      });
    expect(f.state.db.animals).toEqual(animalsBefore);
  } finally {
    await module.close();
  }
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
  const report = {
    protocol: 'ITEM_STABLE_CUT_ACCREDITATION_V1' as const,
    issuerId: f.recipientId,
    scopeHash: scope.scopeHash,
    controlsHash: archiveHash('controls'),
    writerInventoryHash: archiveHash('writers'),
    writers,
    copyEffects: coverage,
    validFrom: recordedAt,
    validUntil,
  };
  const pins = {
    selection,
    expectedScopeHash: scope.scopeHash,
    expectedAccreditationHash: archiveHash(report),
  };
  if (seedAccreditation) {
    if (!archive.manifestDigest)
      throw new Error('Expected the saved manifest digest');
    f.state.db.copyRecords.push(
      buildItemStableCutAccreditationRecord(
        scope,
        report,
        buildItemCopyGateDefinition(archive.manifestDigest.binding).id,
        pins.expectedAccreditationHash,
        recordedAt,
      ),
    );
  }
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
    urls,
    source,
    ownershipModels: models,
    now,
    fenceActiveSharedControls,
    effectiveAt,
    media,
    bytes,
    originalPhoto,
    commit: (expected = pins.expectedAccreditationHash) =>
      f.store.commitItemOwnership(
        { ...pins, expectedAccreditationHash: expected },
        urls,
        source,
        models,
      ),
    produceAndRegister: (
      producer: Parameters<typeof f.store.produceAndRegisterItemStableCut>[2],
    ) => f.store.produceAndRegisterItemStableCut(pins, urls, producer),
    setTime: (time: string) => {
      at = time;
    },
  };
}

function initialCutStorage() {
  return {
    readVersion: jest.fn<
      ReturnType<StableCutVersionStorage['readVersion']>,
      Parameters<StableCutVersionStorage['readVersion']>
    >(),
    readSourceRetention: jest.fn<
      ReturnType<StableCutVersionStorage['readSourceRetention']>,
      Parameters<StableCutVersionStorage['readSourceRetention']>
    >(),
  };
}

function initialCutEvidence(
  f: Awaited<ReturnType<typeof prepareInitialOwnership>>,
  {
    scope = f.scope,
    protocol = ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    storage = initialCutStorage(),
  }: {
    scope?: typeof f.scope;
    protocol?: string;
    storage?: ReturnType<typeof initialCutStorage>;
  } = {},
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
  const response = (body: Buffer): GetObjectCommandOutput => ({
    $metadata: { httpStatusCode: 200 },
    VersionId: 'writer-coverage-version',
    Body: Readable.from([body]) as NonNullable<GetObjectCommandOutput['Body']>,
    ContentLength: body.length,
  });
  send.mockImplementation(() => Promise.resolve(response(envelope)));
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
    serveCollectedCoverage(evidence: StableCutWriterEvidenceReader) {
      const issuer = new StableCutWriterCoverageIssuer(
        evidence,
        { issuerId, controlsHash, privateKey },
        f.now,
      );
      send.mockImplementation(async (command) => {
        const issued = await issuer.issue(scope);
        if (!issued) throw new Error('Expected complete writer coverage');
        expect(issued.objectKey).toBe(command.input.Key);
        return response(Buffer.from(JSON.stringify(issued.envelope)));
      });
    },
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

function initialHistory(
  store: MongoTransferItemCapture,
  urls: ArchiveProjectionUrls,
  storage: StableCutVersionStorage,
  now: () => Date,
): AcceptanceHttpHistory {
  const keyFromUrl = urls.keyFromUrl.bind(urls);
  return {
    reader: new PublishedOwnershipHistoryReader(store, keyFromUrl),
    downloader: new PublishedOwnershipHistoryDownloader(
      store,
      storage,
      keyFromUrl,
      5000,
      now,
    ),
  };
}

async function prepareInitialMediaCut(
  mediaKind: 'photo' | 'document' = 'photo',
  fixture = acceptanceStartStore(),
  runCopyProtocol = false,
  beforeStart?: (history: AcceptanceHttpHistory) => Promise<void>,
) {
  const storage = initialCutStorage();
  const f = await prepareInitialOwnership(
    false,
    mediaKind,
    fixture,
    runCopyProtocol,
    beforeStart &&
      ((store, urls, now) =>
        beforeStart(initialHistory(store, urls, storage, now))),
  );
  const { media } = f;
  if (!media) throw new Error('Expected a seeded file');
  const e = initialCutEvidence(f, { storage });
  e.storage.readSourceRetention.mockResolvedValue({
    mode: 'COMPLIANCE',
    expectedBucketOwner: e.bucketOwner,
    reportedRetainUntil: f.report.validUntil,
  });
  if ('versions' in media)
    e.storage.readSourceRetention.mockImplementation(
      media.versions.readSourceRetention,
    );
  const close = jest.fn();
  e.storage.readVersion.mockImplementation((target, revision) => {
    expect(f.sessions.at(-1)?.inTransaction()).toBe(false);
    if ('versions' in media)
      return media.versions.readVersion(target, revision);
    return Promise.resolve({ revision, body: Readable.from([f.bytes]), close });
  });
  return { ...f, media, e, close };
}

describe('Initial item stable-cut evidence', () => {
  restoreNodeDisposeSymbolForSuite();

  it('binds configured acceptance to application providers without contacting storage', async () => {
    const f = await prepareInitialMediaCut();
    const send = jest.fn(() =>
      Promise.reject(new Error('Startup must not contact S3')),
    );
    const client = { send } as unknown as Pick<S3Client, 'send'>;
    const expectedBucketOwner = f.e.bucketOwner;
    const archive = {
      bucket: 'synthetic-put-evidence',
      bucketOwner: expectedBucketOwner,
      issuerId: f.recipientId,
      maxBytes: 4096,
    };
    const unavailable = () => Promise.resolve(null);
    const runtime = InitialTransferAcceptanceModule.forApplication({
      urls: f.urls,
      sourceReader: { head: jest.fn(), read: jest.fn() },
      sourceEvidence: {
        reader: { readSourceRetention: jest.fn(), readFixedSource: jest.fn() },
        destinationAccreditations: {
          readDestinationAccreditation: unavailable,
        },
        expectedBucketOwner,
        now: f.now,
      },
      putEvidence: {
        clients: {
          notificationArchive: client,
          objectVersions: client,
          evidenceArchive: client,
        },
        configuration: {
          notificationArchive: {
            auditBucket: 'synthetic-put-events',
            auditBucketOwner: expectedBucketOwner,
            sourceBucket: 'synthetic-cut-media',
            sourceBucketOwner: expectedBucketOwner,
            sourceRegion: 'us-east-1',
            notificationConfigurationId: 'synthetic-events',
            maxBytes: 4096,
          },
          evidenceArchive: archive,
          conservationControlsHash: archiveHash('test controls'),
        },
      },
      put: {
        transport: { prepare: jest.fn() },
        custody: {
          maxArtifactBytes: 4096,
          maxTotalBytes: 4096,
          maxArtifacts: 1,
          maxOpenReaders: 1,
        },
        evidenceInputs: {
          source: unavailable,
          requiredThrough: unavailable,
          historicalDestination: unavailable,
          stagingDestination: unavailable,
          finalDestination: unavailable,
        },
      },
      stableCut: f.e.producer,
      historyVersions: f.e.storage,
      historyDownloadTimeoutMs: 5000,
    });
    const context = await Test.createTestingModule({
      imports: [SimulatedConnectionModule, runtime],
    })
      .overrideModule(OwnershipArchiveModule)
      .useModule({
        module: SimulatedOwnershipArchiveModule,
        providers: [
          { provide: OwnershipArchiveCapture, useValue: f.capture },
          { provide: 'OwnershipArchiveSource', useValue: f.source },
        ],
        exports: [OwnershipArchiveCapture, 'OwnershipArchiveSource'],
      })
      .overrideProvider(getConnectionToken())
      .useValue({ models: {}, model: () => ({}), db: f.connection.db })
      .overrideProvider('ItemCaptureStore')
      .useValue(f.store)
      .compile();
    try {
      expect(
        context.get<TransferAcceptanceProgress>(TRANSFER_ACCEPTANCE_PROGRESS),
      ).toBeDefined();
      expect(context.get(PublishedOwnershipHistoryReader)).toBeDefined();
      expect(context.get(PublishedOwnershipHistoryDownloader)).toBeDefined();
      expect(context.get<unknown>('ItemCaptureBatch')).toBe(f.capture);
      expect(context.get<unknown>('ItemSourceProfiles')).toBeInstanceOf(
        MongoItemSourceProfileState,
      );
      expect(send).not.toHaveBeenCalled();
    } finally {
      await context.close();
    }
  });

  it.each([1, 2] as const)(
    'captures, copies and accepts one animal from a request with %i, with replay and historical reads',
    rehearseInitialDecision,
  );

  function progressSignal() {
    let notify!: () => void;
    const promise = new Promise<void>((resolve) => {
      notify = resolve;
    });
    return { promise, notify };
  }

  type LocalDecision = {
    http?: Awaited<ReturnType<typeof startAcceptanceHttp>>;
    decision?: Promise<void>;
    progressFinished: ReturnType<typeof progressSignal>;
  };

  async function rehearseInitialDecision(count: 1 | 2) {
    const fixture = acceptanceStartStore(count);
    const local: LocalDecision = { progressFinished: progressSignal() };
    try {
      await runInitialDecision(fixture, count, local);
    } finally {
      local.progressFinished.notify();
      await local.decision?.catch(() => undefined);
      await local.http?.close();
    }
  }

  async function runInitialDecision(
    fixture: ReturnType<typeof acceptanceStartStore>,
    count: 1 | 2,
    local: LocalDecision,
  ) {
    const [selectedAnimalId] = fixture.input.acceptedAnimalIds;
    const rejectedAnimal = fixture.state.db.animals.find(
      ({ id }) => id !== selectedAnimalId,
    );
    if (rejectedAnimal)
      rejectedAnimal.profilePictureUrl = `https://synthetic.invalid/users/${fixture.actorId}/animals/${fixture.id(100)}/profile_456.jpeg`;
    const snapshotRejected = () =>
      rejectedAnimal
        ? {
            animal: structuredClone(rejectedAnimal),
            item: structuredClone(
              fixture.state.db.items.find(
                ({ animalId }) => animalId === rejectedAnimal.id,
              )!,
            ),
            control: structuredClone(
              fixture.state.db.controls.find(
                ({ animalId }) => animalId === rejectedAnimal.id,
              )!,
            ),
            period: structuredClone(
              fixture.state.db.periods.find(
                ({ animalId }) => animalId === rejectedAnimal.id,
              )!,
            ),
          }
        : undefined;
    let rejected: ReturnType<typeof snapshotRejected>;
    const diaryId = fixture.id(190);
    fixture.state.db.diary.push({
      id: diaryId,
      animalId: selectedAnimalId,
      title: 'Control de prueba',
      date: '2026-10-28',
      attachments: [],
      createdAt: '2026-10-28T12:00:00.000Z',
      updatedAt: '2026-10-28T12:00:00.000Z',
    });
    expect(fixture.state.db.requests[0].status).toBe('PENDING');
    const { expectedVersion, acceptedAnimalIds, operationId } = fixture.input;
    const body = { expectedVersion, acceptedAnimalIds };
    const finalStatus = count === 2 ? 'PARTIALLY_ACCEPTED' : 'ACCEPTED';
    const rejectedItems =
      count === 2 ? [{ animalId: fixture.id(100), status: 'REJECTED' }] : [];
    const progressStarted = progressSignal();
    const resume = jest.fn((item: ReturnType<typeof captureIdentity>) => {
      expect(item).toEqual({
        actorId: fixture.recipientId,
        transferId: fixture.input.transferId,
        itemId: transferRecordId(
          'item',
          fixture.input.transferId,
          selectedAnimalId,
        ),
      });
      const row = fixture.state.db.items.find(({ _id }) => _id === item.itemId);
      if (row?.status === 'ACCEPTED') return Promise.resolve();
      expect(row?.status).toBe('PROCESSING');
      progressStarted.notify();
      return local.progressFinished.promise;
    });
    async function postInitialDecision(history: AcceptanceHttpHistory) {
      const http = await startAcceptanceHttp(fixture, {
        history,
        progress: { resume },
      });
      local.http = http;
      rejected = snapshotRejected();
      await http.history('', 'sender').expect(200).expect({ periods: [] });
      const pending = await http.detail().query({ limit: 1 }).expect(200);
      const { nextCursor } = pending.body as { nextCursor?: string };
      await http.decide().send(body).expect(401);
      await http.decide('recipient').send(body).expect(400);
      await http.decide('sender', operationId).send(body).expect(403);
      expect(fixture.state.db.requests[0].status).toBe('PENDING');
      expect(fixture.state.db.archives).toEqual([]);
      expect(resume).not.toHaveBeenCalled();

      if (count === 2) {
        expect(nextCursor).toBeDefined();
        fixture.state.loseReply = true;
        await http.decide('recipient', operationId).send(body).expect(503);
        expect(resume).not.toHaveBeenCalled();
        await http.detail().query({ cursor: nextCursor }).expect(409);
        resume.mockRejectedValueOnce(
          new Error('private simulated storage error'),
        );
        const interrupted = await http
          .decide('recipient', operationId)
          .send(body)
          .expect(503);
        expect(interrupted.body).toMatchObject({
          message:
            'Transfer decision was recorded; retry the same decision with the same Idempotency-Key to check progress',
        });
        expect(fixture.state.db.requests[0].status).toBe('PROCESSING');
      }
      local.decision = http
        .decide('recipient', operationId)
        .send(body)
        .expect('Cache-Control', 'private, no-store')
        .expect(200)
        .then((response) => {
          expect(response.body).toMatchObject({
            id: fixture.input.transferId,
            status: finalStatus,
            version: 3,
            animalCount: count,
            decidedAt: acceptanceAt,
          });
          expect(JSON.stringify(response.body)).not.toMatch(
            /acceptanceStart|captureArchive|ownershipCommit|decisionOperationId/,
          );
        });
      await Promise.race([
        progressStarted.promise,
        local.decision.then(() => {
          throw new Error(
            'The decision returned before resuming the accepted item',
          );
        }),
      ]);
      const processing = await http.detail().expect(200);
      expect(processing.body).toMatchObject({
        request: { status: 'PROCESSING', version: 2 },
        items: [
          ...rejectedItems,
          { animalId: selectedAnimalId, status: 'PROCESSING' },
        ],
      });
      expect(JSON.stringify(processing.body)).not.toMatch(
        /acceptanceStart|captureArchive|captureReservation|ownershipCommit|decisionOperationId|authorizationId/,
      );
      expect(resume).toHaveBeenCalledTimes(count);
      expect(fixture.state.db.archives).toHaveLength(1);
      expect(fixture.state.db.events).toHaveLength(1);
      await http.history('', 'sender').expect(200).expect({ periods: [] });
    }
    jest.useFakeTimers({
      now: new Date(acceptanceAt),
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'],
    });
    const f = await prepareInitialMediaCut(
      'photo',
      fixture,
      true,
      postInitialDecision,
    ).finally(() => {
      jest.useRealTimers();
    });
    const { http } = local;
    const { animalId, periodId } = f.definition;
    const { reader, downloader } = initialHistory(
      f.store,
      f.urls,
      f.e.storage,
      f.now,
    );
    const period = { actorId: f.actorId, periodId, limit: 2 };

    expect(f.decision).toMatchObject({ replayed: !!http, requestVersion: 2 });
    expect(f.decision.binding.rejectedItemIds).toEqual(
      rejected ? [rejected.item._id] : [],
    );
    expect(f.state.db.requests[0].status).toBe('PROCESSING');
    expect(f.state.db.animals.find(({ id }) => id === animalId)?.ownerId).toBe(
      f.actorId,
    );
    expect(f.state.db.claims.map(({ _id }) => _id)).toEqual([selectedAnimalId]);
    const assertRejectedUnchanged = () => {
      if (!rejected) return;
      const { id } = rejected.animal;
      const { _id: itemId } = rejected.item;
      expect(f.state.db.animals.find((row) => row.id === id)).toEqual(
        rejected.animal,
      );
      expect(
        f.state.db.controls.find(({ animalId }) => animalId === id),
      ).toEqual(rejected.control);
      expect(
        f.state.db.periods.filter(({ animalId }) => animalId === id),
      ).toEqual([rejected.period]);
      expect(f.state.db.items.find(({ _id }) => _id === itemId)).toEqual({
        ...rejected.item,
        status: 'REJECTED',
      });
    };
    assertRejectedUnchanged();
    await expect(reader.read(period)).rejects.toThrow('not found');

    const collected = await initialCollector(f);
    f.e.serveCollectedCoverage(collected.validated);
    const prepareCopies = jest.fn(() =>
      Promise.resolve({ requiredThrough: f.pins.selection.requiredThrough }),
    );
    const { receipt, completed, writes, versionReads } =
      await startItemCaptureRehearsal(
        TransferItemCaptureModule.register(
          f.capture,
          f.urls,
          undefined,
          undefined,
          undefined,
          f.e.producer,
          f.source,
          { prepare: prepareCopies },
        ),
        f.store,
        [
          [UserEntity.name, f.ownershipModels.users],
          [TRANSFER_EVENT_MODEL, f.ownershipModels.events],
          [TRANSFER_NOTICE_MODEL, f.ownershipModels.notices],
          [TRANSFER_OUTBOX_MODEL, f.ownershipModels.outbox],
        ],
      ).then(async (cutModule) => {
        try {
          const register = cutModule.get<ItemStableCutRegistrar>(
            ITEM_STABLE_CUT_REGISTRAR,
          );
          const close = cutModule.get<ItemOwnershipCloser>(
            ITEM_OWNERSHIP_CLOSER,
          );
          const progress = cutModule.get<TransferAcceptanceProgress>(
            TRANSFER_ACCEPTANCE_PROGRESS,
          );
          const identity = captureIdentity(f.input);
          const { selection, expectedScopeHash } = f.pins;
          const resumeInput = { selection, expectedScopeHash };
          const before = structuredClone(f.state.db);
          await expect(close.readResumePoint(resumeInput)).resolves.toEqual({
            state: 'PROCESSING',
            commitSelection: null,
          });
          await expect(
            register({
              selection,
              expectedScopeHash: archiveHash('stale scope'),
            }),
          ).rejects.toThrow('stable-cut scope changed');
          expect(f.e.send).not.toHaveBeenCalled();
          expect(f.e.storage.readVersion).not.toHaveBeenCalled();
          expect(f.state.db).toEqual(before);

          const create = f.models[14].create.bind(f.models[14]);
          jest
            .spyOn(f.models[14], 'create')
            .mockImplementationOnce((rows, options) => {
              f.state.loseReply = true;
              return create(rows, options);
            });
          await expect(progress.resume(identity)).rejects.toThrow(
            'simulated lost application response',
          );
          expect(f.state.db.animals).toEqual(before.animals);
          const priorRevision = before.items.find(
            ({ animalId: id }) => id === animalId,
          )?.captureStepRevision;
          expect(f.state.db.items).toEqual(
            before.items.map((item) =>
              item.animalId === animalId
                ? {
                    ...item,
                    captureStepRevision: expect.any(Number) as unknown,
                  }
                : item,
            ),
          );
          expect(
            f.state.db.items.find(({ animalId: id }) => id === animalId)
              ?.captureStepRevision,
          ).toBeGreaterThan(Number(priorRevision ?? 0));
          const recovered = await close.readResumePoint(resumeInput);
          if (recovered.state !== 'PROCESSING' || !recovered.commitSelection)
            throw new Error('Expected the saved stable-cut accreditation');
          const { commitSelection } = recovered;
          expect(commitSelection.selection).toEqual(selection);
          expect(commitSelection.expectedScopeHash).toBe(expectedScopeHash);
          expect(commitSelection.expectedAccreditationHash).toMatch(
            /^[a-f0-9]{64}$/,
          );
          expect(collected.readVersionEvidence.mock.calls).toEqual(
            collected.evidence.putObservations.map(({ observation }) => [
              observation.scope,
              observation.evidenceHash,
            ]),
          );
          expect(collected.readVersionEvidence).toHaveBeenCalledTimes(3);
          const stored = f.state.db.copyRecords.find(
            ({ accreditationHash }) =>
              accreditationHash === commitSelection.expectedAccreditationHash,
          );
          expect(stored).toMatchObject({
            row: 'STABLE_CUT_ACCREDITATION',
            accreditation: {
              copyEffects: { disposition: 'RECONCILED_AND_CONTROLLED' },
            },
          });
          expect(f.e.storage.readVersion).toHaveBeenCalledTimes(5);
          await expect(close.readReceipt(commitSelection)).resolves.toBeNull();
          const commit = f.store.commitItemOwnership.bind(f.store);
          const commitOnce = jest
            .spyOn(f.store, 'commitItemOwnership')
            .mockImplementationOnce((...args) => {
              f.state.loseReply = true;
              return commit(...args);
            });
          try {
            await expect(progress.resume(identity)).rejects.toThrow(
              'could not be acknowledged',
            );
          } finally {
            commitOnce.mockRestore();
          }
          const completed = structuredClone(f.state.db);
          const writes = f.state.writes;
          const versionReads = f.e.storage.readVersion.mock.calls.length;
          const finished = await close.readResumePoint(resumeInput);
          if (finished.state !== 'ACCEPTED')
            throw new Error('Expected the saved ownership receipt');
          const { receipt } = finished;
          await expect(
            progress.resume({ ...identity, actorId: f.actorId }),
          ).rejects.toThrow('Only the recipient');
          await expect(progress.resume(identity)).resolves.toBeUndefined();
          expect(prepareCopies).toHaveBeenCalledTimes(2);
          await expect(close.readReceipt(commitSelection)).resolves.toEqual(
            receipt,
          );
          await expect(close.commit(commitSelection)).resolves.toEqual(receipt);
          return { receipt, completed, writes, versionReads };
        } finally {
          await cutModule.close();
        }
      });

    local.progressFinished.notify();
    await local.decision;
    await expect(fixture.service.start(fixture.input)).resolves.toEqual({
      ...f.decision,
      replayed: true,
    });
    if (rejected)
      await expect(
        fixture.service.start({
          ...fixture.input,
          acceptedAnimalIds: [fixture.id(100)],
        }),
      ).rejects.toThrow('decision differs');
    if (http) {
      const finished = await http.detail().expect(200);
      expect(finished.body).toMatchObject({
        request: { status: finalStatus, version: 3 },
        items: [...rejectedItems, { animalId, status: 'ACCEPTED' }],
      });
      expect(JSON.stringify(finished.body)).not.toMatch(
        /ownershipCommit|accreditationHash|captureArchive|reservationEpoch/,
      );
      const replay = await http
        .decide('recipient', operationId)
        .send(body)
        .expect(200);
      expect(replay.body).toMatchObject({
        id: fixture.input.transferId,
        status: finalStatus,
        version: 3,
        decidedAt: acceptanceAt,
      });
      if (rejected)
        await http
          .decide('recipient', operationId)
          .send({ ...body, acceptedAnimalIds: [fixture.id(100)] })
          .expect(409);
      expect(resume).toHaveBeenCalledTimes(count + 1);
    }

    const finalKey = f.media.finalVersion.observation.scope.target.key;
    expect(finalKey).toMatch(`users/${f.recipientId}/animals/${animalId}/`);
    expect(f.state.db.animals).toHaveLength(count);
    expect(f.state.db.animals.find(({ id }) => id === animalId)).toMatchObject({
      ownerId: f.recipientId,
      profilePictureUrl: f.urls.urlForKey(finalKey),
    });
    expect(f.state.db.requests).toMatchObject([
      {
        status: rejected ? 'PARTIALLY_ACCEPTED' : 'ACCEPTED',
        acceptedItemCount: 1,
        version: 3,
      },
    ]);
    expect(f.state.db.items).toHaveLength(count);
    expect(
      f.state.db.items.find(({ _id }) => _id === f.selected.itemId),
    ).toMatchObject({
      status: 'ACCEPTED',
      ownershipCommit: receipt,
    });
    expect(f.state.db.claims).toEqual([]);
    const control = f.state.db.controls.find(
      ({ animalId: id }) => id === animalId,
    );
    expect(control).toMatchObject({
      ownerId: f.recipientId,
      ownershipVersion: 2,
    });
    expect(control).not.toHaveProperty('transferLock');
    expect(f.state.db.periods).toHaveLength(count + 1);
    assertRejectedUnchanged();
    expect(f.state.db.periods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: periodId,
          ownerId: f.actorId,
          status: 'CLOSED',
        }),
        expect.objectContaining({
          animalId,
          ownerId: f.recipientId,
          status: 'ACTIVE',
        }),
      ]),
    );
    expect(f.state.db.archives).toHaveLength(1);
    expect(f.state.db.events.map(({ type }) => type)).toEqual([
      'REQUEST_ACCEPTANCE_STARTED',
      'ITEM_ACCEPTED',
    ]);
    expect(f.state.db.notices.map(({ userId }) => userId)).toEqual([
      f.actorId,
      f.recipientId,
    ]);
    expect(f.state.db.outbox.map(({ userId }) => userId)).toEqual([
      f.actorId,
      f.recipientId,
    ]);
    expect(f.state.db).toEqual(completed);
    expect(f.state.writes).toBe(writes);
    expect(f.e.send).toHaveBeenCalledTimes(1);
    expect(f.e.storage.readVersion).toHaveBeenCalledTimes(versionReads);

    const page = { ...period, publicationHash: receipt.commitHash };
    await expect(
      reader.list({ actorId: f.actorId, limit: 2 }),
    ).resolves.toMatchObject({
      periods: [{ periodId, animalId, publicationHash: receipt.commitHash }],
    });
    if (rejected)
      await expect(
        reader.read({ ...period, periodId: fixture.id(200) }),
      ).rejects.toThrow('not found');
    const history = await reader.read(page);
    expect(history.mode).toBe('HISTORICAL_READ_ONLY');
    expect(history.entries).toHaveLength(2);
    expect(history.entries.find(({ kind }) => kind === 'ANIMAL')).toMatchObject(
      {
        entryId: f.entry.id,
        media: [{ fileId: f.media.fileId }],
      },
    );
    expect(
      history.entries.find(({ kind }) => kind === 'DIARY_ENTRY'),
    ).toMatchObject({
      resourceId: diaryId,
      data: { title: 'Control de prueba' },
    });
    await expect(
      reader.read({ ...page, actorId: f.recipientId }),
    ).rejects.toThrow('not found');
    const input = {
      actorId: f.actorId,
      periodId,
      publicationHash: receipt.commitHash,
      entryId: f.entry.id,
      fileId: f.media.fileId,
    };
    const openForeignDownload = jest.fn(() => new Writable());
    await expect(
      downloader.download(
        { ...input, actorId: f.recipientId },
        openForeignDownload,
      ),
    ).rejects.toThrow('not found');
    expect(openForeignDownload).not.toHaveBeenCalled();
    expect(f.e.storage.readVersion).toHaveBeenCalledTimes(versionReads);
    const chunks: Buffer[] = [];
    await downloader.download(
      input,
      () =>
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            chunks.push(chunk);
            done();
          },
        }),
    );
    expect(Buffer.concat(chunks)).toEqual(f.bytes);
    const historical = f.media.historicalVersion.observation;
    expect(historical.scope.target.key).not.toBe(finalKey);
    expect(f.e.storage.readVersion).toHaveBeenLastCalledWith(
      historical.scope.target,
      historical.revision,
      expect.any(AbortSignal),
    );
    if (http) await verifyHistoryHttp(f, http.history, input);
    expect(f.state.db).toEqual(completed);
    expect(f.state.writes).toBe(writes);
  }

  async function verifyHistoryHttp(
    f: Awaited<ReturnType<typeof prepareInitialMediaCut>>,
    history: Awaited<ReturnType<typeof startAcceptanceHttp>>['history'],
    expected: PublishedHistoryFileInput,
  ) {
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AnimalTransferModule),
    ).not.toContain(OwnershipHistoryController);
    await history('').expect(401);
    await history('', 'sender').query({ limit: 101 }).expect(400);
    const list = await history('', 'sender')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(list.body).toMatchObject({
      periods: [
        {
          periodId: expected.periodId,
          publicationHash: expected.publicationHash,
          mode: 'HISTORICAL_READ_ONLY',
        },
      ],
    });
    const {
      periods: [{ periodId, publicationHash }],
    } = list.body as {
      periods: Array<{ periodId: string; publicationHash: string }>;
    };
    const period = `/${periodId}`;
    const otherList = await history('', 'recipient').expect(200);
    expect(otherList.body).toEqual({ periods: [] });
    await history(period, 'recipient').expect(404);
    await history(period, 'sender')
      .query({ publicationHash: archiveHash('another publication') })
      .expect(409);
    const first = await history(period, 'sender')
      .query({ limit: 1, publicationHash })
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    type HistoryEntry = { entryId: string; media: { fileId: string }[] };
    const firstPage = first.body as {
      entries: HistoryEntry[];
      nextCursor: string;
    };
    expect(typeof firstPage.nextCursor).toBe('string');
    expect(firstPage.entries).toHaveLength(1);
    await history(period, 'sender')
      .query({ cursor: firstPage.nextCursor + '=' })
      .expect(400);
    await history(period, 'recipient')
      .query({ cursor: firstPage.nextCursor })
      .expect(400);
    const second = await history(period, 'sender')
      .query({ limit: 1, cursor: firstPage.nextCursor, publicationHash })
      .expect(200);
    const secondPage = second.body as { entries: HistoryEntry[] };
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.entries[0].entryId).not.toBe(
      firstPage.entries[0].entryId,
    );
    expect(second.body).not.toHaveProperty('nextCursor');
    expect(JSON.stringify([first.body, second.body])).not.toMatch(
      /"(?:captureArchive|ownershipCommit|bucket|versionId|storageKey|profilePictureUrl)"\s*:/,
    );

    const entry = [...firstPage.entries, ...secondPage.entries].find(
      ({ media }) => media.length > 0,
    );
    if (!entry) throw new Error('Expected the photo in the published history');
    expect(entry.media).toEqual([
      { fileId: expected.fileId, path: '/profilePictureUrl' },
    ]);
    const {
      entryId,
      media: [{ fileId }],
    } = entry;
    expect(entryId).toBe(expected.entryId);
    const file = `${period}/entries/${entryId}/files/${fileId}`;

    const reads = f.e.storage.readVersion.mock.calls.length;
    await history(file, 'sender').expect(400);
    await history(file, 'recipient').query({ publicationHash }).expect(404);
    await history(
      `${period}/entries/${archiveHash('other entry')}/files/${fileId}`,
      'sender',
    )
      .query({ publicationHash })
      .expect(404);
    expect(f.e.storage.readVersion).toHaveBeenCalledTimes(reads);
    const response = await history(file, 'sender')
      .query({ publicationHash })
      .expect('Cache-Control', 'private, no-store')
      .expect('Content-Type', 'application/octet-stream')
      .expect('Content-Disposition', 'attachment')
      .expect('Content-Length', String(f.bytes.length))
      .expect(200);
    expect(response.body).toEqual(f.bytes);

    f.e.storage.readVersion.mockImplementationOnce((_target, revision) =>
      Promise.resolve({
        revision: { ...revision, etag: '"different"' },
        body: Readable.from([f.bytes]),
        close: () => undefined,
      }),
    );
    await history(file, 'sender')
      .query({ publicationHash })
      .expect('Content-Type', /json/)
      .expect(409);

    const close = jest.fn();
    f.e.storage.readVersion.mockImplementationOnce((_target, revision) =>
      Promise.resolve({
        revision,
        body: Readable.from(
          (async function* () {
            yield f.bytes.subarray(0, -1);
            await new Promise<void>((resolve) => setImmediate(resolve));
            yield Buffer.from([f.bytes[f.bytes.length - 1] ^ 0xff]);
          })(),
        ),
        close,
      }),
    );
    await expect(
      history(file, 'sender').query({ publicationHash }),
    ).rejects.toThrow(/aborted|ECONNRESET|socket hang up/i);
    expect(close).toHaveBeenCalledTimes(1);
  }

  async function readInitialCopyEvidence(
    supplied?: Awaited<ReturnType<typeof prepareInitialMediaCut>>,
  ) {
    const f = supplied ?? (await prepareInitialMediaCut());
    const session = await f.connection.startSession();
    try {
      const evidence = (await session.withTransaction(
        () =>
          f.store.readItemStableCutCopyAttemptsWithinTransaction(
            f.pins.selection,
            session as unknown as ClientSession,
            f.urls,
          ),
        {
          readConcern: { level: 'snapshot' },
          readPreference: 'primary',
          writeConcern: { w: 'majority' },
        },
      )) as Awaited<
        ReturnType<
          typeof f.store.readItemStableCutCopyAttemptsWithinTransaction
        >
      >;
      return { f, evidence };
    } finally {
      await session.endSession();
    }
  }

  it('exports exact local attempts and observations in the initial scope snapshot', async () => {
    const {
      f,
      evidence: { scope, initialCopyAttempts, putObservations },
    } = await readInitialCopyEvidence();
    expect(scope).toEqual(f.scope);
    expect(initialCopyAttempts).toHaveLength(3);
    expect(
      initialCopyAttempts.every((pin) => pin.permission !== undefined),
    ).toBe(true);
    expect(
      matchItemStableCutCopyPermissionIdentities(
        scope.copyInventory,
        initialCopyAttempts,
      ),
    ).toEqual(initialCopyAttempts.map(archiveHash));
    expect(putObservations.map(({ attemptId }) => attemptId)).toEqual(
      initialCopyAttempts.map(({ attemptId }) => attemptId),
    );
    expect(f.state.writes).toBe(0);
  });

  async function initialCollector(
    supplied?: Awaited<ReturnType<typeof prepareInitialMediaCut>>,
  ) {
    const { f, evidence } = await readInitialCopyEvidence(supplied);
    const { scope, initialCopyAttempts } = evidence;
    const { controlsHash, validFrom, validUntil } = f.report;
    const binding = {
      scopeHash: scope.scopeHash,
      controlsHash,
      validFrom,
      validUntil,
    };
    const identityHashes = initialCopyAttempts.map(archiveHash);
    const inventory = {
      ...binding,
      groups: Object.fromEntries(
        STABLE_CUT_COVERAGE_GROUPS.map((group) => [
          group,
          {
            completenessEvidenceHash: archiveHash(group),
            identityHashes: group === 'copyEffects' ? identityHashes : [],
          },
        ]),
      ) as unknown as StableCutWriterInventory['groups'],
    };
    const groups = Object.fromEntries(
      STABLE_CUT_COVERAGE_GROUPS.map((group) => [group, []]),
    ) as unknown as StableCutWriterFindings['groups'];
    const authority = {
      readInventory: jest.fn(() => Promise.resolve(inventory)),
      readOtherFindings: jest.fn(
        (
          _scope: typeof scope,
          _controls: string,
          writerInventoryHash: string,
        ) => Promise.resolve({ ...binding, groups, writerInventoryHash }),
      ),
    };
    const reports = new Map(
      f.media.rows.flatMap((row) =>
        'versionRecord' in row && row.versionRecord
          ? [
              [
                row.versionRecord.observation.evidenceHash,
                row.versionRecord.evidence,
              ] as const,
            ]
          : [],
      ),
    );
    const readVersionEvidence = jest.fn(
      (_scope: ItemHistoricalPutVersionScope, hash: string) =>
        Promise.resolve(reports.get(hash) ?? null),
    );
    const reader = { readVersionEvidence };
    const source = new ItemStableCutPutEvidenceSource(
      evidence,
      authority,
      {
        ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1: reader,
        ITEM_STAGING_PUT_VERSION_EVIDENCE_V1: reader,
        ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1: reader,
      },
      f.e.storage,
    );
    const validated = new StableCutInventoryEvidenceReader(source);
    return {
      f,
      evidence,
      authority,
      identityHashes,
      readVersionEvidence,
      validated,
      collect: () => validated.readVerifiedEvidence(scope, controlsHash),
    };
  }

  it('collects independent initial PUT findings using the original attempt identities', async () => {
    const { collect, evidence, identityHashes, readVersionEvidence, f } =
      await initialCollector();
    const report = await collect();
    expect(
      report?.findings.groups.copyEffects.map(
        ({ identityHash }) => identityHash,
      ),
    ).toEqual([...identityHashes].sort());
    expect(readVersionEvidence.mock.calls).toEqual(
      evidence.putObservations.map(({ observation }) => [
        observation.scope,
        observation.evidenceHash,
      ]),
    );
    expect(f.e.storage.readVersion).toHaveBeenCalledTimes(3);
    expect(f.state.writes).toBe(0);
  });

  it('rejects the coverage pair when a reconciled initial PUT lacks its independent report', async () => {
    const { collect, readVersionEvidence, f } = await initialCollector();
    readVersionEvidence.mockResolvedValueOnce(null);
    await expect(collect()).rejects.toThrow(
      'PUT version evidence is inconsistent',
    );
    expect(f.e.storage.readVersion).not.toHaveBeenCalled();
  });

  it('closes the first transfer with both exact copies of one captured photo', async () => {
    const f = await prepareInitialMediaCut();
    const { media, e, close } = f;
    expect(f.scope.copyInventory).toMatchObject({
      attemptCount: 3,
      permissionCount: 3,
    });
    const registered = await f.produceAndRegister(e.producer);
    expect(
      registered.record.accreditation.retainedVersionsEvidenceHash,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(registered.observation.businessCommit).toBe('NOT_AUTHORIZED');
    expect(e.storage.readVersion.mock.calls).toEqual(
      [media.historicalVersion.observation, media.finalVersion.observation].map(
        ({ scope, revision }) => [scope.target, revision],
      ),
    );
    expect(close).toHaveBeenCalledTimes(2);
    expect(f.state.db.animals[0]).toMatchObject({
      ownerId: f.actorId,
      profilePictureUrl: f.originalPhoto,
    });
    expect(f.state.db.items[0].status).toBe('PROCESSING');

    const receipt = await f.commit(registered.record.accreditationHash);
    const finalKey = media.finalVersion.observation.scope.target.key;
    expect(receipt.archiveId).toBe(f.definition.id);
    expect(f.state.db.items[0].status).toBe('ACCEPTED');
    expect(f.state.db.animals[0]).toMatchObject({
      ownerId: f.recipientId,
      profilePictureUrl: `https://synthetic.invalid/${finalKey}`,
    });
    expect(
      f.state.db.periods.find((period) => period.id === f.definition.periodId),
    ).toMatchObject({
      status: 'CLOSED',
      ownerId: f.actorId,
    });
    expect(f.state.db.archives[0].evidenceConsumption).toMatchObject({
      accreditationHash: registered.record.accreditationHash,
    });
  });

  it('transfers the accepted medical document and preserves its historical record', async () => {
    const f = await prepareInitialMediaCut('document');
    const { definition, e, media } = f;
    const original = structuredClone(f.state.db.medical[0]);
    const registered = await f.produceAndRegister(e.producer);
    expect(registered.observation.businessCommit).toBe('NOT_AUTHORIZED');
    expect(f.state.db.medical).toEqual([original]);

    const historical = media.historicalVersion.observation;
    const final = media.finalVersion.observation;
    expect(e.storage.readVersion.mock.calls).toEqual([
      [historical.scope.target, historical.revision],
      [final.scope.target, final.revision],
    ]);
    const revisionPrefix = `medical-documents/prescriptions/${f.id(191)}/revisions/2`;
    expect(historical.scope.target.key).toBe(
      `users/${f.actorId}/animals/${definition.animalId}/ownership-archives/${definition.id}/${revisionPrefix}/source.pdf`,
    );
    const storageKey = `users/${f.recipientId}/animals/${definition.animalId}/${revisionPrefix}/transfer-generations/${definition.id}/${media.fileId}/source.pdf`;
    expect(final.scope.target.key).toBe(storageKey);

    const receipt = await f.commit(registered.record.accreditationHash);
    expect(f.state.db.medical).toEqual([
      {
        ...original,
        ownerId: f.recipientId,
        storageKey,
        documentLocations: [{ animalId: definition.animalId, storageKey }],
      },
    ]);
    const reader = new PublishedOwnershipHistoryReader(
      f.store,
      f.keys.keyFromUrl,
    );
    const history = await reader.read({
      actorId: f.actorId,
      periodId: definition.periodId,
      publicationHash: receipt.commitHash,
      limit: 2,
    });
    const document = history.entries.find(
      ({ kind }) => kind === 'MEDICAL_DOCUMENT',
    );
    expect(document).toMatchObject({
      resourceId: original.id,
      data: {
        ownerId: f.actorId,
        finalCategory: original.finalCategory,
        documentCode: original.documentCode,
        validatedExtraction: original.validatedExtraction,
        version: original.version,
        acceptedAt: original.acceptedAt,
      },
      media: [{ fileId: media.fileId }],
    });
  });

  it('leaves ownership and evidence untouched when pending medical work is found at close', async () => {
    const f = await prepareInitialMediaCut('document');
    const { record } = await f.produceAndRegister(f.e.producer);
    f.state.db.medical.push({
      ...f.state.db.medical[0],
      id: f.id(192),
      status: MedicalDocumentStatus.Analyzing,
    });
    const before = structuredClone(f.state.db);

    await expect(f.commit(record.accreditationHash)).rejects.toThrow(
      'pending medical work',
    );
    expect(f.state.db).toEqual(before);
  });

  it('keeps an initial photo and its reservation when the final copy returns different bytes', async () => {
    const f = await prepareInitialMediaCut();
    const { e, close } = f;
    e.storage.readVersion.mockImplementation((target, revision) =>
      Promise.resolve({
        revision,
        body: Readable.from([
          target.key === f.media.finalVersion.observation.scope.target.key
            ? Buffer.alloc(f.bytes.length, 1)
            : f.bytes,
        ]),
        close,
      }),
    );
    const reservation = structuredClone(f.state.db.controls[0]);
    await expect(f.produceAndRegister(e.producer)).rejects.toThrow(
      'evidence is inconsistent',
    );
    expect(e.storage.readVersion).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(f.state.db.copyRecords.map(({ row }) => row)).toEqual([
      'GATE',
      'ATTEMPT',
      'ATTEMPT',
      'ATTEMPT',
    ]);
    expect(f.state.db.controls[0]).toEqual(reservation);
    expect(f.state.db.animals[0]).toMatchObject({
      ownerId: f.actorId,
      profilePictureUrl: f.originalPhoto,
    });
    expect(f.state.db.items[0].status).toBe('PROCESSING');
  });

  it('rolls back the photo, publication and evidence consumption after a late outbox failure', async () => {
    const f = await prepareInitialMediaCut();
    const { record } = await f.produceAndRegister(f.e.producer);
    const before = structuredClone(f.state.db);
    let interrupted: typeof f.state.db | undefined;
    jest
      .spyOn(f.models[17], 'insertMany')
      .mockImplementationOnce((_, options) => {
        interrupted = options.session?.current;
        throw new Error('Synthetic outbox failure');
      });
    await expect(f.commit(record.accreditationHash)).rejects.toThrow(
      'could not be acknowledged',
    );
    expect(interrupted?.animals[0]).toMatchObject({
      ownerId: f.recipientId,
      profilePictureUrl: `https://synthetic.invalid/${f.media.finalVersion.observation.scope.target.key}`,
    });
    expect(interrupted?.archives[0].evidenceConsumption).toMatchObject({
      accreditationHash: record.accreditationHash,
    });
    expect(f.state.db).toEqual(before);
    await expect(
      f.store.readItemOwnershipCommit({
        ...f.pins,
        expectedAccreditationHash: record.accreditationHash,
      }),
    ).resolves.toBeNull();
  });

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
    const e = initialCutEvidence(f, { scope });
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
    const e = initialCutEvidence(f, { scope });
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
    const e = initialCutEvidence(f, {
      protocol: LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    });
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
    const { selection, expectedScopeHash } = f.pins;
    await expect(
      f.store.readItemOwnershipResumePoint(
        { selection, expectedScopeHash },
        f.urls,
      ),
    ).resolves.toEqual({
      state: 'ACCEPTED',
      receipt: written,
    });
    await expect(
      f.store.readItemOwnershipResumePoint(
        { selection, expectedScopeHash: archiveHash('other scope') },
        f.urls,
      ),
    ).rejects.toThrow('inconsistent with the selected decision');
    await expect(
      f.store.readItemOwnershipCommit({
        ...f.pins,
        expectedAccreditationHash: archiveHash('another report'),
      }),
    ).rejects.toThrow('inconsistent with the selected decision');
    expect(f.state.writes).toBe(writes);
  });

  it('rejects an ambiguous stable-cut recovery while the item remains processing', async () => {
    const f = await prepareInitialOwnership();
    const { selection, expectedScopeHash } = f.pins;
    const alternate = {
      ...f.report,
      controlsHash: archiveHash('alternate controls'),
    };
    const gateId = f.state.db.copyRecords[0]?.gateId;
    if (typeof gateId !== 'string')
      throw new Error('Expected a seeded accreditation');
    f.state.db.copyRecords.push(
      buildItemStableCutAccreditationRecord(
        f.scope,
        alternate,
        gateId,
        archiveHash(alternate),
        f.report.validFrom,
      ),
    );
    const before = structuredClone(f.state.db);
    await expect(
      f.store.readItemOwnershipResumePoint(
        { selection, expectedScopeHash },
        f.urls,
      ),
    ).rejects.toThrow('Multiple accreditations');
    expect(f.state.writes).toBe(0);
    expect(f.state.db).toEqual(before);
  });
});
