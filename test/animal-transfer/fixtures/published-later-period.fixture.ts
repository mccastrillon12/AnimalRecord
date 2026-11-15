import { createHash } from 'node:crypto';
import {
  archiveHash,
  buildArchiveEntry,
  type OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildRetainedArchiveEntry } from '../../../src/context/animal-transfer/domain/ownership-archive-history';
import { type PublishedHistoryFinalMediaRegistration } from '../../../src/context/animal-transfer/domain/ownership-archive-media-registration';
import {
  projectItemRecipientEntries,
  projectPublishedHistoryRecipientEntries,
} from '../../../src/context/animal-transfer/domain/ownership-archive-recipient-projection';
import {
  archiveDefinitionOnly,
  buildArchiveReservation,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import {
  buildPublishedHistoryStableCutScope,
  type PublishedHistoryStableCutAttempt,
} from '../../../src/context/animal-transfer/domain/published-history-stable-cut-scope';
import {
  buildPublishedHistoryRetainedReferences,
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
import { MongoOwnershipArchiveHistory } from '../../../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-ownership-archive-history';
import { acceptanceStartStore } from './acceptance-start-store.fixture';
import { laterPeriodLiveMediaFixture } from './later-period-live-media.fixture';
import { archiveAnimal } from './ownership-archive.fixture';
import { publishedRetainedCopyChain } from './published-retained-copy-chain.fixture';
import { acceptanceAt } from './transfer-acceptance-preparation.fixture';

/** Sealed second-period dossier with synthetic storage and reconciled copy records. */
export async function publishedLaterPeriod(
  stage: 'published' | 'processing' = 'published',
  {
    selectedIndex = 0,
    bothLater = false,
    controls,
  }: {
    selectedIndex?: 0 | 1;
    bothLater?: boolean;
    controls?: { retained: string; live: string };
  } = {},
) {
  const f = acceptanceStartStore();
  const urls = {
    keyFromUrl: f.keys.keyFromUrl,
    urlForKey: (key: string) => `https://synthetic.invalid/${key}`,
  };
  const { binding } = await f.service.start(f.input);
  const selected = binding.selected[selectedIndex];
  const closed = f.state.db.archives.find(
    (row) => row.id === selected.archiveId,
  )! as unknown as OwnershipArchive;
  const definition = { ...archiveDefinitionOnly(closed), ownershipVersion: 2 };
  const reservation = buildArchiveReservation(
    definition,
    selected.reservationEpoch,
  );
  const predecessors = binding.selected.map((item, index) => ({
    itemId: item.itemId,
    animalId: item.animalId,
    archiveId: f.id(180 + index * 4),
    periodId: f.id(181 + index * 4),
    transferId: f.id(182 + index * 4),
    ownerId: f.id(183 + index * 4),
    publicationHash: archiveHash(['first publication', item.animalId]),
  }));
  const prior = predecessors[selectedIndex];
  const priorPublication = prior.publicationHash;
  const sourceManifestHash = archiveHash(['first manifest', prior.archiveId]);
  const recordedAt = '2026-10-29T12:02:00.000Z';
  const effectiveAt = '2026-10-29T12:03:00.000Z';
  const requiredThrough = '2026-10-29T12:05:00.000Z';
  const validUntil = '2026-10-29T12:06:00.000Z';
  const priorDefinition = {
    ...definition,
    id: prior.archiveId,
    periodId: prior.periodId,
    transferId: prior.transferId,
    ownerId: prior.ownerId,
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
  const originalControlsHash =
    controls?.retained ?? archiveHash('original controls');
  const file = publishedRetainedCopyChain(archive, retained.files[0], {
    publicationHash: priorPublication,
    controlsHash: originalControlsHash,
    checkedAt: recordedAt,
    requiredThrough,
    validUntil,
  });
  const pin = ({
    observation,
    evidence,
  }:
    | typeof file.publishedHistoryPutVersion
    | typeof file.publishedHistoryFinalPutVersion) => ({
    observationHash: observation.observationHash,
    target: observation.scope.target,
    revision: observation.revision,
    sha256: observation.scope.sha256,
    conservationControlsHash: evidence.conservationControlsHash,
  });
  const historicalPin = pin(file.publishedHistoryPutVersion);
  const finalPin = pin(file.publishedHistoryFinalPutVersion);
  const { target, revision } = historicalPin;
  const permissionPin = ({
    attemptDefinitionHash,
    protectionHash,
    authorizationId,
    permissionHash,
  }: PublishedHistoryStableCutAttempt): PublishedHistoryStableCutAttempt => ({
    attemptDefinitionHash,
    protectionHash,
    authorizationId,
    permissionHash,
  });
  const attempts = [
    permissionPin(file.publishedHistoryPutPermission),
    permissionPin(file.publishedHistoryStagingPutPermission),
    permissionPin(file.publishedHistoryFinalPutPermission),
  ] as const;
  const preparedCoverageHash = archiveHash('prepared');
  const registrationFacts = {
    protocol: 'PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_V1',
    id: archiveHash([
      'PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_V1',
      archive.id,
      file.id,
    ]),
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    intentDefinitionHash: file.publishedHistoryFinalIntent.definitionHash,
    animalId: archive.animalId,
    fromOwnerId: archive.ownerId,
    recipientId: archive.recipientId,
    sourcePeriodId: archive.periodId,
    sourceOwnershipVersion: archive.ownershipVersion,
    transferId: archive.transferId,
    key: finalPin.target.key,
    revision: finalPin.revision,
    sha256,
    mode: 'RETAINED_READ_ONLY',
    state: 'PREPARED',
    retained: file.retained!,
    publishedHistoryEvidence: {
      sourceManifestHash,
      reservationEpoch: reservation.epoch,
      reservationBindingHash: reservation.bindingHash,
      attemptDefinitionHash: attempts[2].attemptDefinitionHash,
      permissionHash: attempts[2].permissionHash,
      versionObservationHash: finalPin.observationHash,
      conservationControlsHash: finalPin.conservationControlsHash,
      requiredThrough,
      ...location,
    },
  } satisfies Omit<PublishedHistoryFinalMediaRegistration, 'definitionHash'>;
  const registration = {
    ...registrationFacts,
    definitionHash: archiveHash(registrationFacts),
  };
  const retainedCandidate = {
    protocol: 'PUBLISHED_HISTORY_RECIPIENT_PROJECTION_V1' as const,
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    reservationEpoch: reservation.epoch,
    reservationBindingHash: reservation.bindingHash,
    sourceArchiveId: predecessor.id,
    publicationHash: priorPublication,
    sourceManifestHash,
    preparedCoverageHash,
    requiredThrough,
    entries: projectPublishedHistoryRecipientEntries(
      priorDefinition,
      [retained.entry],
      [registration],
      urls,
    ),
    media: [registration],
    reservation: 'OBSERVED_ONLY' as const,
    stableCut: 'NOT_ASSESSED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  const retainedProjection = {
    ...retainedCandidate,
    projectionHash: archiveHash(retainedCandidate),
  };
  const retainedFiles = [
    {
      fileId: file.id,
      fileDefinitionHash: file.definitionHash,
      sourceFileId: original.id,
      historical: historicalPin,
      final: finalPin,
      attempts,
    },
  ];
  const scope = buildPublishedHistoryStableCutScope(
    {
      archiveId: archive.id,
      archiveDefinitionHash: archive.definitionHash,
      reservationEpoch: reservation.epoch,
      reservationBindingHash: reservation.bindingHash,
      sourceArchiveId: predecessor.id,
      publicationHash: priorPublication,
      sourceManifestHash,
      preparedCoverageHash,
      projectionHash: retainedProjection.projectionHash,
      requiredThrough,
    },
    retainedFiles,
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
    controls?.live,
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
  const [link] = buildPublishedHistoryRetainedReferences(
    marker,
    retainedProjection.entries,
    retainedProjection.media,
  );
  const links = buildPublishedHistoryRetainedReferencesReceipt(
    marker,
    [link],
    1,
  );
  const later = bothLater ? predecessors : [prior];
  const ownershipVersion = (animalId: string) =>
    later.some((item) => item.animalId === animalId) ? 2 : 1;
  const candidate = buildAcceptanceCandidate(
    f.input,
    {
      ...f.snapshot,
      items: f.snapshot.items.map((item) => ({
        ...item,
        expectedOwnershipVersion: ownershipVersion(item.animalId),
      })),
      animals: binding.selected.map(({ animalId }) => ({
        id: animalId,
        ownerId: f.actorId,
        isActive: true,
      })),
      controls: binding.selected.map(({ animalId }) => ({
        animalId,
        ownerId: f.actorId,
        ownershipVersion: ownershipVersion(animalId),
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
          ownershipVersion: ownershipVersion(animalId),
          status: 'ACTIVE' as const,
        })),
        ...later.map(({ periodId, animalId, ownerId, archiveId }) => ({
          id: periodId,
          animalId,
          ownerId,
          ownershipVersion: 1,
          status: 'CLOSED' as const,
          archiveId,
        })),
      ],
    },
    acceptanceAt,
    'WITH_PUBLISHED_HISTORY',
  );
  const acceptance = buildAcceptanceStartBinding(
    candidate,
    f.input,
    acceptanceAt,
    new Map(
      later.map(({ itemId, archiveId, publicationHash }) => [
        itemId,
        { archiveId, publicationHash },
      ]),
    ),
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
  const entries = projectItemRecipientEntries(
    archive,
    [live.entry],
    media,
    urls,
  );
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
  Object.assign(closed, archive);
  delete closed.capture;
  const { db } = f.state;
  const request = db.requests[0];
  const item = db.items.find((row) => row._id === selected.itemId)!;
  const period = db.periods.find((row) => row.id === archive.periodId)!;
  const control = db.controls.find((row) => row.animalId === archive.animalId)!;
  const previousEnd = '2026-10-28T12:03:00.000Z';
  request.acceptanceStart = acceptance;
  request.decidedAt = acceptance.startedAt;
  item.expectedOwnershipVersion = archive.ownershipVersion;
  control.ownershipVersion = archive.ownershipVersion;
  control.transferLock = {
    transferId: archive.transferId,
    lockedAt: acceptance.startedAt,
  };
  Object.assign(period, {
    ownershipVersion: archive.ownershipVersion,
    startedAt: previousEnd,
    startedAtKnown: true,
    sourceTransferId: predecessor.transferId,
  });
  f.state.db.periods.push({
    id: predecessor.periodId,
    animalId: predecessor.animalId,
    ownerId: predecessor.ownerId,
    ownershipVersion: predecessor.ownershipVersion,
    status: 'CLOSED',
    archiveId: predecessor.id,
    endedAt: previousEnd,
  });
  Object.assign(
    db.animals.find((row) => row.id === archive.animalId)!,
    live.animal,
  );
  const retainedEntry = { ...retained.entry };
  if (stage === 'published') {
    Object.assign(closed, {
      evidenceConsumption: marker,
      laterPeriodStableCutConsumption: consumption,
      retainedReferencesReceipt: links,
      retainedReferencesPublication:
        buildPublishedHistoryRetainedReferencesPublication(links, receipt),
      ownershipCommitHash: receipt.commitHash,
    });
    Object.assign(request, {
      version: receipt.requestVersion,
      acceptedItemCount: 1,
    });
    Object.assign(item, { status: 'ACCEPTED', ownershipCommit: receipt });
    Object.assign(period, {
      status: 'CLOSED',
      archiveId: archive.id,
      endedAt: effectiveAt,
    });
    retainedEntry.retainedReferences = link;
    db.periods.push({
      id: receipt.activePeriodId,
      animalId: receipt.animalId,
      ownerId: receipt.ownerId,
      ownershipVersion: receipt.ownershipVersion,
      status: 'ACTIVE',
      sourceTransferId: receipt.transferId,
      startedAtKnown: true,
      startedAt: effectiveAt,
    });
  }
  f.state.db.archives.push(predecessor);
  f.state.db.entries.push(live.entry, retainedEntry);
  f.state.db.registrations.push(registration);
  f.state.db.files.push(original, live.file, file);
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
      f.models[15],
    ] as unknown as ConstructorParameters<typeof MongoTransferItemCapture>),
  );
  const retainedReader = new MongoOwnershipArchiveHistory(
    ...([
      f.models[9],
      f.models[13],
      f.models[12],
      f.models[5],
      f.models[4],
    ] as unknown as ConstructorParameters<typeof MongoOwnershipArchiveHistory>),
  );
  f.state.writes = 0;
  const publication = {
    actorId: archive.ownerId,
    periodId: archive.periodId,
    publicationHash: receipt.commitHash,
  };
  return {
    state: f.state,
    connection: f.connection,
    calls: f.calls,
    models: f.models,
    urls,
    commitSelection,
    retainedScope: scope,
    retainedProjection,
    retainedFiles,
    jointScope,
    jointReport,
    expectedReceipt: receipt,
    recipientId: f.recipientId,
    store,
    bytes,
    target,
    revision,
    retainedFile: file,
    profiles,
    now,
    originalControlsHash,
    keyFromUrl: f.keys.keyFromUrl,
    setTime: (time: string) => {
      at = time;
    },
    history: store.publishedHistoryVersionSource(retainedReader),
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
