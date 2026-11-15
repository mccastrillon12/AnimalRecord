import { createHash } from 'node:crypto';
import {
  archiveHash,
  buildArchiveEntry,
  type OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildArchiveReservation } from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import { buildAcceptanceCandidate } from '../../../src/context/animal-transfer/domain/transfer-acceptance-preparation';
import { buildAcceptanceStartBinding } from '../../../src/context/animal-transfer/domain/transfer-acceptance-start';
import { buildItemCopyGateDefinition } from '../../../src/context/animal-transfer/domain/transfer-item-copy-record';
import {
  PUT_DESTINATION_WRITER_GROUPS,
  type PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import {
  appendItemManifestEntryDigest,
  appendItemManifestFileDigest,
  captureItemManifestDigest,
  ITEM_MANIFEST_DIGEST_PROTOCOL,
  ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
  ITEM_MANIFEST_FILES_DIGEST_SEED,
} from '../../../src/context/animal-transfer/domain/transfer-item-manifest-digest';
import { buildItemOwnershipCommit } from '../../../src/context/animal-transfer/domain/transfer-item-ownership-commit';
import {
  buildItemStableCutAccreditationRecord,
  buildItemStableCutConsumption,
  buildItemStableCutScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import { transferRecordId } from '../../../src/context/animal-transfer/domain/transfer-record-id';
import type {
  TransferRequestItem,
  TransferRequestRecord,
} from '../../../src/context/animal-transfer/domain/transfer-request';
import { AnimalTransferReasonCode } from '../../../src/context/catalogs/domain/animal-transfer-reason';
import { archiveAnimal } from './ownership-archive.fixture';

/** Persistable first publication for scenarios that start after the initial close. */
export function publishedInitialPredecessor({
  animalId,
  ownerId,
  recipientId,
  transferId,
  periodId,
  operationId,
  endedAt,
  keyFromUrl,
}: {
  animalId: string;
  ownerId: string;
  recipientId: string;
  transferId: string;
  periodId: string;
  operationId: string;
  endedAt: string;
  keyFromUrl: (url: string) => string | undefined;
}) {
  const startedAt = '2026-10-28T12:00:00.000Z';
  const requiredThrough = '2026-10-28T12:05:00.000Z';
  const validUntil = '2026-10-28T12:06:00.000Z';
  const input = {
    actorId: recipientId,
    transferId,
    operationId,
    expectedVersion: 1,
    acceptedAnimalIds: [animalId],
  };
  const request = {
    _id: transferId,
    senderId: ownerId,
    recipientId,
    status: 'PENDING' as const,
    version: 1,
    animalCount: 1,
  };
  const item = {
    _id: transferRecordId('item', transferId, animalId),
    transferId,
    animalId,
    expectedOwnerId: ownerId,
    expectedOwnershipVersion: 1,
    status: 'PENDING' as const,
  };
  const candidate = buildAcceptanceCandidate(
    input,
    {
      request,
      items: [item],
      claims: [{ _id: animalId, transferId }],
      animals: [{ id: animalId, ownerId, isActive: true }],
      controls: [
        {
          animalId,
          ownerId,
          ownershipVersion: 1,
          lockPresent: false,
          writersPresent: false,
        },
      ],
      periods: [
        {
          id: periodId,
          animalId,
          ownerId,
          ownershipVersion: 1,
          status: 'ACTIVE',
        },
      ],
      pendingMedicalAnimalIds: [],
    },
    startedAt,
  );
  const acceptanceStart = buildAcceptanceStartBinding(
    candidate,
    input,
    startedAt,
  );
  const [{ definition, proposedReservationEpoch }] = candidate.selected;
  const reservation = buildArchiveReservation(
    definition,
    proposedReservationEpoch,
  );
  const { entry, files } = buildArchiveEntry(
    definition,
    {
      kind: 'ANIMAL',
      data: {
        ...archiveAnimal,
        id: animalId,
        ownerId,
        profilePictureUrl: `https://synthetic.invalid/users/${ownerId}/animals/${animalId}/profile/photo.jpg`,
      },
    },
    keyFromUrl,
  );
  const bytes = Buffer.from('retained history');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fileDefinition = {
    ...files[0],
    source: {
      size: bytes.length,
      etag: 'original-etag',
      versionId: 'original',
    },
  };
  const file = {
    ...fileDefinition,
    definitionHash: archiveHash(fileDefinition),
    state: 'VERIFIED' as const,
  };
  const observedSeal = {
    acceptanceBindingHash: acceptanceStart.bindingHash,
    archiveId: definition.id,
    definitionHash: archiveHash(definition),
    reservationBindingHash: reservation.bindingHash,
    reservationEpoch: reservation.epoch,
    captureRevision: 1,
    expectedEntryCount: 1,
    expectedFileCount: 1,
  };
  const sealFacts = {
    transferId,
    itemId: item._id,
    requestVersion: request.version + 1,
    observedSeal,
  };
  const manifestFacts = {
    protocol: ITEM_MANIFEST_DIGEST_PROTOCOL,
    binding: {
      ...sealFacts,
      observedSealHash: archiveHash({
        protocol: 'ITEM_COPY_PREPARATION_OBSERVATION_V1',
        ...sealFacts,
      }),
    },
    entryCount: 1,
    fileCount: 1,
    entriesDigest: appendItemManifestEntryDigest(
      ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
      entry,
    ),
    filesDigest: appendItemManifestFileDigest(
      ITEM_MANIFEST_FILES_DIGEST_SEED,
      file.id,
      file.definitionHash,
    ),
    integrity: 'DECLARED_COUNTS_AND_BINDINGS_MATCH',
    reservation: 'OBSERVED_ONLY',
    provenance: 'NOT_ASSESSED',
    stableCut: 'NOT_ASSESSED',
    retention: 'NOT_ASSESSED',
    copyDispatch: 'NOT_AUTHORIZED',
    businessCommit: 'NOT_AUTHORIZED',
  } as const;
  const manifest = captureItemManifestDigest({
    ...manifestFacts,
    manifestHash: archiveHash(manifestFacts),
  });
  const selection = {
    selector: {
      actorId: recipientId,
      transferId,
      itemId: item._id,
      decisionOperationId: operationId,
      expectedRequestVersion: sealFacts.requestVersion,
      expectedCaptureRevision: observedSeal.captureRevision,
    },
    expectedSealHash: manifest.binding.observedSealHash,
    expectedManifestHash: manifest.manifestHash,
    expectedPreparedCoverageHash: archiveHash([
      file.id,
      'initial prepared coverage',
    ]),
    expectedProjectionHash: archiveHash([file.id, 'initial projection']),
    requiredThrough,
  };
  const gate = buildItemCopyGateDefinition(manifest.binding);
  const controlsHash = archiveHash([file.id, 'initial conservation controls']);
  const scope = buildItemStableCutScope(
    selection,
    {
      gate: {
        id: gate.id,
        recordHash: archiveHash([gate.id, 'initial record']),
        revision: 4,
        state: 'OPEN',
      },
      attemptCount: 3,
      permissionCount: 3,
      attemptsDigest: archiveHash([file.id, 'initial attempts']),
    },
    {
      fileCount: manifest.fileCount,
      versionsDigest: archiveHash([file.id, 'initial versions']),
      conservationControlsHashes: [controlsHash],
    },
  );
  const effect = {
    disposition: 'ISOLATED' as const,
    evidenceHash: archiveHash([file.id, 'initial isolation']),
  };
  const writers = Object.fromEntries(
    PUT_DESTINATION_WRITER_GROUPS.map((group) => [group, effect]),
  ) as PutDestinationWriters;
  const report = {
    protocol: 'ITEM_STABLE_CUT_ACCREDITATION_V1' as const,
    issuerId: recipientId,
    scopeHash: scope.scopeHash,
    controlsHash,
    writerInventoryHash: archiveHash(writers),
    writers,
    copyEffects: effect,
    retainedVersionsEvidenceHash: archiveHash([
      file.id,
      'initial version evidence',
    ]),
    validFrom: startedAt,
    validUntil,
  };
  const accreditation = buildItemStableCutAccreditationRecord(
    scope,
    report,
    gate.id,
    archiveHash(report),
    endedAt,
  );
  const consumption = buildItemStableCutConsumption(
    accreditation,
    {
      binding: manifest.binding,
      manifestHash: manifest.manifestHash,
      preparedCoverageHash: selection.expectedPreparedCoverageHash,
      projectionHash: selection.expectedProjectionHash,
    },
    endedAt,
  );
  const receipt = buildItemOwnershipCommit(
    definition,
    {
      selection: scope.selection,
      expectedScopeHash: scope.scopeHash,
      expectedAccreditationHash: accreditation.accreditationHash,
    },
    consumption,
    sealFacts.requestVersion + 1,
  );

  return {
    receipt,
    entry,
    file,
    bytes,
    sha256,
    accreditation,
    archive: {
      ...definition,
      definitionHash: observedSeal.definitionHash,
      state: 'COPYING',
      createdAt: startedAt,
      expectedEntryCount: manifest.entryCount,
      expectedFileCount: manifest.fileCount,
      reservation,
      capture: {
        revision: observedSeal.captureRevision,
        phase: 'COMPLETE',
        entryCount: manifest.entryCount,
      },
      manifestDigest: manifest,
      evidenceConsumption: consumption,
      ownershipCommitHash: receipt.commitHash,
    } satisfies OwnershipArchive,
    request: {
      ...request,
      senderName: 'First owner',
      recipientName: 'Second owner',
      reasonCode: AnimalTransferReasonCode.PurchaseSale,
      reasonName: 'Compra / venta',
      createdAt: startedAt,
      bodyHash: archiveHash([transferId, 'initial request']),
      authorizationChallengeId: operationId,
      status: 'ACCEPTED',
      version: receipt.requestVersion,
      acceptanceStart,
      acceptedItemCount: 1,
      decidedAt: acceptanceStart.startedAt,
      decisionOperationId: operationId,
      decisionExpectedVersion: input.expectedVersion,
    } satisfies TransferRequestRecord,
    item: {
      ...item,
      animalName: archiveAnimal.name,
      animalCode: archiveAnimal.code,
      status: 'ACCEPTED',
      captureArchiveId: definition.id,
      captureReservationEpoch: reservation.epoch,
      ownershipCommit: receipt,
    } satisfies TransferRequestItem,
  };
}
