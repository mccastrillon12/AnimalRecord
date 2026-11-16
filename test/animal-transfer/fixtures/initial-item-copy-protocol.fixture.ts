import type { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ItemHistoricalPutDestinationPreparer } from '../../../src/context/animal-transfer/application/item-historical-put-destination-preparer';
import { ItemHistoricalPutDispatcher } from '../../../src/context/animal-transfer/application/item-historical-put-dispatcher';
import { ItemHistoricalPutReconciler } from '../../../src/context/animal-transfer/application/item-historical-put-reconciler';
import { ItemManifestObserver } from '../../../src/context/animal-transfer/application/item-manifest-observer';
import { ItemManifestPreparer } from '../../../src/context/animal-transfer/application/item-manifest-preparer';
import { ItemRecipientFinalPutDispatcher } from '../../../src/context/animal-transfer/application/item-recipient-final-put-dispatcher';
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
import {
  ItemRecipientFinalPutReconciler,
  ItemStagingPutReconciler,
} from '../../../src/context/animal-transfer/application/item-staging-put-reconciler';
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
import type { ItemHistoricalPutPermissionReadInput } from '../../../src/context/animal-transfer/domain/transfer-item-copy-record';
import type { ItemPutTransport } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-transport';
import type {
  ItemHistoricalSourceAnchorInput,
  ItemPutVersionSource,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  sourceRetentionSelectorHash,
  type ItemSourceRetentionTarget,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { buildItemRecipientFinalPutAttempt } from '../../../src/context/animal-transfer/domain/transfer-item-recipient-final-put-attempt';
import { buildFinalFromStagingPutVersion } from '../../../src/context/animal-transfer/domain/transfer-item-staging-put-reconciliation';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { ITEM_PUT_AUDIT_METADATA } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
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
  const { preparation, expectedManifestHash } = anchor;
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
    const selection = {
      selector,
      attemptId,
      expectedAttemptDefinitionHash,
      authorizationId: permission.authorizationId,
    };
    const expectedPermissionHash = permission.permissionHash;
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
  Object.assign(config, {
    stagingPermissionEvidenceFor: stagingDispatcher.permissionEvidenceFor,
  });
  const sentStaging = await stagingDispatcher.dispatch({
    ...stagingReadPins,
    authorizationId: id(187),
    artifact: stagingArtifact,
  });
  expect(sentStaging.outcome).toBe('UNKNOWN');
  const stagingContext = {
    definition: staging,
    permission: sentStaging.permission,
  };
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
  const finalIntent = await store.prepareFinalFromStagingPut(finalInput);
  const finalIds = { attemptId: id(188), dispatcherInstanceId: id(189) };
  const finalContext = await store.readHistoricalCopy(preparation);
  const originalStaging = { ...stagingContext, versionRecord: stagingVersion };
  const { intent } = buildFinalFromStagingPutVersion(
    finalContext,
    expectedManifestHash,
    originalStaging,
    finalSource,
  );
  expect(finalIntent).toMatchObject({
    intentId: intent.id,
    intentDefinitionHash: intent.definitionHash,
    replayed: false,
  });
  await expect(store.prepareFinalFromStagingPut(finalInput)).resolves.toEqual({
    ...finalIntent,
    replayed: true,
  });
  const { definition: final } = buildItemRecipientFinalPutAttempt(
    {
      ...finalContext,
      file: { ...finalContext.file, recipientFinalCopyIntent: intent },
    },
    originalStaging,
    {
      ...finalIds,
      expectedManifestHash,
      expectedFinalIntentHash: finalIntent.intentDefinitionHash,
      source: finalSource,
    },
  );
  const finalAccreditation = {
    ...destination,
    protocol: 'ITEM_RECIPIENT_FINAL_PUT_DESTINATION_ACCREDITATION_V1' as const,
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
  const declaredFinal = await store.declareRecipientFinalPutAttempt(
    {
      ...finalRead,
      dispatcherInstanceId: finalIds.dispatcherInstanceId,
      expectedGateRevision: sentStaging.permission.gateRevision,
    },
    finalAccreditation,
  );
  const finalReadPins = {
    ...finalRead,
    expectedGateRevision: declaredFinal.gateRevision,
  };
  const finalCustody = new InMemoryItemRecipientFinalPutArtifactCustody(limits);
  const finalArtifacts = new ItemRecipientFinalPutArtifacts(
    store,
    versions,
    now,
  );
  const finalArtifact = await finalArtifacts.seal(
    finalReadPins,
    finalCustody.createDraft(bytes.length),
  );
  const finalDispatcher = new ItemRecipientFinalPutDispatcher(
    finalIds.dispatcherInstanceId,
    store,
    finalArtifacts,
    finalCustody,
    transport,
  );
  Object.assign(config, {
    finalPermissionEvidenceFor: finalDispatcher.permissionEvidenceFor,
  });
  const finalDispatch = {
    ...finalReadPins,
    authorizationId: id(190),
    artifact: finalArtifact,
  };
  const sentFinal = await finalDispatcher.dispatch(finalDispatch);
  expect(sentFinal.transportObservation).toMatchObject({
    localReturn: 'THREW',
    outcome: 'UNKNOWN',
  });
  await expect(
    store.readInitialRecipientFinalPutPermission({
      selector,
      attemptId: final.id,
      expectedAttemptDefinitionHash: final.definitionHash,
      authorizationId: finalDispatch.authorizationId,
    }),
  ).resolves.toMatchObject({
    permission: sentFinal.permission,
    copyDispatch: 'NOT_AUTHORIZED',
  });
  const { report: finalReport, pins: finalPins } = await versionEvidence(
    'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1',
    final.id,
    final.definitionHash,
    sentFinal.permission,
  );
  const finalReconciler = new ItemRecipientFinalPutReconciler(
    store,
    { readRecipientFinalVersionEvidence: () => Promise.resolve(finalReport) },
    versions,
    now,
  );
  const finalVersion = await finalReconciler.reconcileAndRecord(finalPins);
  const reads = versions.readVersion.mock.calls.length;
  await expect(finalReconciler.reconcileAndRecord(finalPins)).resolves.toEqual(
    finalVersion,
  );
  await expect(finalDispatcher.dispatch(finalDispatch)).rejects.toThrow(
    'already used',
  );
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
}
