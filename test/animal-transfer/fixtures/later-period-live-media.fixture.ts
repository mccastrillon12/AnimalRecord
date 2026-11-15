import { createHash } from 'node:crypto';
import { Animal } from '../../../src/context/animal/domain/animal';
import {
  buildLaterPeriodLiveMediaRecord,
  laterPeriodLiveMediaScope,
} from '../../../src/context/animal-transfer/domain/later-period-live-media';
import {
  buildLaterPeriodLivePutArtifact,
  buildLaterPeriodLivePutAttempt,
  buildLaterPeriodLivePutDeclaration,
  buildLaterPeriodLivePutPermission,
  buildLaterPeriodLivePutRecord,
  laterPeriodLivePutKey,
} from '../../../src/context/animal-transfer/domain/later-period-live-put';
import {
  archiveHash,
  buildArchiveEntry,
  type ArchiveFile,
  type OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  laterPeriodLivePutDestinationScope,
  type PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import { archiveAnimal } from './ownership-archive.fixture';

/** Synthetic profile photo and the persisted copy evidence used at publication. */
export function laterPeriodLiveMediaFixture(
  archive: OwnershipArchive,
  keyFromUrl: (url: string) => string | undefined,
  location: { bucket: string; expectedBucketOwner: string },
  window: { validFrom: string; validUntil: string },
  writers: PutDestinationWriters,
  conservationControlsHash = archiveHash('live history conservation controls'),
) {
  const animal = Animal.fromPrimitives({
    ...archiveAnimal,
    id: archive.animalId,
    ownerId: archive.ownerId,
    code: `AR-${archive.animalId}`,
    isActive: true,
    profilePictureUrl: `https://synthetic.invalid/users/${archive.ownerId}/animals/${archive.animalId}/profile_123.jpeg`,
  }).toPrimitives();
  const { entry, files } = buildArchiveEntry(
    archive,
    { kind: 'ANIMAL', data: animal },
    keyFromUrl,
  );
  const bytes = Buffer.from('photo from the second period');
  const fileDefinition = {
    ...files[0],
    source: {
      versionId: 'live-source',
      etag: 'source-etag',
      size: bytes.length,
    },
  };
  const file = {
    ...fileDefinition,
    definitionHash: archiveHash(fileDefinition),
    state: 'PENDING' as const,
  };
  return {
    animal,
    entry,
    file,
    bytes,
    ...laterPeriodLiveCopyRecords(
      archive,
      file,
      bytes,
      location,
      window,
      writers,
      conservationControlsHash,
    ),
  };
}

export function laterPeriodLiveCopyRecords(
  archive: OwnershipArchive,
  file: ArchiveFile,
  bytes: Buffer,
  location: { bucket: string; expectedBucketOwner: string },
  window: { validFrom: string; validUntil: string },
  writers: PutDestinationWriters,
  conservationControlsHash: string,
) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const scope = laterPeriodLiveMediaScope(archive, file);
  const scopeHash = archiveHash(scope);
  const issuerId = archive.recipientId;
  const source = {
    protocol: 'LATER_PERIOD_LIVE_PUT_SOURCE_V1' as const,
    issuerId,
    scopeHash,
    ...location,
    ...window,
    sha256,
    representation: { contentType: 'image/jpeg' },
    controlsHash: archiveHash('live source controls'),
  };
  const destinationEvidence = archiveHash('live destination protection');
  const destinationControls = archiveHash('live destination controls');
  const [historical, final] = (['HISTORICAL', 'FINAL'] as const).map((leg) => {
    const key = laterPeriodLivePutKey({
      fileId: file.id,
      expectedScopeHash: scopeHash,
      leg,
    });
    const attempt = buildLaterPeriodLivePutAttempt(
      scope,
      key,
      '123e4567-e89b-42d3-a456-426614174997',
      source,
    );
    const declaration = buildLaterPeriodLivePutDeclaration(attempt, source, {
      protocol: 'LATER_PERIOD_LIVE_PUT_DESTINATION_ACCREDITATION_V1',
      issuerId,
      scope: laterPeriodLivePutDestinationScope(attempt, destinationControls),
      validFrom: window.validFrom,
      admitBefore: window.validUntil,
      conditionalCreationEvidenceHash: destinationEvidence,
      deletion: {
        keyDeletion: destinationEvidence,
        versionDeletion: destinationEvidence,
        deleteMarkers: destinationEvidence,
        lifecycle: destinationEvidence,
      },
      writerInventoryHash: archiveHash('live writer inventory'),
      writers,
      continuity: {
        until: 'RECONCILED_OR_ISOLATED',
        evidenceHash: destinationEvidence,
      },
    });
    const artifact = buildLaterPeriodLivePutArtifact(declaration, {
      id: `photo-${leg}`,
      generation: '1',
    });
    const transportRequestHash = archiveHash(attempt.request);
    const permission = buildLaterPeriodLivePutPermission(
      {
        ...key,
        expectedAttemptHash: attempt.definitionHash,
        expectedProtectionHash: declaration.protection.protectionHash,
        expectedArtifactHash: artifact.artifactHash,
        transportRequestHash,
      },
      declaration,
      { artifact, transportRequestHash },
      window.validFrom,
    );
    return {
      put: buildLaterPeriodLivePutRecord(declaration, permission),
      permissionHash: permission.permissionHash,
      version: {
        target: { ...location, key: attempt.request.key },
        revision: {
          versionId: `photo-${leg}`,
          etag: `${leg}-etag`,
          size: bytes.length,
        },
        sha256,
        provenanceEvidenceHash: archiveHash(['live effect', leg]),
        conservationEvidenceHash: archiveHash(['live retention', leg]),
        conservationControlsHash,
      },
    };
  });
  const record = buildLaterPeriodLiveMediaRecord(
    scope,
    {
      protocol: 'LATER_PERIOD_LIVE_MEDIA_EVIDENCE_V1',
      issuerId,
      scopeHash,
      copyEffectsEvidenceHash: archiveHash('live copy effects'),
      copyPermissionHashes: {
        historical: historical.permissionHash,
        final: final.permissionHash,
      },
      historical: historical.version,
      final: final.version,
      ...window,
    },
    window.validFrom,
  );
  const media = {
    id: archiveHash([
      'LATER_PERIOD_LIVE_MEDIA_REFERENCE_V1',
      file.id,
      record.accreditationHash,
    ]),
    fileId: file.id,
    key: scope.finalKey,
    evidenceHash: record.accreditationHash,
    historical: record.liveMediaEvidence.historical,
    final: record.liveMediaEvidence.final,
  };
  return {
    historicalPut: historical.put,
    finalPut: final.put,
    record,
    media,
  };
}
