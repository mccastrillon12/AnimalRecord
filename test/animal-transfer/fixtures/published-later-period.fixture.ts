import { createHash } from 'node:crypto';
import {
  archiveHash,
  buildArchiveEntry,
  type OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildRetainedArchiveEntry } from '../../../src/context/animal-transfer/domain/ownership-archive-history';
import { projectItemRecipientEntries } from '../../../src/context/animal-transfer/domain/ownership-archive-recipient-projection';
import {
  archiveDefinitionOnly,
  buildArchiveReservation,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import { buildPublishedHistoryStableCutScope } from '../../../src/context/animal-transfer/domain/published-history-stable-cut-scope';
import {
  buildPublishedHistoryRetainedReferencesPublication,
  buildPublishedHistoryRetainedReferencesReceipt,
} from '../../../src/context/animal-transfer/domain/published-history-retained-references';
import { buildAcceptanceCandidate } from '../../../src/context/animal-transfer/domain/transfer-acceptance-preparation';
import { buildAcceptanceStartBinding } from '../../../src/context/animal-transfer/domain/transfer-acceptance-start';
import {
  PUT_DESTINATION_WRITER_GROUPS,
  type PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import {
  appendItemManifestEntryDigest,
  appendItemManifestFileDigest,
  ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
  ITEM_MANIFEST_FILES_DIGEST_SEED,
} from '../../../src/context/animal-transfer/domain/transfer-item-manifest-digest';
import { buildLaterPeriodItemOwnershipCommit } from '../../../src/context/animal-transfer/domain/transfer-item-ownership-commit';
import {
  buildLaterPeriodStableCutAccreditationRecord,
  buildLaterPeriodStableCutConsumption,
  buildPublishedHistoryStableCutAccreditationRecord,
  buildPublishedHistoryStableCutConsumption,
  LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
} from '../../../src/context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import { MongoTransferItemCapture } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-item-capture';
import { acceptanceStartStore } from './acceptance-start-store.fixture';
import { laterPeriodLiveMediaFixture } from './later-period-live-media.fixture';
import { archiveAnimal } from './ownership-archive.fixture';

/** Published rows from a second transfer, with synthetic storage and retained-copy reconciliation. */
export async function publishedLaterPeriod() {
  const f = acceptanceStartStore();
  const { binding } = await f.service.start(f.input);
  const selected = binding.selected[0];
  const closed = f.state.db.archives[0] as unknown as OwnershipArchive;
  const definition = { ...archiveDefinitionOnly(closed), ownershipVersion: 2 };
  const reservation = buildArchiveReservation(
    definition,
    selected.reservationEpoch,
  );
  const priorPublication = archiveHash('first publication');
  const sourceManifestHash = archiveHash('first manifest');
  const recordedAt = '2026-10-29T12:02:00.000Z';
  const effectiveAt = '2026-10-29T12:03:00.000Z';
  const requiredThrough = '2026-10-29T12:05:00.000Z';
  const validUntil = '2026-10-29T12:06:00.000Z';
  const priorDefinition = {
    ...definition,
    id: f.id(180),
    periodId: f.id(181),
    transferId: f.id(182),
    ownerId: f.id(183),
    recipientId: definition.ownerId,
    ownershipVersion: 1,
  };
  const predecessor = {
    ...priorDefinition,
    definitionHash: archiveHash(priorDefinition),
    ownershipCommitHash: priorPublication,
    manifestDigest: { manifestHash: sourceManifestHash },
  };
  const source = buildArchiveEntry(
    priorDefinition,
    {
      kind: 'ANIMAL',
      data: {
        ...archiveAnimal,
        id: definition.animalId,
        ownerId: priorDefinition.ownerId,
        profilePictureUrl: `https://synthetic.invalid/users/${priorDefinition.ownerId}/animals/${definition.animalId}/profile/photo.jpg`,
      },
    },
    f.keys.keyFromUrl,
  );
  const bytes = Buffer.from('retained history');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sourceFileDefinition = {
    ...source.files[0],
    source: {
      size: bytes.length,
      etag: 'original-etag',
      versionId: 'original',
    },
  };
  const original = {
    ...sourceFileDefinition,
    definitionHash: archiveHash(sourceFileDefinition),
    state: 'VERIFIED' as const,
  };
  const history = {
    sourceArchiveId: predecessor.id,
    sourceDefinitionHash: predecessor.definitionHash,
    sourcePublicationHash: priorPublication,
    sourceEntriesDigest: archiveHash('first entries'),
    expectedEntryCount: 1,
    expectedFileCount: 1,
    phase: 'COMPLETE' as const,
    entryCount: 1,
    revision: 1,
  };
  const archive = {
    ...definition,
    definitionHash: archiveHash(definition),
    reservation,
    state: 'COPYING' as const,
    createdAt: recordedAt,
    history,
    expectedEntryCount: 2,
    expectedFileCount: 2,
  };
  const location = {
    bucket: 'synthetic-history',
    expectedBucketOwner: '123456789012',
  };
  const retained = buildRetainedArchiveEntry(
    archive,
    predecessor as OwnershipArchive,
    source.entry,
    [original],
    f.keys.keyFromUrl,
    new Map([
      [
        original.id,
        {
          fileDefinitionHash: original.definitionHash,
          target: { ...location, key: original.historicalKey },
          revision: {
            size: bytes.length,
            etag: 'prior-etag',
            versionId: 'prior-version',
          },
          sha256,
          requiredThrough,
        },
      ],
    ]),
  );
  const file = retained.files[0];
  const originalControlsHash = archiveHash('original controls');
  const target = { ...location, key: file.historicalKey };
  const revision = {
    size: bytes.length,
    etag: 'historical-etag',
    versionId: 'second-historical-version',
  };
  const historicalPin = {
    observationHash: archiveHash('historical observation'),
    target,
    revision,
    sha256,
    conservationControlsHash: originalControlsHash,
  };
  const finalPin = {
    ...historicalPin,
    observationHash: archiveHash('final observation'),
    target: { ...location, key: file.recipientFinalKey },
    revision: { ...revision, etag: 'final-etag', versionId: 'final-version' },
  };
  const permission = (name: string) => ({
    attemptDefinitionHash: archiveHash([name, 'attempt']),
    protectionHash: archiveHash([name, 'protection']),
    authorizationId: archiveHash([name, 'authorization']),
    permissionHash: archiveHash([name, 'permission']),
  });
  const attempts = [
    permission('historical'),
    permission('staging'),
    permission('final'),
  ] as const;
  const scope = buildPublishedHistoryStableCutScope(
    {
      archiveId: archive.id,
      archiveDefinitionHash: archive.definitionHash,
      reservationEpoch: reservation.epoch,
      reservationBindingHash: reservation.bindingHash,
      sourceArchiveId: predecessor.id,
      publicationHash: priorPublication,
      sourceManifestHash,
      preparedCoverageHash: archiveHash('prepared'),
      projectionHash: archiveHash('retained projection'),
      requiredThrough,
    },
    [
      {
        fileId: file.id,
        fileDefinitionHash: file.definitionHash,
        sourceFileId: original.id,
        historical: historicalPin,
        final: finalPin,
        attempts,
      },
    ],
  );
  const makeVersion = (pin: typeof historicalPin) => ({
    observation: {
      observationHash: pin.observationHash,
      scope: { target: pin.target, sha256: pin.sha256 },
      revision: pin.revision,
      checkedAt: recordedAt,
      requiredThrough,
    },
    evidence: {
      conservationControlsHash: pin.conservationControlsHash,
      validFrom: recordedAt,
      validUntil,
    },
  });
  const copyFacts = {
    historical: makeVersion(historicalPin),
    final: makeVersion(finalPin),
    attempts,
  };
  type RetainedReader = Parameters<
    MongoTransferItemCapture['publishedHistoryVersionSource']
  >[0];
  const readPublishedRetainedCopyFacts = jest.fn(
    (): ReturnType<RetainedReader['readPublishedRetainedCopyFacts']> =>
      copyFacts as unknown as ReturnType<
        RetainedReader['readPublishedRetainedCopyFacts']
      >,
  );
  const coverage = {
    disposition: 'ISOLATED' as const,
    evidenceHash: archiveHash('isolated'),
  };
  const report = {
    issuerId: f.recipientId,
    scopeHash: scope.scopeHash,
    controlsHash: originalControlsHash,
    writerInventoryHash: archiveHash('writers'),
    writers: Object.fromEntries(
      PUT_DESTINATION_WRITER_GROUPS.map((group) => [group, coverage]),
    ) as PutDestinationWriters,
    copyEffects: coverage,
    retainedVersionsEvidenceHash: archiveHash('retained versions evidence'),
    validFrom: recordedAt,
    validUntil,
  };
  const live = laterPeriodLiveMediaFixture(
    archive,
    f.keys.keyFromUrl,
    location,
    { validFrom: recordedAt, validUntil },
    report.writers,
  );
  const retainedReport = {
    ...report,
    protocol: 'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION_V1' as const,
  };
  const retainedRecord = buildPublishedHistoryStableCutAccreditationRecord(
    scope,
    retainedReport,
    archiveHash(retainedReport),
    recordedAt,
  );
  const marker = buildPublishedHistoryStableCutConsumption(
    retainedRecord,
    effectiveAt,
  );
  const reference = {
    protocol: 'PUBLISHED_HISTORY_RETAINED_REFERENCES_V1' as const,
    mode: 'RETAINED_READ_ONLY' as const,
    archiveId: archive.id,
    entryId: retained.entry.id,
    sourceContentHash: retained.entry.contentHash,
    consumptionHash: marker.definitionHash,
    references: retained.entry.fileBindings.map(({ path, fileId }) => ({
      path,
      fileId,
      format: 'URL' as const,
      registrationId: archiveHash('registration'),
      registrationDefinitionHash: archiveHash('registration definition'),
    })),
  };
  const link = { ...reference, definitionHash: archiveHash(reference) };
  const links = buildPublishedHistoryRetainedReferencesReceipt(
    marker,
    [link],
    1,
  );
  const candidate = buildAcceptanceCandidate(
    f.input,
    {
      ...f.snapshot,
      items: f.snapshot.items.map((item) =>
        item._id === selected.itemId
          ? { ...item, expectedOwnershipVersion: 2 }
          : item,
      ),
      animals: binding.selected.map(({ animalId }) => ({
        id: animalId,
        ownerId: f.actorId,
        isActive: true,
      })),
      controls: binding.selected.map(({ animalId }) => ({
        animalId,
        ownerId: f.actorId,
        ownershipVersion: animalId === selected.animalId ? 2 : 1,
        lockPresent: false,
        writersPresent: false,
      })),
      periods: [
        ...binding.selected.map(({ archiveId, animalId }) => ({
          id: String(
            f.state.db.archives.find((row) => row.id === archiveId)!.periodId,
          ),
          animalId,
          ownerId: f.actorId,
          ownershipVersion: animalId === selected.animalId ? 2 : 1,
          status: 'ACTIVE' as const,
        })),
        {
          id: predecessor.periodId,
          animalId: predecessor.animalId,
          ownerId: predecessor.ownerId,
          ownershipVersion: 1,
          status: 'CLOSED',
          archiveId: predecessor.id,
        },
      ],
    },
    binding.startedAt,
    'WITH_PUBLISHED_HISTORY',
  );
  const acceptance = buildAcceptanceStartBinding(
    candidate,
    f.input,
    binding.startedAt,
    new Map([
      [
        selected.itemId,
        { archiveId: predecessor.id, publicationHash: priorPublication },
      ],
    ]),
  );
  const selector = {
    actorId: f.recipientId,
    transferId: f.input.transferId,
    itemId: selected.itemId,
    decisionOperationId: f.input.operationId,
    expectedRequestVersion: binding.expectedVersion + 1,
    expectedCaptureRevision: 0,
  };
  const liveManifest = {
    entryCount: 1,
    fileCount: 1,
    entriesDigest: appendItemManifestEntryDigest(
      ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
      live.entry,
    ),
    filesDigest: appendItemManifestFileDigest(
      ITEM_MANIFEST_FILES_DIGEST_SEED,
      live.file.id,
      live.file.definitionHash,
    ),
  };
  const media = [live.media];
  const entries = projectItemRecipientEntries(archive, [live.entry], media, {
    keyFromUrl: f.keys.keyFromUrl,
    urlForKey: (key) => `https://synthetic.invalid/${key}`,
  });
  const jointFacts = {
    protocol: LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
    archiveId: archive.id,
    admissionHash: archiveHash({
      protocol: 'LATER_PERIOD_ITEM_DOSSIER_ADMISSION_V1',
      selector,
      archiveDefinitionHash: archive.definitionHash,
      acceptanceBindingHash: acceptance.bindingHash,
      reservationEpoch: reservation.epoch,
      reservationBindingHash: reservation.bindingHash,
      retainedScopeHash: scope.scopeHash,
      retainedProjectionHash: scope.binding.projectionHash,
      live: liveManifest,
      businessCommit: 'NOT_AUTHORIZED',
    }),
    retainedScopeHash: scope.scopeHash,
    retainedProjectionHash: scope.binding.projectionHash,
    retainedFileCount: 1,
    liveManifest,
    liveProjectionHash: archiveHash({ entries, media }),
    liveMediaDigest: archiveHash(media),
    conservationControlsHashes: [
      originalControlsHash,
      live.media.historical.conservationControlsHash,
    ].sort(),
    requiredThrough,
    stableCut: 'NOT_ASSESSED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  const jointScope = { ...jointFacts, scopeHash: archiveHash(jointFacts) };
  const jointReport = {
    ...report,
    scopeHash: jointScope.scopeHash,
    protocol: 'LATER_PERIOD_ITEM_STABLE_CUT_ACCREDITATION_V1' as const,
    liveVersionsEvidenceHash: archiveHash('live versions evidence'),
  };
  const jointRecord = buildLaterPeriodStableCutAccreditationRecord(
    jointScope,
    jointReport,
    archiveHash(jointReport),
    recordedAt,
  );
  const consumption = buildLaterPeriodStableCutConsumption(jointRecord, links);
  const commitSelection = {
    selector,
    retainedSelection: {
      archiveId: archive.id,
      expectedArchiveDefinitionHash: archive.definitionHash,
      expectedReservationEpoch: reservation.epoch,
      expectedPublicationHash: priorPublication,
      expectedSourceManifestHash: sourceManifestHash,
      expectedPreparedCoverageHash: scope.binding.preparedCoverageHash,
      expectedProjectionHash: scope.binding.projectionHash,
      requiredThrough,
    },
    expectedScopeHash: jointScope.scopeHash,
    expectedAccreditationHash: jointRecord.accreditationHash,
    expectedRetainedAccreditationHash: retainedRecord.accreditationHash,
  };
  const receipt = buildLaterPeriodItemOwnershipCommit(
    definition,
    commitSelection,
    consumption,
    reservation.epoch,
    selector.expectedRequestVersion + 1,
  );
  Object.assign(closed, archive, {
    evidenceConsumption: marker,
    laterPeriodStableCutConsumption: consumption,
    retainedReferencesReceipt: links,
    retainedReferencesPublication:
      buildPublishedHistoryRetainedReferencesPublication(links, receipt),
    ownershipCommitHash: receipt.commitHash,
  });
  delete closed.capture;
  Object.assign(f.state.db.requests[0], {
    version: receipt.requestVersion,
    acceptedItemCount: 1,
    acceptanceStart: acceptance,
  });
  Object.assign(f.state.db.items.find((row) => row._id === selected.itemId)!, {
    status: 'ACCEPTED',
    expectedOwnershipVersion: 2,
    ownershipCommit: receipt,
  });
  Object.assign(
    f.state.db.periods.find((row) => row.id === archive.periodId)!,
    {
      ownershipVersion: 2,
      status: 'CLOSED',
      archiveId: archive.id,
      endedAt: effectiveAt,
    },
  );
  f.state.db.periods.push({
    id: receipt.activePeriodId,
    animalId: receipt.animalId,
    ownerId: receipt.ownerId,
    ownershipVersion: receipt.ownershipVersion,
    status: 'ACTIVE',
    sourceTransferId: receipt.transferId,
    startedAtKnown: true,
    startedAt: effectiveAt,
  });
  f.state.db.archives.push(predecessor);
  f.state.db.entries.push(live.entry, {
    ...retained.entry,
    retainedReferences: link,
  });
  f.state.db.files.push(original, live.file, {
    ...file,
    publishedHistoryPutDeclaration: {
      attempt: { request: { contentType: 'image/jpeg' } },
    },
  });
  f.state.db.copyRecords.push(
    retainedRecord,
    jointRecord,
    live.record,
    live.historicalPut,
    live.finalPut,
  );
  let at = effectiveAt;
  const now = () => new Date(at);
  const profiles = {
    assertActiveSharedControls: jest.fn().mockResolvedValue(undefined),
    fenceActiveSharedControls: jest.fn().mockResolvedValue(undefined),
  };
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
      { profiles, now },
    ] as unknown as ConstructorParameters<typeof MongoTransferItemCapture>),
  );
  f.state.writes = 0;
  const publication = {
    actorId: archive.ownerId,
    periodId: archive.periodId,
    publicationHash: receipt.commitHash,
  };
  return {
    state: f.state,
    recipientId: f.recipientId,
    store,
    bytes,
    target,
    revision,
    copyFacts,
    profiles,
    now,
    originalControlsHash,
    keyFromUrl: f.keys.keyFromUrl,
    setTime: (time: string) => {
      at = time;
    },
    history: store.publishedHistoryVersionSource({
      readPublishedRetainedCopyFacts,
    }),
    selection: {
      ...publication,
      entryId: retained.entry.id,
      fileId: file.id,
    },
    live,
    liveSelection: {
      ...publication,
      entryId: live.entry.id,
      fileId: live.file.id,
    },
  };
}
