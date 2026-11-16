import {
  GetObjectCommand,
  type HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  ITEM_RECIPIENT_FINAL_PUT_DISPATCHER_FACTORY,
  type CapturePutVersionEvidence,
  type ItemRecipientFinalPutDispatcherFactory,
} from '../../../src/app/animal-transfer/transfer-item-capture.module';
import { ItemHistoricalPutDestinationPreparer } from '../../../src/context/animal-transfer/application/item-historical-put-destination-preparer';
import { ItemHistoricalPutDispatcher } from '../../../src/context/animal-transfer/application/item-historical-put-dispatcher';
import { ItemHistoricalPutReconciler } from '../../../src/context/animal-transfer/application/item-historical-put-reconciler';
import { ItemManifestObserver } from '../../../src/context/animal-transfer/application/item-manifest-observer';
import { ItemManifestPreparer } from '../../../src/context/animal-transfer/application/item-manifest-preparer';
import {
  ItemRecipientFinalPutArtifacts,
  ItemStagingPutArtifacts,
} from '../../../src/context/animal-transfer/application/item-staging-put-artifacts';
import { ItemStagingPutDispatcher } from '../../../src/context/animal-transfer/application/item-staging-put-dispatcher';
import {
  PutVersionAuditSelectionReader,
  type PutVersionAuditInput,
} from '../../../src/context/animal-transfer/application/put-version-audit-selection';
import { PutVersionEvidenceProducer } from '../../../src/context/animal-transfer/application/put-version-evidence-producer';
import { ItemStagingPutReconciler } from '../../../src/context/animal-transfer/application/item-staging-put-reconciler';
import {
  archiveHash,
  type ObjectRevision,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildItemHistoricalPutAttemptV2 } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-attempt';
