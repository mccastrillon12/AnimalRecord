import type { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import {
  Animal,
  type AnimalPrimitiveType,
} from '../../../src/context/animal/domain/animal';
import { ItemHistoricalCopyObserver } from '../../../src/context/animal-transfer/application/item-historical-copy-observer';
import { ItemManifestObserver } from '../../../src/context/animal-transfer/application/item-manifest-observer';
import { ItemRecipientFinalCoverageObserver } from '../../../src/context/animal-transfer/application/item-recipient-final-coverage-observer';
import { ItemRecipientProjectionReader } from '../../../src/context/animal-transfer/application/item-recipient-projection-reader';
import { ItemStableCutEvidenceProducer } from '../../../src/context/animal-transfer/application/item-stable-cut-evidence-producer';
import { LaterPeriodStableCutEvidenceProducer } from '../../../src/context/animal-transfer/application/later-period-stable-cut-evidence-producer';
import { OwnershipArchiveHistoryImporter } from '../../../src/context/animal-transfer/application/ownership-archive-history-importer';
import { OwnershipArchivePreparer } from '../../../src/context/animal-transfer/application/ownership-archive-preparer';
import { PublishedHistoryFinalCoverageObserver } from '../../../src/context/animal-transfer/application/published-history-final-coverage-observer';
import { PublishedHistoryRecipientProjectionReader } from '../../../src/context/animal-transfer/application/published-history-recipient-projection-reader';
import { PublishedOwnershipHistoryDownloader } from '../../../src/context/animal-transfer/application/published-ownership-history-downloader';
import { PublishedOwnershipHistoryReader } from '../../../src/context/animal-transfer/application/published-ownership-history-reader';
import {
  archiveHash,
  buildArchiveEntry,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { archiveDefinitionOnly } from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import { transferRecordId } from '../../../src/context/animal-transfer/domain/transfer-record-id';
import {
  PUT_DESTINATION_WRITER_GROUPS,
  type PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import type { PublishedHistoryStableCutAccreditation } from '../../../src/context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import {
  ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
  itemSourceControlsHash,
} from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-item-source-profile-state';
import { MongoOwnershipArchiveHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { MongoTransferAcceptanceStart } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-acceptance-start';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { AwsItemHistoricalObjectReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-historical-object-reader';
import {
  AwsSignedItemStableCutCoverage,
  ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-signed-stable-cut-coverage';
import { AnimalTransferReasonCode } from '../../../src/context/catalogs/domain/animal-transfer-reason';
import { MedicalDocumentStatus } from '../../../src/context/medical-document/domain/medical-document';
import { initialCutReconciledMedia } from '../fixtures/initial-cut-reconciled-media.fixture';
import { laterPeriodLiveCopyRecords } from '../fixtures/later-period-live-media.fixture';
import { archiveMedicalDocument } from '../fixtures/ownership-archive.fixture';
import { publishedRetainedCopyChain } from '../fixtures/published-retained-copy-chain.fixture';
import { restoreNodeDisposeSymbolForSuite } from './support/restore-node-dispose-symbol';
import { TransferAcceptanceMongoFixture } from './support/transfer-acceptance-mongo-fixture';
import { readAcceptanceMongoSettings } from './support/transfer-acceptance-mongo-safety';

const bucket = 'synthetic-initial-cut-media';
const bucketOwner = '123456789012';
const auditBucket = 'synthetic-initial-cut-audit';
const photo = Buffer.from('synthetic first-transfer photo');
const urlForKey = (key: string) => `https://acceptance.invalid/${key}`;

async function seedInitialCut(
  fixture: TransferAcceptanceMongoFixture,
  kind: 'photo' | 'document',
) {
  const { left, right } = fixture;
  const { rows } = left;
  const keyFromUrl = (url: string) => left.storage.keyFromUrl(url);
  const input = await fixture.seedAcceptance(1);
  const {
    actorId,
    acceptedAnimalIds,
    expectedVersion,
    operationId,
    transferId,
  } = input;
  const [animalId] = acceptedAnimalIds;
  const owner = await rows.animals.collection.findOne({ id: animalId });
  const ownerId: unknown = owner?.ownerId;
  if (!owner || typeof ownerId !== 'string')
    throw new Error('Missing synthetic animal owner');
  const prefix = `users/${ownerId}/animals/${animalId}/`;
  const bytes =
    kind === 'photo' ? photo : Buffer.from('synthetic first-transfer PDF');
  if (kind === 'document') {
    const original = archiveMedicalDocument(randomUUID());
    const storageKey = `${prefix}medical-documents/prescriptions/${original.id}/revisions/${original.version}/source.pdf`;
    await rows.medical.create(
      [
        {
          ...original,
          ownerId,
          animalIds: [animalId],
          fileSize: bytes.length,
          storageKey,
          documentLocations: [{ animalId, storageKey }],
          assignments: [{ animalId, extractedItemIds: [] }],
        },
      ],
      { w: 'majority' },
    );
  }

  const receipt = await left.start.start({
    actorId,
    acceptedAnimalIds,
    expectedVersion,
    operationId,
    transferId,
  });
  const selected = receipt.binding.selected[0];
  const archive = await rows.archives
    .findOne({ id: selected.archiveId })
    .lean()
    .exec();
  if (!archive) throw new Error('Missing synthetic initial archive');
  const originalPhoto = urlForKey(`${prefix}profile_123.jpeg`);
  if (kind === 'photo') {
    expect(
      await rows.animals.collection.updateOne(
        { id: animalId, ownerId: archive.ownerId },
        { $set: { profilePictureUrl: originalPhoto } },
      ),
    ).toMatchObject({ modifiedCount: 1 });
  }
  const definition = archiveDefinitionOnly(archive);
  const animalRecord = buildArchiveEntry(
    definition,
    {
      kind: 'ANIMAL',
      data: Animal.fromPrimitives({
        ...(owner as unknown as AnimalPrimitiveType),
        ...(kind === 'photo' ? { profilePictureUrl: originalPhoto } : {}),
      }).toPrimitives(),
    },
    keyFromUrl,
  );
  const records = [animalRecord];
  let medicalDocument: ReturnType<typeof archiveMedicalDocument> | undefined;
  if (kind === 'document') {
    // Capture and close both normalize the document read from Mongo.
    const documents = await left.archiveSource.listAcceptedDocuments(
      archive.animalId,
      undefined,
      2,
    );
    if (documents.length !== 1)
      throw new Error('Expected one persisted accepted medical document');
    [medicalDocument] = documents;
    records.push(
      buildArchiveEntry(
        definition,
        { kind: 'MEDICAL_DOCUMENT', data: medicalDocument },
        keyFromUrl,
      ),
    );
  }
  const [sourceFile] = records.flatMap(({ files }) => files);
  if (!sourceFile) throw new Error('Missing synthetic archive file');
  const sourceRevision = {
    versionId: `source-${kind}-version`,
    etag: `"source-${kind}-etag"`,
    size: bytes.length,
  };
  const fileFacts = { ...sourceFile, source: sourceRevision };
  const file = {
    ...fileFacts,
    definitionHash: archiveHash(fileFacts),
    state: 'PENDING' as const,
  };
  await rows.entries.create(
    records.map(({ entry }) => entry),
    { w: 'majority' },
  );
  await rows.files.create([file], { w: 'majority' });
  expect(
    await rows.archives
      .updateOne(
        { id: archive.id, state: 'COLLECTING' },
        {
          $set: {
            state: 'COPYING',
            capture: {
              revision: 3,
              phase: 'COMPLETE',
              entryCount: records.length,
            },
            expectedEntryCount: records.length,
            expectedFileCount: 1,
          },
        },
      )
      .exec(),
  ).toMatchObject({ modifiedCount: 1 });

  const checkedAt = receipt.binding.startedAt;
  const start = Date.parse(checkedAt);
  const now = () => new Date(start + 1_000);
  const requiredThrough = new Date(start + 60_000).toISOString();
  const validUntil = new Date(start + 120_000).toISOString();
  left.sourceRetentionReader.reportedRetainUntil = validUntil;
  const storeOn = (side: typeof left, clock = now) =>
    new MongoTransferItemCapture(
      side.rows.requests,
      side.rows.items,
      side.rows.claims,
      side.rows.archives,
      side.rows.controls,
      side.rows.periods,
      side.rows.files,
      side.rows.entries,
      side.rows.copyRecords,
      { profiles: side.sourceProfiles, now: clock },
      side.rows.registrations,
    );
  const store = storeOn(left);
  const selector = {
    actorId: input.actorId,
    transferId: input.transferId,
    itemId: selected.itemId,
    decisionOperationId: input.operationId,
    expectedRequestVersion: receipt.requestVersion,
    expectedCaptureRevision: 3,
  };
  const { observedSealHash: expectedSealHash } =
    await store.inspectCopyPreparation(selector);
  const manifestInput = { selector, expectedSealHash };
  const manifest = await new ItemManifestObserver(store, keyFromUrl).observe(
    manifestInput,
  );
  await store.confirmManifestDigest(manifestInput, manifest);
  const preparation = {
    ...manifestInput,
    fileId: file.id,
    expectedFileDefinitionHash: file.definitionHash,
    bucket,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await store.prepareHistoricalCopy(preparation);
  left.sourceReader.bytes = bytes;
  left.sourceReader.revision = sourceRevision;
  const sourceObserver = new ItemHistoricalCopyObserver(
    store,
    left.sourceReader,
  );
  await store.confirmSourceObservation(
    preparation,
    await sourceObserver.observeSource(preparation),
  );

  const generations = ['writer coverage', 'version conservation'].map(
    (purpose) => {
      const generationId = randomUUID();
      const configurationHash = archiveHash(purpose);
      return {
        _id: itemSourceControlsHash(generationId, configurationHash),
        protocol: ITEM_SOURCE_PROFILE_STATE_PROTOCOL,
        row: 'CONTROLS' as const,
        state: 'ACTIVE' as const,
        generationId,
        configurationHash,
      };
    },
  );
  const [writerControls, conservationControls] = generations;
  await left.sourceProfileRows.insertMany(generations, {
    writeConcern: { w: 'majority' },
  });
  const copyEffects = {
    disposition: 'ISOLATED' as const,
    evidenceHash: archiveHash('synthetic isolation'),
  };
  const writers = Object.fromEntries(
    PUT_DESTINATION_WRITER_GROUPS.map((group) => [group, copyEffects]),
  ) as PutDestinationWriters;
  const media = initialCutReconciledMedia(
    await store.readHistoricalCopy(preparation),
    {
      manifestHash: manifest.manifestHash,
      issuerId: input.actorId,
      id: () => randomUUID(),
      writers,
      expectedBucketOwner: bucketOwner,
      checkedAt,
      requiredThrough,
      validUntil,
      conservationControlsHash: conservationControls._id,
      contentType: medicalDocument?.mimeType ?? 'image/jpeg',
    },
  );
  // Begin with reconciled copy records. Only Mongo participates in the exercise.
  await rows.copyRecords.collection.insertMany(
    media.rows.map((record) => ({ ...record })),
    {
      writeConcern: { w: 'majority' },
    },
  );
  const { stagingCopyIntent, recipientFinalCopyIntent } = media.file;
  expect(
    await rows.files
      .updateOne(
        { id: file.id, archiveId: archive.id },
        {
          $set: { stagingCopyIntent, recipientFinalCopyIntent },
        },
      )
      .exec(),
  ).toMatchObject({ modifiedCount: 1 });
  const cutInput = {
    ...manifestInput,
    expectedManifestHash: manifest.manifestHash,
    requiredThrough,
  };
  await store.registerRecipientFinalMedia({
    ...cutInput,
    fileId: file.id,
    expectedVersionObservationHash:
      media.finalVersion.observation.observationHash,
  });
  const urls = { keyFromUrl, urlForKey };
  const { selection } = await new ItemRecipientProjectionReader(
    store,
    new ItemRecipientFinalCoverageObserver(store),
    urls,
  ).prepareSelection(cutInput);
  const session = await left.connection.startSession();
  let scope: Awaited<
    ReturnType<typeof store.readItemStableCutScopeWithinTransaction>
  >['scope'];
  try {
    const snapshot = await session.withTransaction(
      () =>
        store.readItemStableCutScopeWithinTransaction(selection, session, urls),
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      },
    );
    scope = snapshot.scope;
  } finally {
    await session.endSession();
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const report = {
    issuerId: input.actorId,
    scopeHash: scope.scopeHash,
    controlsHash: writerControls._id,
    writerInventoryHash: archiveHash(writers),
    writers,
    copyEffects,
    validFrom: checkedAt,
    validUntil,
  };
  const protocol = ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL;
  const signature = sign(
    null,
    Buffer.from(archiveHash({ protocol, report }), 'hex'),
    privateKey,
  ).toString('base64');
  const blob = Buffer.from(JSON.stringify({ protocol, report, signature }));
  // The AWS adapter is exercised with a synthetic client that can only return the exact report.
  const signed = new AwsSignedItemStableCutCoverage(
    {
      send: (command: GetObjectCommand) => {
        expect(command.input).toEqual({
          Bucket: auditBucket,
          ExpectedBucketOwner: bucketOwner,
          Key: `stable-cut-writer-coverage/v1/${scope.scopeHash}.json`,
        });
        return Promise.resolve({
          $metadata: { httpStatusCode: 200 },
          VersionId: 'signed-coverage-version',
          Body: Readable.from([blob]),
          ContentLength: blob.length,
        });
      },
    } as unknown as Pick<S3Client, 'send'>,
    {
      bucket: auditBucket,
      bucketOwner,
      issuerId: report.issuerId,
      controlsHash: report.controlsHash,
      publicKey,
      maxBytes: 4096,
    },
    now,
  );
  type Storage = ConstructorParameters<typeof ItemStableCutEvidenceProducer>[1];
  const readVersion = jest.fn<
    ReturnType<Storage['readVersion']>,
    Parameters<Storage['readVersion']>
  >((_target, revision) => {
    const body = Readable.from([bytes]);
    return Promise.resolve({ revision, body, close: () => body.destroy() });
  });
  const producer = new ItemStableCutEvidenceProducer(
    signed,
    {
      readVersion,
      readSourceRetention: (target) =>
        left.sourceRetentionReader.readSourceRetention(target),
    },
    now,
  );
  const pins = { selection, expectedScopeHash: scope.scopeHash };
  type Producer = Parameters<typeof store.produceAndRegisterItemStableCut>[2];
  return {
    archive,
    entry: animalRecord.entry,
    file,
    input,
    media,
    medicalDocument,
    originalPhoto,
    writerControls,
    conservationControls,
    writers,
    copyEffects,
    now,
    urls,
    keyFromUrl,
    publishedStore: storeOn(right),
    storeOn,
    scope,
    producer,
    readVersion,
    register: (evidence: Producer = producer) =>
      store.produceAndRegisterItemStableCut(pins, urls, evidence),
    close: (hash: string) =>
      store.commitItemOwnership(
        { ...pins, expectedAccreditationHash: hash },
        urls,
        left.archiveSource,
        rows,
      ),
    read: (hash: string) =>
      storeOn(right).readItemOwnershipCommit({
        ...pins,
        expectedAccreditationHash: hash,
      }),
  };
}

async function startSuccessor(
  side: TransferAcceptanceMongoFixture['right'],
  predecessor: Awaited<
    ReturnType<MongoTransferItemCapture['commitItemOwnership']>
  >,
  history: MongoOwnershipArchiveHistory,
) {
  const { rows } = side;
  const { animalId, ownerId, ownershipVersion, effectiveAt } = predecessor;
  const transferId = randomUUID();
  const actorId = randomUUID();
  const operationId = randomUUID();
  const input = {
    actorId,
    transferId,
    operationId,
    expectedVersion: 1,
    acceptedAnimalIds: [animalId],
  };
  await rows.users.collection.insertOne({
    id: actorId,
    name: 'Tercer dueño',
    identificationNumber: 'synthetic-300',
  });
  await rows.requests.create(
    [
      {
        _id: transferId,
        senderId: ownerId,
        senderName: 'Luis',
        recipientId: actorId,
        recipientName: 'Tercer dueño',
        reasonCode: AnimalTransferReasonCode.Other,
        reasonName: 'Otro',
        status: 'PENDING',
        version: input.expectedVersion,
        animalCount: 1,
        createdAt: effectiveAt,
        bodyHash: archiveHash([transferId, animalId, actorId]),
        authorizationChallengeId: randomUUID(),
      },
    ],
    { w: 'majority' },
  );
  await rows.items.create(
    [
      {
        _id: transferRecordId('item', transferId, animalId),
        transferId,
        animalId,
        animalName: 'Brownie',
        animalCode: 'AR-0',
        expectedOwnerId: ownerId,
        expectedOwnershipVersion: ownershipVersion,
        status: 'PENDING',
      },
    ],
    { w: 'majority' },
  );
  await rows.claims.create([{ _id: animalId, transferId }], { w: 'majority' });
  const start = new MongoTransferAcceptanceStart(
    rows.requests,
    rows.items,
    rows.claims,
    rows.animals,
    rows.controls,
    rows.periods,
    rows.medical,
    rows.diary,
    rows.media,
    rows.archives,
    rows.events,
    rows.users,
    side.storage,
    history,
  );
  return start.startWithPublishedHistory(input);
}

describe('Opt-in Mongo first transfer with a reconciled medical document', () => {
  let fixture: TransferAcceptanceMongoFixture;
  let seed: Awaited<ReturnType<typeof seedInitialCut>>;
  restoreNodeDisposeSymbolForSuite();

  beforeEach(async () => {
    fixture = new TransferAcceptanceMongoFixture();
    await fixture.open(readAcceptanceMongoSettings(process.env));
    seed = await seedInitialCut(fixture, 'document');
  });
  afterEach(async () => {
    await fixture.close();
  });

  it('moves both active medical references and preserves the former owner medical history', async () => {
    const { archive, file, media, medicalDocument } = seed;
    if (!medicalDocument) throw new Error('Missing synthetic medical document');
    const medical = fixture.right.rows.medical.collection;
    const filter = { id: medicalDocument.id };
    const original = await medical.findOne(filter);
    if (!original) throw new Error('Missing persisted medical document');

    const { record, observation } = await seed.register();
    expect(observation.businessCommit).toBe('NOT_AUTHORIZED');
    expect(await medical.findOne(filter)).toEqual(original);
    const historical = media.historicalVersion.observation;
    const final = media.finalVersion.observation;
    expect(seed.readVersion.mock.calls).toEqual([
      [historical.scope.target, historical.revision],
      [final.scope.target, final.revision],
    ]);
    expect(historical.scope.target.key).toBe(
      `users/${archive.ownerId}/animals/${archive.animalId}/ownership-archives/${archive.id}/${file.relativeKey}`,
    );
    const revisionPrefix = `medical-documents/prescriptions/${medicalDocument.id}/revisions/2`;
    const storageKey = `users/${seed.input.actorId}/animals/${archive.animalId}/${revisionPrefix}/transfer-generations/${archive.id}/${file.id}/source.pdf`;
    expect(final.scope.target.key).toBe(storageKey);

    const receipt = await seed.close(record.accreditationHash);
    expect(await medical.findOne(filter)).toEqual({
      ...original,
      ownerId: receipt.ownerId,
      storageKey,
      documentLocations: [{ animalId: archive.animalId, storageKey }],
    });
    await expect(seed.read(record.accreditationHash)).resolves.toEqual(receipt);
    const reader = new PublishedOwnershipHistoryReader(
      seed.publishedStore,
      seed.keyFromUrl,
    );
    const period = {
      actorId: archive.ownerId,
      periodId: receipt.closedPeriodId,
      publicationHash: receipt.commitHash,
      limit: 2,
    };
    const history = await reader.read(period);
    expect(
      history.entries.find(({ kind }) => kind === 'MEDICAL_DOCUMENT'),
    ).toMatchObject({
      resourceId: medicalDocument.id,
      data: {
        ownerId: archive.ownerId,
        finalCategory: medicalDocument.finalCategory,
        documentCode: medicalDocument.documentCode,
        validatedExtraction: medicalDocument.validatedExtraction,
        version: medicalDocument.version,
        acceptedAt: medicalDocument.acceptedAt,
      },
      media: [{ fileId: file.id }],
    });
    await expect(
      reader.read({ ...period, actorId: receipt.ownerId }),
    ).rejects.toThrow('Published ownership history not found');
  });

  it('keeps the medical transfer reserved when pending analysis appears after accreditation', async () => {
    const { record } = await seed.register();
    await fixture.right.rows.medical.collection.insertOne(
      {
        id: randomUUID(),
        ownerId: seed.archive.ownerId,
        animalIds: [seed.archive.animalId],
        status: MedicalDocumentStatus.Analyzing,
      },
      { writeConcern: { w: 'majority' } },
    );
    const before = await fixture.snapshot();
    await expect(seed.close(record.accreditationHash)).rejects.toThrow(
      'pending medical work',
    );
    expect(await fixture.snapshot()).toEqual(before);
    await expect(seed.read(record.accreditationHash)).resolves.toBeNull();
  });
});

describe('Opt-in Mongo first transfer with reconciled photo and signed writer coverage', () => {
  let fixture: TransferAcceptanceMongoFixture;
  let seed: Awaited<ReturnType<typeof seedInitialCut>>;
  restoreNodeDisposeSymbolForSuite();

  beforeEach(async () => {
    fixture = new TransferAcceptanceMongoFixture();
    await fixture.open(readAcceptanceMongoSettings(process.env));
    seed = await seedInitialCut(fixture, 'photo');
  });
  afterEach(async () => {
    await fixture.close();
  });

  it('registers the exact photo evidence and publishes the initial ownership close for both clients', async () => {
    const rows = fixture.right.rows;
    expect(seed.scope.copyInventory).toMatchObject({
      attemptCount: 3,
      permissionCount: 3,
    });
    const registered = await seed.register();
    const { accreditationHash } = registered.record;
    expect(registered.observation.businessCommit).toBe('NOT_AUTHORIZED');
    expect(seed.readVersion.mock.calls).toEqual(
      [
        seed.media.historicalVersion.observation,
        seed.media.finalVersion.observation,
      ].map(({ scope, revision }) => [scope.target, revision]),
    );
    expect(
      await rows.animals.collection.findOne({ id: seed.archive.animalId }),
    ).toMatchObject({
      ownerId: seed.archive.ownerId,
      profilePictureUrl: seed.originalPhoto,
    });
    const receipt = await seed.close(accreditationHash);
    expect(
      await rows.animals.collection.findOne({ id: seed.archive.animalId }),
    ).toMatchObject({
      ownerId: seed.input.actorId,
      profilePictureUrl: urlForKey(
        seed.media.finalVersion.observation.scope.target.key,
      ),
    });
    expect(
      await rows.periods
        .find({ animalId: seed.archive.animalId })
        .sort({ ownershipVersion: 1 })
        .lean()
        .exec(),
    ).toMatchObject([
      {
        id: receipt.closedPeriodId,
        status: 'CLOSED',
        archiveId: seed.archive.id,
      },
      {
        id: receipt.activePeriodId,
        status: 'ACTIVE',
        ownerId: seed.input.actorId,
      },
    ]);
    expect(
      await rows.archives.findOne({ id: seed.archive.id }).lean().exec(),
    ).toMatchObject({
      ownershipCommitHash: receipt.commitHash,
      evidenceConsumption: { accreditationHash },
    });
    await expect(seed.read(accreditationHash)).resolves.toEqual(receipt);
  });

  it('rejects revocation from the second client between version verification and registration', async () => {
    const before = await fixture.snapshot();
    await expect(
      seed.register({
        produce: async (selection) => {
          const evidence = await seed.producer.produce(selection);
          await fixture.right.sourceProfiles.invalidateSharedControls(
            seed.writerControls._id,
            {
              requestId: randomUUID(),
              evidenceHash: archiveHash('synthetic cut controls invalidation'),
            },
          );
          return evidence;
        },
      }),
    ).rejects.toThrow('shared controls state changed or is invalid');
    expect(seed.readVersion).toHaveBeenCalledTimes(2);
    const after = await fixture.snapshot();
    expect(after.sourceProfileStates).not.toEqual(before.sourceProfileStates);
    expect({
      ...after,
      sourceProfileStates: before.sourceProfileStates,
    }).toEqual(before);
  });

  it('opens the former owner dossier from the committed receipt and checks conservation before the versioned GET', async () => {
    const { archive, media, publishedStore, keyFromUrl, now } = seed;
    const reader = new PublishedOwnershipHistoryReader(
      publishedStore,
      keyFromUrl,
    );
    const list = { actorId: archive.ownerId, limit: 1 };
    const period = { ...list, periodId: archive.periodId };
    const { record } = await seed.register();
    await expect(reader.list(list)).resolves.toMatchObject({ periods: [] });
    await expect(reader.read(period)).rejects.toThrow(
      'Published ownership history not found',
    );
    const receipt = await seed.close(record.accreditationHash);
    const stable = await fixture.snapshot();
    const { periods } = await reader.list(list);
    expect(periods).toMatchObject([
      {
        periodId: receipt.closedPeriodId,
        animalId: receipt.animalId,
        ownershipVersion: 1,
        endedAt: receipt.effectiveAt,
        publicationHash: receipt.commitHash,
        mode: 'HISTORICAL_READ_ONLY',
      },
    ]);
    const { publicationHash } = periods[0];
    const page = { ...period, publicationHash };
    const openPage = await reader.read(page);
    expect(openPage.entries).toMatchObject([
      {
        entryId: seed.entry.id,
        kind: 'ANIMAL',
        media: [{ fileId: seed.file.id }],
      },
    ]);
    expect(openPage.entries[0].data).not.toHaveProperty('profilePictureUrl');

    const {
      scope: { target },
      revision,
    } = media.historicalVersion.observation;
    const send = jest.fn<Promise<unknown>, [GetObjectCommand]>(() =>
      Promise.resolve({
        $metadata: { httpStatusCode: 200 },
        ETag: revision.etag,
        VersionId: revision.versionId,
        ContentLength: revision.size,
        Body: Readable.from([photo]),
      }),
    );
    const download = new PublishedOwnershipHistoryDownloader(
      publishedStore,
      new AwsItemHistoricalObjectReader(
        { send } as unknown as Pick<S3Client, 'send'>,
        { bucket, expectedBucketOwner: bucketOwner },
      ),
      keyFromUrl,
      5000,
      now,
    );
    const chunks: Buffer[] = [];
    const open = jest.fn(
      () =>
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            chunks.push(chunk);
            done();
          },
        }),
    );
    const input = {
      actorId: list.actorId,
      periodId: page.periodId,
      publicationHash,
      entryId: seed.entry.id,
      fileId: seed.file.id,
    };
    await expect(
      reader.read({ ...page, actorId: receipt.ownerId }),
    ).rejects.toThrow('Published ownership history not found');
    await expect(
      download.download({ ...input, actorId: receipt.ownerId }, open),
    ).rejects.toThrow('Published ownership history not found');
    await expect(
      download.download(
        { ...input, publicationHash: archiveHash('other publication') },
        open,
      ),
    ).rejects.toThrow('The selected history publication changed');
    expect(send).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    await download.download(input, open);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: target.bucket,
      Key: target.key,
      ExpectedBucketOwner: target.expectedBucketOwner,
      VersionId: revision.versionId,
      IfMatch: revision.etag,
    });
    expect(open).toHaveBeenCalledWith({
      contentLength: photo.length,
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment',
      cacheControl: 'private, no-store',
    });
    expect(Buffer.concat(chunks)).toEqual(photo);
    expect(await fixture.snapshot()).toEqual(stable);

    await fixture.left.sourceProfiles.invalidateSharedControls(
      seed.conservationControls._id,
      {
        requestId: randomUUID(),
        evidenceHash: archiveHash(
          'synthetic download conservation invalidation',
        ),
      },
    );
    await expect(reader.read(page)).resolves.toEqual(openPage);
    await expect(download.download(input, open)).rejects.toThrow(
      'shared controls state changed or is invalid',
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('rolls back the photo and evidence consumption when publication fails', async () => {
    const { record } = await seed.register();
    const before = await fixture.snapshot();
    const from = fixture.commands.length;
    fixture.left.gate.fail = 'OWNERSHIP_PUBLICATION';
    await expect(seed.close(record.accreditationHash)).rejects.toThrow(
      'The item ownership commit could not be acknowledged',
    );
    expect(fixture.commands.slice(from)).toContainEqual(
      expect.objectContaining({
        side: 'left',
        command: 'abortTransaction',
      }),
    );
    expect(await fixture.snapshot()).toEqual(before);
    await expect(seed.read(record.accreditationHash)).resolves.toBeNull();
  });

  it('commits two consecutive transfers and reads both historical dossiers from the same database', async () => {
    const { record } = await seed.register();
    const first = await seed.close(record.accreditationHash);
    await expect(seed.read(record.accreditationHash)).resolves.toEqual(first);

    const { right } = fixture;
    const { rows, repository, ownership, storage, archiveSource, connection } =
      right;
    let secondAt = Date.parse(first.effectiveAt);
    const now = () => new Date(secondAt);
    const store = seed.storeOn(right, now);
    let retainedAccreditation: PublishedHistoryStableCutAccreditation | null =
      null;
    const history = new MongoOwnershipArchiveHistory(
      rows.archives,
      rows.entries,
      rows.files,
      rows.periods,
      rows.controls,
      seed.publishedStore,
      {
        controls: right.sourceProfiles,
        now,
        accreditationFor: () => null,
        stableCutAccreditationFor: (scope, expectedHash) =>
          retainedAccreditation?.scopeHash === scope.scopeHash &&
          archiveHash(retainedAccreditation) === expectedHash
            ? retainedAccreditation
            : null,
      },
      rows.registrations,
      rows.copyRecords,
    );
    const start = await startSuccessor(right, first, history);
    secondAt = Math.max(secondAt, Date.parse(start.binding.startedAt)) + 1_000;
    const [item] = start.binding.selected;
    expect(item).toMatchObject({
      animalId: first.animalId,
      reservationEpoch: first.reservationEpoch + 1,
      predecessor: {
        archiveId: first.archiveId,
        publicationHash: first.commitHash,
      },
    });
    const source = await repository.find(first.archiveId);
    const archive = await repository.find(item.archiveId);
    expect(archive).toMatchObject({
      state: 'COLLECTING',
      periodId: first.activePeriodId,
      history: {
        phase: 'IMPORTING',
        revision: 0,
        sourcePublicationHash: first.commitHash,
      },
    });
    if (!archive || !source?.manifestDigest)
      throw new Error('Missing source or successor dossier');
    const selector = {
      actorId: archive.recipientId,
      transferId: start.transferId,
      decisionOperationId: start.binding.operationId,
      itemId: item.itemId,
      expectedRequestVersion: start.requestVersion,
      expectedCaptureRevision: 0,
    };
    const historic = seed.media.historicalVersion.observation;
    const active = seed.media.finalVersion.observation;
    const importer = new OwnershipArchiveHistoryImporter(
      ownership,
      repository,
      history,
      storage,
      store,
    );
    await expect(
      store.importLaterPeriodHistoryPage(
        selector,
        0,
        historic.requiredThrough,
        importer,
      ),
    ).resolves.toMatchObject({
      historyRevision: 1,
      historyPhase: 'COMPLETE',
      historyEntryCount: 1,
    });
    const preparer = new OwnershipArchivePreparer(
      ownership,
      repository,
      storage,
    );
    await expect(
      store.prepareLaterPeriodLivePage(
        selector,
        { kind: 'ANIMAL' },
        archiveSource,
        preparer,
        history,
        storage,
      ),
    ).resolves.toEqual({ prepared: 1 });
    await expect(
      store.sealLaterPeriodDossier(
        selector,
        seed.urls,
        archiveSource,
        history,
        repository,
      ),
    ).resolves.toEqual({
      archiveId: item.archiveId,
      entryCount: 2,
      fileCount: 2,
      stableCut: 'NOT_ASSESSED',
      businessCommit: 'NOT_AUTHORIZED',
    });

    const sealed = await fixture.left.repository.find(item.archiveId);
    expect(sealed).toMatchObject({
      state: 'COPYING',
      history: {
        sourceArchiveId: first.archiveId,
        sourcePublicationHash: first.commitHash,
        sourceEntriesDigest: source.manifestDigest.entriesDigest,
      },
    });
    expect(sealed).not.toHaveProperty('ownershipCommitHash');
    const files = await fixture.left.rows.files
      .find({ archiveId: item.archiveId })
      .lean()
      .exec();
    expect(files).toHaveLength(2);
    expect(files.find(({ retained }) => !retained)).toMatchObject({
      sourceKey: active.scope.target.key,
      source: active.revision,
    });
    expect(files.find(({ retained }) => retained)).toMatchObject({
      sourceKey: historic.scope.target.key,
      source: historic.revision,
      retained: {
        sourceArchiveId: first.archiveId,
        sourceFileId: seed.file.id,
        sha256: historic.scope.sha256,
        publishedSource: { publicationHash: first.commitHash },
      },
    });
    expect(
      await fixture.left.rows.animals.collection.findOne({
        id: first.animalId,
      }),
    ).toMatchObject({
      ownerId: first.ownerId,
      profilePictureUrl: urlForKey(active.scope.target.key),
    });

    const retainedFile = files.find(({ retained }) => retained);
    const liveFile = files.find(({ retained }) => !retained);
    if (!sealed || !retainedFile || !liveFile)
      throw new Error('Missing sealed successor files');
    const validFrom = now().toISOString();
    const { requiredThrough } = historic;
    const { validUntil } = seed.media.historicalVersion.evidence;
    const conservationControlsHash = seed.conservationControls._id;
    const { _id: retainedRowId, ...retainedDefinition } = retainedFile;
    const retainedCopies = publishedRetainedCopyChain(
      sealed,
      retainedDefinition,
      {
        publicationHash: first.commitHash,
        controlsHash: conservationControlsHash,
        checkedAt: validFrom,
        requiredThrough,
        validUntil,
        predecessor: {
          versionObservationHash: historic.observationHash,
          conservationControlsHash: historic.conservationControlsHash,
        },
      },
    );
    expect(
      await rows.files
        .updateOne(
          {
            _id: retainedRowId,
            archiveId: sealed.id,
            definitionHash: retainedDefinition.definitionHash,
          },
          { $set: retainedCopies },
        )
        .exec(),
    ).toMatchObject({ modifiedCount: 1 });
    const liveCopies = laterPeriodLiveCopyRecords(
      sealed,
      liveFile,
      photo,
      { bucket, expectedBucketOwner: bucketOwner },
      { validFrom, validUntil },
      seed.writers,
      conservationControlsHash,
    );
    await rows.copyRecords.collection.insertMany(
      [
        { ...liveCopies.historicalPut },
        { ...liveCopies.finalPut },
        { ...liveCopies.record },
      ],
      { writeConcern: { w: 'majority' } },
    );

    const coverage = {
      archiveId: sealed.id,
      expectedArchiveDefinitionHash: sealed.definitionHash,
      expectedReservationEpoch: item.reservationEpoch,
      expectedPublicationHash: first.commitHash,
      expectedSourceManifestHash: source.manifestDigest.manifestHash,
      requiredThrough,
    };
    const retainedFinal =
      retainedCopies.publishedHistoryFinalPutVersion.observation;
    await history.registerPublishedFinalMedia({
      ...coverage,
      fileId: retainedCopies.id,
      expectedFileDefinitionHash: retainedCopies.definitionHash,
      expectedVersionObservationHash: retainedFinal.observationHash,
    });
    const observer = new PublishedHistoryFinalCoverageObserver(history);
    const prepared = await observer.observePrepared(coverage);
    const { selection: retainedSelection } =
      await new PublishedHistoryRecipientProjectionReader(
        observer,
        seed.urls,
      ).prepareSelection({
        ...coverage,
        expectedPreparedCoverageHash: prepared.observationHash,
      });
    const writerCoverage = {
      issuerId: selector.actorId,
      controlsHash: seed.writerControls._id,
      writers: seed.writers,
      writerInventoryHash: archiveHash(seed.writers),
      copyEffects: seed.copyEffects,
      validFrom,
      validUntil,
    };
    const cuts = await connection.transaction(
      async (session) => {
        const { scope, retainedScope } =
          await store.readLaterPeriodStableCutScopeWithinTransaction(
            selector,
            retainedSelection,
            session,
            seed.urls,
            archiveSource,
            history,
          );
        retainedAccreditation = {
          ...writerCoverage,
          protocol: 'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION_V1',
          scopeHash: retainedScope.scopeHash,
          retainedVersionsEvidenceHash: archiveHash(retainedScope.retained),
        };
        const { record: retainedRecord } =
          await history.registerPublishedStableCutAccreditationWithinTransaction(
            {
              selection: retainedSelection,
              expectedScopeHash: retainedScope.scopeHash,
              expectedAccreditationHash: archiveHash(retainedAccreditation),
            },
            session,
            seed.urls,
          );
        return {
          scope,
          retainedAccreditationHash: retainedRecord.accreditationHash,
        };
      },
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      },
    );

    const retainedHistorical =
      retainedCopies.publishedHistoryPutVersion.observation;
    const expectedVersions = [
      {
        target: retainedHistorical.scope.target,
        revision: retainedHistorical.revision,
      },
      { target: retainedFinal.scope.target, revision: retainedFinal.revision },
      liveCopies.media.historical,
      liveCopies.media.final,
    ];
    type VersionReader = ConstructorParameters<
      typeof LaterPeriodStableCutEvidenceProducer
    >[1];
    const readVersion = jest.fn<
      ReturnType<VersionReader['readVersion']>,
      Parameters<VersionReader['readVersion']>
    >((target, revision) => {
      const version = expectedVersions.find(
        ({ target: expected }) => expected.key === target.key,
      );
      expect(version?.target).toEqual(target);
      expect(version?.revision).toEqual(revision);
      const body = Readable.from([photo]);
      return Promise.resolve({ revision, body, close: () => body.destroy() });
    });
    const producer = new LaterPeriodStableCutEvidenceProducer(
      {
        readCoverage: (scope) =>
          Promise.resolve({ ...writerCoverage, scopeHash: scope.scopeHash }),
      },
      {
        readVersion,
        readSourceRetention: (target) => {
          expect(
            expectedVersions.some(
              (version) =>
                version.target.bucket === target.bucket &&
                version.target.key === target.key &&
                version.revision.versionId === target.versionId,
            ),
          ).toBe(true);
          return Promise.resolve({
            expectedBucketOwner: bucketOwner,
            mode: 'COMPLIANCE',
            reportedRetainUntil: validUntil,
          });
        },
      },
      now,
    );
    const pins = {
      selector,
      retainedSelection,
      expectedScopeHash: cuts.scope.scopeHash,
    };
    const registered = await store.produceAndRegisterLaterPeriodStableCut(
      pins,
      seed.urls,
      archiveSource,
      history,
      producer,
    );
    expect(readVersion).toHaveBeenCalledTimes(expectedVersions.length);
    const commitPins = {
      ...pins,
      expectedAccreditationHash: registered.record.accreditationHash,
      expectedRetainedAccreditationHash: cuts.retainedAccreditationHash,
    };
    const second = await store.commitLaterPeriodItemOwnership(
      commitPins,
      seed.urls,
      archiveSource,
      history,
      rows,
    );
    expect(second).toMatchObject({
      previousOwnerId: first.ownerId,
      ownerId: selector.actorId,
      closedPeriodId: first.activePeriodId,
      reservationEpoch: item.reservationEpoch + 1,
      ownershipVersion: 3,
    });
    const otherStore = seed.storeOn(fixture.left, now);
    await expect(
      otherStore.readLaterPeriodItemOwnershipCommit(commitPins),
    ).resolves.toEqual(second);
    await expect(seed.read(record.accreditationHash)).resolves.toEqual(first);
    const reader = new PublishedOwnershipHistoryReader(
      otherStore,
      seed.keyFromUrl,
    );
    const originalPage = await reader.read({
      actorId: first.previousOwnerId,
      periodId: first.closedPeriodId,
      publicationHash: first.commitHash,
      limit: 2,
    });
    expect(originalPage.entries).toMatchObject([
      {
        kind: 'ANIMAL',
        entryId: seed.entry.id,
        media: [{ fileId: seed.file.id }],
      },
    ]);
    const secondPage = await reader.read({
      actorId: second.previousOwnerId,
      periodId: second.closedPeriodId,
      publicationHash: second.commitHash,
      limit: 2,
    });
    expect(secondPage.entries.map(({ kind }) => kind).sort()).toEqual([
      'ANIMAL',
      'RETAINED_RECORD',
    ]);
    expect(
      await fixture.left.rows.animals.collection.findOne({
        id: first.animalId,
      }),
    ).toMatchObject({
      ownerId: second.ownerId,
      profilePictureUrl: urlForKey(liveCopies.media.final.target.key),
    });
  });
});
