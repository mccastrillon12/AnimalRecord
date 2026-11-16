import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
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
  protectHistoricalPutDestinationFromAccreditation,
  recipientFinalPutDestinationScope,
  stagingPutDestinationScope,
  type PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import {
  historicalPutVersionScope,
  type ItemHistoricalPutVersionScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import type { ItemPutTransport } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-transport';
import type {
  ItemHistoricalSourceAnchorInput,
  ItemPutVersionSource,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import { sourceRetentionSelectorHash } from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { buildItemRecipientFinalPutAttempt } from '../../../src/context/animal-transfer/domain/transfer-item-recipient-final-put-attempt';
import { buildItemStagingPutAttempt } from '../../../src/context/animal-transfer/domain/transfer-item-staging-put-attempt';
import {
  buildFinalFromStagingPutVersion,
  recipientFinalPutVersionScope,
  stagingPutVersionScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-staging-put-reconciliation';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import {
  InMemoryItemRecipientFinalPutArtifactCustody,
  InMemoryItemSourceArtifactCustody,
  InMemoryItemStagingPutArtifactCustody,
} from '../../../src/context/animal-transfer/infrastructure/storage/in-memory-item-source-artifact-custody';

type StoreConfig = NonNullable<
  ConstructorParameters<typeof MongoTransferItemCapture>[9]
>;

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
    [material.source.key, { bytes, revision: material.source.revision }],
  ]);
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
  };
  const puts: string[] = [];
  const transport: ItemPutTransport = {
    prepare(request, options) {
      expect(input.outsideTransaction()).toBe(true);
      expect(options?.correlateAudit).toBe(true);
      const auditMarkerHash = archiveHash(['test marker', request.key]);
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
          objects.set(request.key, { bytes: content, revision });
          puts.push(request.key);
          if (puts.length === 3)
            throw new Error(
              'Simulated response lost after storing the final PUT',
            );
        },
      });
    },
  };
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
  await new ItemManifestPreparer(
    store,
    fixedSource,
    expectedBucketOwner,
  ).prepareHistoricalSourceProfile(profileInput);
  const historyCustody = new InMemoryItemSourceArtifactCustody(limits);
  const { seal: artifact, metadata } =
    await fixedSource.sealHistoricalSourceArtifact(
      profileInput,
      historyCustody.createDraft(bytes.length),
      { captureRepresentation: true },
    );

  // These reports stand in for the independent authority. Every version comes
  // from the simulated PUT, and the real reconciler still reads its exact bytes.
  function reportFor(scope: ItemHistoricalPutVersionScope) {
    const object = objects.get(scope.target.key);
    if (!object || !puts.includes(scope.target.key))
      throw new Error('No applied PUT to report');
    return {
      issuerId,
      scopeHash: archiveHash(scope),
      revision: object.revision,
      provenanceEvidenceHash: archiveHash(['provenance', scope.permissionHash]),
      conservationEvidenceHash: archiveHash(['retention', scope.target]),
      conservationControlsHash: controlsHash,
      validFrom,
      validUntil,
    };
  }
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
  function versionPins(
    attemptId: string,
    expectedAttemptDefinitionHash: string,
    permission: { authorizationId: string; permissionHash: string },
    report: ReturnType<typeof reportFor> & { protocol: string },
  ) {
    return {
      selector,
      attemptId,
      expectedAttemptDefinitionHash,
      authorizationId: permission.authorizationId,
      expectedPermissionHash: permission.permissionHash,
      expectedEvidenceHash: archiveHash(report),
      requiredThrough,
    };
  }
  function predecessor(
    pins: ReturnType<typeof versionPins>,
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
    artifact,
    metadata,
    expectedMetadataHash: metadata.metadataHash,
  });
  const declaration = await store.declareHistoricalPutAttemptV2({
    ...profileInput,
    ...historyIds,
    artifact,
    metadata,
    expectedMetadataHash: metadata.metadataHash,
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
  const protection = protectHistoricalPutDestinationFromAccreditation(
    historical,
    controlsHash,
    historicalAccreditationHash,
    historicalAccreditation,
  );
  const protectionPins = {
    ...profileInput,
    attemptId: historical.id,
    expectedAttemptDefinitionHash: historical.definitionHash,
    expectedGateRevision: declaration.gateRevision,
    expectedControlsHash: controlsHash,
    expectedProtectionHash: protection.protectionHash,
  };
  const protectedHistory = await store.recordHistoricalPutDestinationProtection(
    protectionPins,
    protection,
  );
  const historicalDispatcher = new ItemHistoricalPutDispatcher(
    historyIds.dispatcherInstanceId,
    store,
    fixedSource,
    historyCustody,
    {
      readDestinationAccreditation: () =>
        Promise.resolve(historicalAccreditation),
    },
    transport,
  );
  Object.assign(config, {
    permissionEvidenceFor: historicalDispatcher.permissionEvidenceFor,
  });
  const historicalDispatch = {
    ...protectionPins,
    expectedGateRevision: protectedHistory.gateRevision,
    authorizationId: id(184),
    expectedAccreditationHash: historicalAccreditationHash,
  };
  const sentHistory = await historicalDispatcher.dispatch(historicalDispatch);
  expect(sentHistory.outcome).toBe('UNKNOWN');
  await expect(
    historicalDispatcher.dispatch(historicalDispatch),
  ).rejects.toThrow('already used');
  const historyContext = {
    definition: historical,
    permission: sentHistory.permission,
  };
  const historicalReport = {
    ...reportFor(historicalPutVersionScope(historyContext)),
    protocol: 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const historyPins = versionPins(
    historical.id,
    historical.definitionHash,
    sentHistory.permission,
    historicalReport,
  );
  const historicalVersion = await new ItemHistoricalPutReconciler(
    store,
    { readVersionEvidence: () => Promise.resolve(historicalReport) },
    versions,
    now,
  ).reconcileAndRecord(historyPins);

  const stagingSource = predecessor(historyPins, historicalVersion);
  const stagingInput = { anchor, source: stagingSource };
  const stagingIntent =
    await store.prepareStagingFromHistoricalPut(stagingInput);
  const stagingIds = { attemptId: id(185), dispatcherInstanceId: id(186) };
  const staging = buildItemStagingPutAttempt(
    await store.readHistoricalCopy(preparation),
    {
      ...historyContext,
      versionRecord: historicalVersion,
    },
    {
      ...stagingIds,
      expectedManifestHash,
      expectedStagingIntentHash: stagingIntent.intentDefinitionHash,
    },
  );
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
      expectedGateRevision: sentHistory.permission.gateRevision,
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
  const stagingReport = {
    ...reportFor(stagingPutVersionScope(stagingContext)),
    protocol: 'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const stagingPins = versionPins(
    staging.id,
    staging.definitionHash,
    sentStaging.permission,
    stagingReport,
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
  const finalReport = {
    ...reportFor(
      recipientFinalPutVersionScope({
        definition: final,
        permission: sentFinal.permission,
      }),
    ),
    protocol: 'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const finalPins = versionPins(
    final.id,
    final.definitionHash,
    sentFinal.permission,
    finalReport,
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