import {
  historicalPutDestinationScope,
  recipientFinalPutDestinationScope,
  stagingPutDestinationScope,
  type PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import type { ItemHistoricalPutVersionScope } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import type {
  ItemCopyRecordStore,
  ItemHistoricalPutPermissionReadInput,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-record';
import type { ItemPutTransport } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-transport';
import type {
  ItemHistoricalSourceAnchorInput,
  ItemPutVersionSource,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  sourceRetentionSelectorHash,
  type ItemSourceRetentionTarget,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { ITEM_PUT_AUDIT_METADATA } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { AwsPutVersionEvidenceReconciliation } from '../../../src/context/animal-transfer/infrastructure/storage/aws-put-version-evidence-reconciliation';
import {
  AwsPutVersionProvenanceReader,
  AwsS3PutAuditReader,
  type S3CreatedPutNotifications,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-s3-put-audit';
import {
  InMemoryItemRecipientFinalPutArtifactCustody,
  InMemoryItemSourceArtifactCustody,
  InMemoryItemStagingPutArtifactCustody,
} from '../../../src/context/animal-transfer/infrastructure/storage/in-memory-item-source-artifact-custody';

type StoreConfig = NonNullable<
  ConstructorParameters<typeof MongoTransferItemCapture>[9]
>;
type InitialPutProtocol = Extract<
  PutVersionAuditInput,
  { selection: ItemHistoricalPutPermissionReadInput }
>['protocol'];
type PutNotification = Awaited<
  ReturnType<S3CreatedPutNotifications['readCreatedPuts']>
>[number];

/** Test composition. Only the bytes and reports supplied by S3 and the authority are synthetic. */
export async function runInitialItemCopies(input: {
  store: MongoTransferItemCapture;
  config: StoreConfig;
  anchor: ItemHistoricalSourceAnchorInput;
  keyFromUrl: (url: string) => string | undefined;
  bytes: Buffer;
  id: (n: number) => string;
  issuerId: string;
  writers: PutDestinationWriters;
  validFrom: string;
  validUntil: string;
  requiredThrough: string;
  outsideTransaction: () => boolean;
  hasRecordedPermission: (auditMarkerHash: string) => boolean;
  startFinalModule: (
    evidence: CapturePutVersionEvidence,
  ) => Promise<TestingModule>;
}) {
  const {
    store,
    config,
    anchor,
    bytes,
    id,
    issuerId,
    writers,
    validFrom,
    validUntil,
    requiredThrough,
  } = input;
  const now = config.now;
  const { preparation } = anchor;
  const { selector } = preparation;
  const material = await store.readHistoricalSourceForAnchor(anchor);
  const expectedBucketOwner = '123456789012';
  Object.assign(config, { assessment: { expectedBucketOwner } });
  const controlsHash = archiveHash('test controls');
  const profileFacts = {
    protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_V1' as const,
    id: id(181),
    revision: 1,
    issuerId,
    selectorHash: sourceRetentionSelectorHash(
      material.source,
      expectedBucketOwner,
    ),
    signerContextHash: archiveHash('test signer'),
    controlsHash,
    validFrom,
    validUntil,
  };
  const profile = {
    ...profileFacts,
    definitionHash: archiveHash(profileFacts),
    state: 'ACTIVE' as const,
  };
  const profileInput = {
    anchor,
    expectedProfile: {
      id: profile.id,
      revision: profile.revision,
      definitionHash: profile.definitionHash,
    },
  };
  Object.assign(config.profiles, {
    readActiveSourceProfile: () => Promise.resolve(profile),
    fenceActiveSourceProfile: (
      expected: typeof profileInput.expectedProfile,
      _session: unknown,
      validate?: (record: typeof profile) => void,
    ) => {
      expect(expected).toEqual(profileInput.expectedProfile);
      validate?.(profile);
      return Promise.resolve();
    },
  });

  const objects = new Map([
    [
      material.source.key,
      { bytes, revision: material.source.revision, marker: '' },
    ],
  ]);
  const notifications = new Map<string, PutNotification>();
  const versions = {
    readVersion: jest.fn(
      (
        target: ItemHistoricalPutVersionScope['target'],
        revision: ObjectRevision,
      ) => {
        expect(input.outsideTransaction()).toBe(true);
        expect(target.bucket).toBe(material.source.bucket);
        expect(target.expectedBucketOwner).toBe(expectedBucketOwner);
        const object = objects.get(target.key);
        if (!object) throw new Error('Simulated version is missing');
        expect(revision).toEqual(object.revision);
        return Promise.resolve({
          revision: object.revision,
          body: Readable.from([object.bytes]),
          close: () => undefined,
        });
      },
    ),
    readSourceRetention: jest.fn((target: ItemSourceRetentionTarget) => {
      expect(input.outsideTransaction()).toBe(true);
      expect(target.bucket).toBe(material.source.bucket);
      expect(objects.get(target.key)?.revision.versionId).toBe(
        target.versionId,
      );
      return Promise.resolve({
        expectedBucketOwner,
        mode: 'COMPLIANCE' as const,
        reportedRetainUntil: validUntil,
      });
    }),
  };
  const puts: string[] = [];
  const transport: ItemPutTransport = {
    prepare(request, options) {
      expect(input.outsideTransaction()).toBe(true);
      expect(options?.correlateAudit).toBe(true);
      const marker = archiveHash(['test marker', request.key]);
      const auditMarkerHash = archiveHash(marker);
      return Promise.resolve({
        request,
        auditMarkerHash,
        serializedRequestHash: archiveHash(request),
        async sendOnce(body) {
          expect(input.outsideTransaction()).toBe(true);
          expect(input.hasRecordedPermission(auditMarkerHash)).toBe(true);
          expect(request.ifNoneMatch).toBe('*');
          if (objects.has(request.key))
            throw new Error('Simulated S3 precondition failed');
          const chunks: Uint8Array[] = [];
          for await (const chunk of body) chunks.push(chunk);
          const content = Buffer.concat(chunks);
          expect(content).toEqual(bytes);
          expect(content.length).toBe(request.contentLength);
          expect(createHash('sha256').update(content).digest('hex')).toBe(
            material.source.sha256,
          );
          const revision = {
            etag: `"put-${puts.length + 1}"`,
            versionId: `put-${puts.length + 1}`,
            size: content.length,
          };
          objects.set(request.key, { bytes: content, revision, marker });
          puts.push(request.key);
          notifications.set(request.key, {
            event: 'ObjectCreated:Put',
            requestId: `simulated-put-${puts.length}`,
            target: {
              bucket: request.bucket,
              key: request.key,
              expectedBucketOwner,
            },
            occurredAt: now().toISOString(),
            revision,
          });
          if (puts.length === 3)
            throw new Error(
              'Simulated response lost after storing the final PUT',
            );
        },
      });
    },
  };
  const readCreatedPuts = jest.fn(
    (target: ItemHistoricalPutVersionScope['target']) => {
      expect(input.outsideTransaction()).toBe(true);
      const notification = notifications.get(target.key);
      return Promise.resolve(notification ? [notification] : []);
    },
  );
  const head = jest.fn((command: HeadObjectCommand) => {
    expect(input.outsideTransaction()).toBe(true);
    const { Bucket, Key, VersionId, IfMatch, ExpectedBucketOwner } =
      command.input;
    const object = Key && objects.get(Key);
    if (!object) throw new Error('Expected the notified version');
    expect(Bucket).toBe(material.source.bucket);
    expect(ExpectedBucketOwner).toBe(expectedBucketOwner);
    expect(VersionId).toBe(object.revision.versionId);
    expect(IfMatch).toBe(object.revision.etag);
    return Promise.resolve({
      $metadata: { httpStatusCode: 200 },
      ETag: object.revision.etag,
      VersionId: object.revision.versionId,
      ContentLength: object.revision.size,
      Metadata: { [ITEM_PUT_AUDIT_METADATA]: object.marker },
    });
  });
  const audit = new AwsS3PutAuditReader({ readCreatedPuts }, {
    send: head,
  } as unknown as Pick<S3Client, 'send'>);
  const selectors = new PutVersionAuditSelectionReader(store, {
    readPublishedCopyVersionContext: jest.fn(),
    readPublishedStagingVersionContext: jest.fn(),
    readPublishedFinalVersionContext: jest.fn(),
  });
  async function produceReport<Protocol extends InitialPutProtocol>(
    protocol: Protocol,
    selection: ItemHistoricalPutPermissionReadInput,
    expectedPermissionHash: string,
  ) {
    const selected = await selectors.read({
      protocol,
      selection,
      expectedPermissionHash,
    });
    if (!selected)
      throw new Error('Expected a recorded permission with an audit marker');
    const producer = new PutVersionEvidenceProducer(
      new AwsPutVersionProvenanceReader(audit, selected),
      versions,
      { issuerId, conservationControlsHash: controlsHash },
      now,
    );
    return producer.produce(selected.scope, protocol, requiredThrough);
  }
  const limits = {
    maxArtifactBytes: bytes.length,
    maxTotalBytes: bytes.length,
    maxArtifacts: 1,
    maxOpenReaders: 1,
  };
  const fixedSource = new ItemManifestObserver(store, input.keyFromUrl, {
    now,
    profiles: { readCurrentSourceProfile: () => Promise.resolve(profile) },
    reader: {
      readSourceRetention: versions.readSourceRetention,
      async readFixedSource(target, revision) {
        return {
          ...(await versions.readVersion(
            { ...target, expectedBucketOwner },
            revision,
          )),
          expectedBucketOwner,
          mode: 'COMPLIANCE',
          eventHold: 'OFF',
          fixedRetainUntil: validUntil,
          storage: {
            encryption: 'SSE_S3',
            storageClass: 'OMITTED',
            restoreOrArchiveReported: false,
          },
          representation: { contentType: 'image/jpeg' },
        };
      },
    },
  });
  const manifestPreparer = new ItemManifestPreparer(
    store,
    fixedSource,
    expectedBucketOwner,
  );
  const sourceEvidence =
    await manifestPreparer.prepareHistoricalSourceEvidence(profileInput);
  expect(sourceEvidence.retention).toMatchObject({
    replayed: false,
    observation: {
      reportedRetainUntil: validUntil,
      copyDispatch: 'NOT_AUTHORIZED',
    },
  });
  expect(sourceEvidence.profile).toMatchObject({
    replayed: false,
    observation: {
      fixedSource: { fixedRetainUntil: validUntil, bytes: 'MATCH' },
      profileObservation: {
        profile: profileInput.expectedProfile,
        copyDispatch: 'NOT_AUTHORIZED',
      },
    },
  });
  expect(puts).toHaveLength(0);
  const historyCustody = new InMemoryItemSourceArtifactCustody(limits);
  const declarationEvidence =
    await manifestPreparer.prepareHistoricalPutArtifact(
      profileInput,
      historyCustody.createDraft(bytes.length),
    );

  const hash = archiveHash('synthetic independent destination evidence');
  const destination = {
    issuerId,
    writers,
    validFrom,
    admitBefore: validUntil,
    conditionalCreationEvidenceHash: hash,
    deletion: {
      keyDeletion: hash,
      versionDeletion: hash,
      deleteMarkers: hash,
      lifecycle: hash,
    },
    writerInventoryHash: archiveHash(writers),
    continuity: {
      until: 'RECONCILED_OR_ISOLATED' as const,
      evidenceHash: hash,
    },
  };
  async function versionEvidence<Protocol extends InitialPutProtocol>(
    protocol: Protocol,
    attemptId: string,
    expectedAttemptDefinitionHash: string,
    permission: { authorizationId: string; permissionHash: string },
  ) {
    const resumed = await store.readCopyResumePoint({
      selector,
      attempt: {
        protocol,
        attemptId,
        expectedAttemptDefinitionHash,
        authorizationId: permission.authorizationId,
      },
    });
    expect(resumed).toMatchObject({
      manifest: { manifestHash: anchor.expectedManifestHash },
      copyDispatch: 'NOT_AUTHORIZED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    if (resumed.attempt?.state !== 'MAY_RUN')
      throw new Error('Expected the recorded copy permission');
    expect(resumed.attempt.recordedEvidenceHash).toBeNull();
    const { audit } = resumed.attempt;
    const { selection, expectedPermissionHash } = audit;
    expect(audit.protocol).toBe(protocol);
    expect(expectedPermissionHash).toBe(permission.permissionHash);
    if (protocol === 'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1') {
      readCreatedPuts.mockResolvedValueOnce([]);
      const reads = versions.readVersion.mock.calls.length;
      await expect(
        produceReport(protocol, selection, expectedPermissionHash),
      ).resolves.toBeNull();
      expect(versions.readVersion).toHaveBeenCalledTimes(reads);
      expect(puts).toHaveLength(3);
    }
    const report = await produceReport(
      protocol,
      selection,
      expectedPermissionHash,
    );
    if (!report) throw new Error('Expected evidence of the exact version');
    return {
      report,
      audit,
      pins: {
        ...selection,
        expectedPermissionHash,
        expectedEvidenceHash: archiveHash(report),
        requiredThrough,
      },
    };
  }
  function predecessor(
    pins: Awaited<ReturnType<typeof versionEvidence>>['pins'],
    version: { observation: { observationHash: string } },
  ): ItemPutVersionSource {
    return {
      attemptId: pins.attemptId,
      attemptDefinitionHash: pins.expectedAttemptDefinitionHash,
      authorizationId: pins.authorizationId,
      permissionHash: pins.expectedPermissionHash,
      versionObservationHash: version.observation.observationHash,
      conservationControlsHash: controlsHash,
      requiredThrough,
    };
  }

  const opened = await store.openCopyGate(selector);
  const historyIds = { attemptId: id(182), dispatcherInstanceId: id(183) };
  const context = await store.readHistoricalCopy(preparation);
  const historical = buildItemHistoricalPutAttemptV2(context, {
    ...historyIds,
    expectedBucketOwner,
    profile,
    anchor: material,
    ...declarationEvidence,
  });
  const declaration = await store.declareHistoricalPutAttemptV2({
    ...profileInput,
    ...historyIds,
    ...declarationEvidence,
    expectedGateRevision: opened.gateRevision,
  });
  expect(declaration.copyDispatch).toBe('NOT_AUTHORIZED');
  expect(puts).toHaveLength(0);
  const historicalAccreditation = {
    ...destination,
    protocol: 'ITEM_HISTORICAL_PUT_DESTINATION_ACCREDITATION_V1' as const,
    scope: historicalPutDestinationScope(historical, controlsHash),
  };
  const historicalAccreditationHash = archiveHash(historicalAccreditation);
  const accreditations = {
    readDestinationAccreditation: () => {
      expect(input.outsideTransaction()).toBe(true);
      return Promise.resolve(historicalAccreditation);
    },
  };
  const destinationPreparer = new ItemHistoricalPutDestinationPreparer(
    store,
    accreditations,
    now,
  );
  const destinationPins = {
    ...profileInput,
    attemptId: historical.id,
    expectedAttemptDefinitionHash: historical.definitionHash,
    expectedGateRevision: declaration.gateRevision,
    expectedControlsHash: controlsHash,
    expectedAccreditationHash: historicalAccreditationHash,
  };
  const protectedHistory = await destinationPreparer.prepare(destinationPins);
  const protectionPins = {
    ...destinationPins,
    expectedGateRevision: protectedHistory.gateRevision,
    expectedProtectionHash: protectedHistory.protection.protectionHash,
  };
  await expect(
    destinationPreparer.assessAdmission(protectionPins),
  ).resolves.toMatchObject({
    assessment: 'ADMISSION_WINDOW_FITS',
    copyDispatch: 'NOT_AUTHORIZED',
  });
  expect(puts).toHaveLength(0);
  const historicalDispatcher = new ItemHistoricalPutDispatcher(
    historyIds.dispatcherInstanceId,
    store,
    fixedSource,
    historyCustody,
    accreditations,
    transport,
  );
  const historicalDispatch = {
    ...protectionPins,
    authorizationId: id(184),
  };
  const sentHistory = await historicalDispatcher.dispatch(historicalDispatch);
  expect(sentHistory.outcome).toBe('UNKNOWN');
  await expect(
    historicalDispatcher.dispatch(historicalDispatch),
  ).rejects.toThrow('already used');
  const { report: historicalReport, pins: historyPins } = await versionEvidence(
    'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1',
    historical.id,
    historical.definitionHash,
    sentHistory.permission,
  );
  const historicalVersion = await new ItemHistoricalPutReconciler(
    store,
    { readVersionEvidence: () => Promise.resolve(historicalReport) },
    versions,
    now,
  ).reconcileAndRecord(historyPins);

  const stagingSource = predecessor(historyPins, historicalVersion);
  const stagingInput = { anchor, source: stagingSource };
  const stagingIds = { attemptId: id(185), dispatcherInstanceId: id(186) };
  const {
    definition: staging,
    preparation: stagingIntent,
    gateRevision,
  } = await store.prepareStagingPutAttempt({
    ...stagingInput,
    ...stagingIds,
  });
  const stagingAccreditation = {
    ...destination,
    protocol: 'ITEM_STAGING_PUT_DESTINATION_ACCREDITATION_V1' as const,
    scope: stagingPutDestinationScope(staging, controlsHash),
  };
  const stagingRead = {
    ...stagingInput,
    attemptId: staging.id,
    expectedAttemptDefinitionHash: staging.definitionHash,
    expectedStagingIntentHash: stagingIntent.intentDefinitionHash,
    expectedAccreditationHash: archiveHash(stagingAccreditation),
    expectedControlsHash: controlsHash,
  };
  const declaredStaging = await store.declareStagingPutAttempt(
    {
      ...stagingRead,
      dispatcherInstanceId: stagingIds.dispatcherInstanceId,
      expectedGateRevision: gateRevision,
    },
    stagingAccreditation,
  );
  const stagingReadPins = {
    ...stagingRead,
    expectedGateRevision: declaredStaging.gateRevision,
  };
  const stagingCustody = new InMemoryItemStagingPutArtifactCustody(limits);
  const stagingArtifacts = new ItemStagingPutArtifacts(store, versions, now);
  const stagingArtifact = await stagingArtifacts.seal(
    stagingReadPins,
    stagingCustody.createDraft(bytes.length),
  );
  const stagingDispatcher = new ItemStagingPutDispatcher(
    stagingIds.dispatcherInstanceId,
    store,
    stagingArtifacts,
    stagingCustody,
    transport,
  );
  const sentStaging = await stagingDispatcher.dispatch({
    ...stagingReadPins,
    authorizationId: id(187),
    artifact: stagingArtifact,
  });
  expect(sentStaging.outcome).toBe('UNKNOWN');
  const { report: stagingReport, pins: stagingPins } = await versionEvidence(
    'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1',
    staging.id,
    staging.definitionHash,
    sentStaging.permission,
  );
  const stagingVersion = await new ItemStagingPutReconciler(
    store,
    { readStagingVersionEvidence: () => Promise.resolve(stagingReport) },
    versions,
    now,
  ).reconcileAndRecord(stagingPins);

  const finalSource = predecessor(stagingPins, stagingVersion);
  const finalInput = { anchor, source: finalSource };
  const finalIds = { attemptId: id(188), dispatcherInstanceId: id(189) };
  const evidenceArchive = {
    bucket: 'synthetic-final-put-evidence',
    bucketOwner: '123456789014',
    issuerId,
    maxBytes: 4096,
  };
  const reportArchive = new Map<string, Buffer>();
  const readEvidence = jest.fn((command: GetObjectCommand) => {
    expect(input.outsideTransaction()).toBe(true);
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.Bucket).toBe(evidenceArchive.bucket);
    expect(command.input.ExpectedBucketOwner).toBe(evidenceArchive.bucketOwner);
    const report = reportArchive.get(command.input.Key ?? '');
    if (!report) throw new Error('Expected the archived final PUT report');
    return Promise.resolve({
      $metadata: { httpStatusCode: 200 },
      Body: Readable.from([report]),
      ContentLength: report.length,
      VersionId: 'synthetic-final-report-version',
    });
  });
  const readObject = jest.fn(async (command: GetObjectCommand) => {
    expect(command).toBeInstanceOf(GetObjectCommand);
    const { Bucket, Key, ExpectedBucketOwner, VersionId, IfMatch } =
      command.input;
    const object = Key && objects.get(Key);
    if (!object || !Bucket || !ExpectedBucketOwner || !VersionId || !IfMatch)
      throw new Error('Expected the exact version of the requested object');
    const read = await versions.readVersion(
      { bucket: Bucket, key: Key, expectedBucketOwner: ExpectedBucketOwner },
      { versionId: VersionId, etag: IfMatch, size: object.revision.size },
    );
    return {
      $metadata: { httpStatusCode: 200 },
      Body: read.body,
      ContentLength: read.revision.size,
      VersionId: read.revision.versionId,
      ETag: read.revision.etag,
    };
  });
  const module = await input.startFinalModule({
    clients: {
      notificationArchive: { send: jest.fn() },
      objectVersions: { send: readObject } as unknown as Pick<S3Client, 'send'>,
      evidenceArchive: { send: readEvidence } as unknown as Pick<
        S3Client,
        'send'
      >,
    },
    configuration: {
      notificationArchive: {
        auditBucket: 'synthetic-final-notifications',
        auditBucketOwner: evidenceArchive.bucketOwner,
        sourceBucket: material.source.bucket,
        sourceBucketOwner: expectedBucketOwner,
        sourceRegion: 'us-east-1',
        notificationConfigurationId: 'synthetic-final-put',
        maxBytes: 4096,
      },
      evidenceArchive,
      conservationControlsHash: controlsHash,
    },
    now,
  });
  try {
    const records = module.get<ItemCopyRecordStore>('ItemCopyRecordStore');
    const finalPreparationInput = { ...finalInput, ...finalIds };
    const prepared = await records.prepareRecipientFinalPutAttempt(
      finalPreparationInput,
    );
    const {
      definition: final,
      preparation: finalIntent,
      gateRevision,
    } = prepared;
    expect(finalIntent.replayed).toBe(false);
    await expect(
      records.prepareRecipientFinalPutAttempt(finalPreparationInput),
    ).resolves.toEqual({
      ...prepared,
      preparation: { ...finalIntent, replayed: true },
    });
    expect(final).toMatchObject({
      predecessor: finalSource,
      read: {
        key: staging.request.key,
        versionId: stagingVersion.observation.revision.versionId,
      },
      copyDispatch: 'NOT_AUTHORIZED',
    });
    const finalAccreditation = {
      ...destination,
      protocol:
        'ITEM_RECIPIENT_FINAL_PUT_DESTINATION_ACCREDITATION_V1' as const,
      scope: recipientFinalPutDestinationScope(final, controlsHash),
    };
    const finalRead = {
      ...finalInput,
      attemptId: final.id,
      expectedAttemptDefinitionHash: final.definitionHash,
      expectedFinalIntentHash: finalIntent.intentDefinitionHash,
      expectedAccreditationHash: archiveHash(finalAccreditation),
      expectedControlsHash: controlsHash,
    };
    const declaredFinal = await records.declareRecipientFinalPutAttempt(
      {
        ...finalRead,
        dispatcherInstanceId: finalIds.dispatcherInstanceId,
        expectedGateRevision: gateRevision,
      },
      finalAccreditation,
    );
    const finalReadPins = {
      ...finalRead,
      expectedGateRevision: declaredFinal.gateRevision,
    };
    const finalCustody = new InMemoryItemRecipientFinalPutArtifactCustody(
      limits,
    );
    const finalArtifacts = module.get(ItemRecipientFinalPutArtifacts);
    const finalArtifact = await finalArtifacts.seal(
      finalReadPins,
      finalCustody.createDraft(bytes.length),
    );
    const createDispatcher = module.get<ItemRecipientFinalPutDispatcherFactory>(
      ITEM_RECIPIENT_FINAL_PUT_DISPATCHER_FACTORY,
    );
    const finalDispatcher = createDispatcher(
      finalIds.dispatcherInstanceId,
      finalCustody,
      transport,
    );
    const finalDispatch = {
      ...finalReadPins,
      authorizationId: id(190),
      artifact: finalArtifact,
    };
    const recoveryInput = {
      selector,
      attempt: {
        protocol: 'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1' as const,
        attemptId: final.id,
        expectedAttemptDefinitionHash: final.definitionHash,
        authorizationId: finalDispatch.authorizationId,
      },
    };
    await expect(
      records.readCopyResumePoint(recoveryInput),
    ).resolves.toMatchObject({
      attempt: { state: 'INTENDED' },
      copyDispatch: 'NOT_AUTHORIZED',
    });
    const sentFinal = await finalDispatcher.dispatch(finalDispatch);
    expect(sentFinal.transportObservation).toMatchObject({
      localReturn: 'THREW',
      outcome: 'UNKNOWN',
    });
    await expect(
      records.readInitialRecipientFinalPutPermission({
        selector,
        attemptId: final.id,
        expectedAttemptDefinitionHash: final.definitionHash,
        authorizationId: finalDispatch.authorizationId,
      }),
    ).resolves.toMatchObject({
      permission: sentFinal.permission,
      copyDispatch: 'NOT_AUTHORIZED',
    });
    const {
      report: finalReport,
      pins: finalPins,
      audit,
    } = await versionEvidence(
      'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1',
      final.id,
      final.definitionHash,
      sentFinal.permission,
    );
    const { expectedEvidenceHash, requiredThrough: horizon } = finalPins;
    reportArchive.set(
      `put-version-evidence/v1/${finalReport.protocol}/${finalReport.scopeHash}/${expectedEvidenceHash}.json`,
      Buffer.from(JSON.stringify(finalReport)),
    );
    const finalReconciler = module.get(AwsPutVersionEvidenceReconciliation);
    const reportReceipt = { evidenceHash: expectedEvidenceHash };
    const finalVersion = await finalReconciler.reconcileAndRecord(
      audit,
      reportReceipt,
      horizon,
    );
    expect(finalVersion.observation).toMatchObject({
      revision: finalReport.revision,
      bytes: 'MATCH',
      copyDispatch: 'NOT_AUTHORIZED',
    });
    const reads = versions.readVersion.mock.calls.length;
    const recovered = await records.readCopyResumePoint(recoveryInput);
    expect(recovered.attempt).toEqual({
      state: 'MAY_RUN',
      audit,
      recordedEvidenceHash: expectedEvidenceHash,
    });
    await expect(
      finalReconciler.reconcileAndRecord(audit, reportReceipt, horizon),
    ).resolves.toEqual(finalVersion);
    await expect(finalDispatcher.dispatch(finalDispatch)).rejects.toThrow(
      'already used',
    );
    const currentGate = await records.readCopyGate(selector);
    await expect(
      createDispatcher(
        finalIds.dispatcherInstanceId,
        finalCustody,
        transport,
      ).dispatch({
        ...finalDispatch,
        expectedGateRevision: currentGate!.revision,
      }),
    ).rejects.toThrow('dispatch evidence is inconsistent');
    expect(readEvidence).toHaveBeenCalledTimes(1);
    expect(readObject).toHaveBeenCalledTimes(2);
    expect(versions.readVersion).toHaveBeenCalledTimes(reads);
    expect(puts).toEqual([
      historical.request.key,
      staging.request.key,
      final.request.key,
    ]);
    expect(head).toHaveBeenCalledTimes(3);
    expect(readCreatedPuts).toHaveBeenCalledTimes(4);
    return {
      fileId: preparation.fileId,
      historicalVersion,
      finalVersion,
      versions,
      rows: [historicalVersion, stagingVersion, finalVersion].map(
        (versionRecord) => ({ versionRecord }),
      ),
    };
  } finally {
    await module.close();
  }
}
