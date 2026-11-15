import { randomUUID } from 'node:crypto';
import {
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  buildPublishedHistoryPutAttempt,
  publishedHistoryCopyIntentDefinition,
} from '../../../src/context/animal-transfer/domain/published-history-copy';
import {
  buildPublishedHistoryFinalIntent,
  buildPublishedHistoryFinalPutAttempt,
} from '../../../src/context/animal-transfer/domain/published-history-final';
import { buildPublishedHistoryFinalPermission } from '../../../src/context/animal-transfer/domain/published-history-final-permission';
import { publishedHistoryFinalPutVersionScope } from '../../../src/context/animal-transfer/domain/published-history-final-reconciliation';
import { buildPublishedHistoryPutPermission } from '../../../src/context/animal-transfer/domain/published-history-put-permission';
import { publishedHistoryPutVersionScope } from '../../../src/context/animal-transfer/domain/published-history-put-reconciliation';
import {
  buildPublishedHistoryStagingIntent,
  buildPublishedHistoryStagingPutAttempt,
} from '../../../src/context/animal-transfer/domain/published-history-staging';
import { buildPublishedHistoryStagingPermission } from '../../../src/context/animal-transfer/domain/published-history-staging-permission';
import { publishedHistoryStagingPutVersionScope } from '../../../src/context/animal-transfer/domain/published-history-staging-reconciliation';
import {
  PUT_DESTINATION_WRITER_GROUPS,
  type PutDestinationWriters,
  protectPublishedHistoryFinalPutDestination,
  protectPublishedHistoryPutDestination,
  protectPublishedHistoryStagingPutDestination,
  publishedHistoryFinalPutDestinationScope,
  publishedHistoryPutDestinationScope,
  publishedHistoryStagingPutDestinationScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import {
  buildPublishedHistoryFinalVersionObservation,
  buildPublishedHistoryPutVersionObservation,
  buildPublishedHistoryStagingVersionObservation,
  type ItemHistoricalPutVersionScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import {
  buildPublishedHistoryFinalPutArtifactSeal,
  buildPublishedHistoryPutArtifactSeal,
  buildPublishedHistoryStagingPutArtifactSeal,
} from '../../../src/context/animal-transfer/domain/transfer-item-staging-put-artifact';

/** Seed a reconciled retained file using the domain builders for every persisted leg. */
export function publishedRetainedCopyChain(
  archive: OwnershipArchive,
  file: ArchiveFile,
  options: {
    publicationHash: string;
    controlsHash: string;
    checkedAt: string;
    requiredThrough: string;
    validUntil: string;
  },
) {
  const { controlsHash, checkedAt, requiredThrough, validUntil } = options;
  const at = Date.parse(checkedAt);
  const evidenceHash = archiveHash('synthetic retained isolation');
  const effect = { disposition: 'ISOLATED' as const, evidenceHash };
  const writers = Object.fromEntries(
    PUT_DESTINATION_WRITER_GROUPS.map((group) => [group, effect]),
  ) as PutDestinationWriters;
  const accreditationFacts = {
    issuerId: archive.recipientId,
    validFrom: checkedAt,
    admitBefore: validUntil,
    conditionalCreationEvidenceHash: evidenceHash,
    deletion: {
      keyDeletion: evidenceHash,
      versionDeletion: evidenceHash,
      deleteMarkers: evidenceHash,
      lifecycle: evidenceHash,
    },
    writerInventoryHash: archiveHash(writers),
    writers,
    continuity: { until: 'RECONCILED_OR_ISOLATED' as const, evidenceHash },
  };
  const versionFacts = (leg: string, scope: ItemHistoricalPutVersionScope) => ({
    issuerId: archive.recipientId,
    scopeHash: archiveHash(scope),
    revision: {
      versionId: `${leg}-version`,
      etag: `"${leg}-etag"`,
      size: scope.size,
    },
    provenanceEvidenceHash: archiveHash([leg, 'provenance']),
    conservationEvidenceHash: archiveHash([leg, 'conservation']),
    conservationControlsHash: controlsHash,
    validFrom: checkedAt,
    validUntil,
  });
  const artifact = (id: string) => ({ id, generation: '1' });

  const copyInput = {
    archiveId: archive.id,
    fileId: file.id,
    expectedFileDefinitionHash: file.definitionHash,
    expectedPublicationHash: options.publicationHash,
    expectedReservationEpoch: archive.reservation!.epoch,
    requiredThrough,
  };
  const historicalIntent = publishedHistoryCopyIntentDefinition(
    copyInput,
    archive,
    file,
  );
  const historicalInput = {
    ...copyInput,
    expectedIntentHash: historicalIntent.definitionHash,
    dispatcherInstanceId: randomUUID(),
  };
  const historicalAttempt = buildPublishedHistoryPutAttempt(
    historicalIntent,
    historicalInput,
    { contentType: 'image/jpeg' },
  );
  const historicalAccreditation = {
    ...accreditationFacts,
    protocol: 'PUBLISHED_HISTORY_PUT_DESTINATION_ACCREDITATION_V1' as const,
    scope: publishedHistoryPutDestinationScope(historicalAttempt, controlsHash),
  };
  const historicalProtection = protectPublishedHistoryPutDestination(
    historicalAttempt,
    controlsHash,
    archiveHash(historicalAccreditation),
    historicalAccreditation,
  );
  const historicalDeclaration = {
    state: 'INTENDED' as const,
    attempt: historicalAttempt,
    accreditation: historicalAccreditation,
    protection: historicalProtection,
  };
  const original = {
    versionObservationHash: archiveHash(
      'synthetic original version observation',
    ),
    conservationControlsHash: controlsHash,
  };
  const historicalArtifact = buildPublishedHistoryPutArtifactSeal(
    historicalAttempt,
    historicalProtection.protectionHash,
    artifact('retained-historical'),
    checkedAt,
    original.versionObservationHash,
    requiredThrough,
  );
  const historicalSelection = {
    ...historicalInput,
    expectedControlsHash: controlsHash,
    expectedAccreditationHash: archiveHash(historicalAccreditation),
    expectedAttemptDefinitionHash: historicalAttempt.definitionHash,
    expectedProtectionHash: historicalProtection.protectionHash,
    expectedArtifactHash: historicalArtifact.artifactHash,
    transportRequestHash: archiveHash(historicalAttempt.request),
  };
  const historicalPermission = buildPublishedHistoryPutPermission(
    historicalSelection,
    historicalDeclaration,
    {
      openedArtifactSeal: historicalArtifact,
      transportRequestHash: historicalSelection.transportRequestHash,
    },
    original,
    checkedAt,
  );
  const historicalContext = {
    definition: historicalAttempt,
    permission: historicalPermission,
  };
  const historicalScope = publishedHistoryPutVersionScope(historicalContext);
  const historicalEvidence = {
    ...versionFacts('historical', historicalScope),
    protocol: 'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const historicalVersion = {
    evidence: historicalEvidence,
    observation: buildPublishedHistoryPutVersionObservation(
      historicalScope,
      historicalEvidence,
      archiveHash(historicalEvidence),
      at,
      requiredThrough,
    ),
  };

  const stagingInput = {
    selection: historicalSelection,
    expectedPermissionHash: historicalPermission.permissionHash,
    expectedVersionObservationHash:
      historicalVersion.observation.observationHash,
    requiredThrough,
  };
  const stagingIntent = buildPublishedHistoryStagingIntent(
    stagingInput,
    historicalIntent,
    file,
    { ...historicalContext, versionRecord: historicalVersion },
  );
  const stagingAttemptInput = {
    ...stagingInput,
    expectedStagingIntentHash: stagingIntent.definitionHash,
    dispatcherInstanceId: randomUUID(),
  };
  const stagingAttempt = buildPublishedHistoryStagingPutAttempt(
    stagingIntent,
    stagingAttemptInput,
    historicalAttempt,
  );
  const stagingAccreditation = {
    ...accreditationFacts,
    protocol:
      'PUBLISHED_HISTORY_STAGING_PUT_DESTINATION_ACCREDITATION_V1' as const,
    scope: publishedHistoryStagingPutDestinationScope(
      stagingAttempt,
      controlsHash,
    ),
  };
  const stagingProtection = protectPublishedHistoryStagingPutDestination(
    stagingAttempt,
    controlsHash,
    archiveHash(stagingAccreditation),
    stagingAccreditation,
  );
  const stagingDeclaration = {
    state: 'INTENDED' as const,
    attempt: stagingAttempt,
    accreditation: stagingAccreditation,
    protection: stagingProtection,
  };
  const stagingArtifact = buildPublishedHistoryStagingPutArtifactSeal(
    stagingAttempt,
    stagingProtection.protectionHash,
    artifact('retained-staging'),
    checkedAt,
  );
  const stagingSelection = {
    ...stagingAttemptInput,
    expectedControlsHash: controlsHash,
    expectedAccreditationHash: archiveHash(stagingAccreditation),
    expectedAttemptDefinitionHash: stagingAttempt.definitionHash,
    expectedProtectionHash: stagingProtection.protectionHash,
    expectedArtifactHash: stagingArtifact.artifactHash,
    transportRequestHash: archiveHash(stagingAttempt.request),
  };
  const stagingPermission = buildPublishedHistoryStagingPermission(
    stagingSelection,
    stagingDeclaration,
    {
      openedArtifactSeal: stagingArtifact,
      transportRequestHash: stagingSelection.transportRequestHash,
    },
    checkedAt,
  );
  const stagingContext = {
    definition: stagingAttempt,
    permission: stagingPermission,
  };
  const stagingScope = publishedHistoryStagingPutVersionScope(stagingContext);
  const stagingEvidence = {
    ...versionFacts('staging', stagingScope),
    protocol: 'PUBLISHED_HISTORY_STAGING_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const stagingVersion = {
    evidence: stagingEvidence,
    observation: buildPublishedHistoryStagingVersionObservation(
      stagingScope,
      stagingEvidence,
      archiveHash(stagingEvidence),
      at,
      requiredThrough,
    ),
  };

  const finalInput = {
    staging: stagingSelection,
    expectedStagingPermissionHash: stagingPermission.permissionHash,
    expectedStagingVersionObservationHash:
      stagingVersion.observation.observationHash,
    requiredThrough,
  };
  const finalIntent = buildPublishedHistoryFinalIntent(
    finalInput,
    { ...file, publishedHistoryStagingIntent: stagingIntent },
    { ...stagingContext, versionRecord: stagingVersion },
  );
  const finalAttemptInput = {
    ...finalInput,
    expectedFinalIntentHash: finalIntent.definitionHash,
    dispatcherInstanceId: randomUUID(),
  };
  const finalAttempt = buildPublishedHistoryFinalPutAttempt(
    finalAttemptInput,
    finalIntent,
    stagingAttempt,
  );
  const finalAccreditation = {
    ...accreditationFacts,
    protocol:
      'PUBLISHED_HISTORY_FINAL_PUT_DESTINATION_ACCREDITATION_V1' as const,
    scope: publishedHistoryFinalPutDestinationScope(finalAttempt, controlsHash),
  };
  const finalProtection = protectPublishedHistoryFinalPutDestination(
    finalAttempt,
    controlsHash,
    archiveHash(finalAccreditation),
    finalAccreditation,
  );
  const finalDeclaration = {
    state: 'INTENDED' as const,
    attempt: finalAttempt,
    accreditation: finalAccreditation,
    protection: finalProtection,
  };
  const finalArtifact = buildPublishedHistoryFinalPutArtifactSeal(
    finalAttempt,
    finalProtection.protectionHash,
    artifact('retained-final'),
    checkedAt,
  );
  const finalSelection = {
    ...finalAttemptInput,
    expectedControlsHash: controlsHash,
    expectedAccreditationHash: archiveHash(finalAccreditation),
    expectedAttemptDefinitionHash: finalAttempt.definitionHash,
    expectedProtectionHash: finalProtection.protectionHash,
    expectedArtifactHash: finalArtifact.artifactHash,
    transportRequestHash: archiveHash(finalAttempt.request),
  };
  const finalPermission = buildPublishedHistoryFinalPermission(
    finalSelection,
    finalDeclaration,
    {
      openedArtifactSeal: finalArtifact,
      transportRequestHash: finalSelection.transportRequestHash,
    },
    checkedAt,
  );
  const finalScope = publishedHistoryFinalPutVersionScope({
    definition: finalAttempt,
    permission: finalPermission,
  });
  const finalEvidence = {
    ...versionFacts('final', finalScope),
    protocol: 'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const finalVersion = {
    evidence: finalEvidence,
    observation: buildPublishedHistoryFinalVersionObservation(
      finalScope,
      finalEvidence,
      archiveHash(finalEvidence),
      at,
      requiredThrough,
    ),
  };

  return {
    ...file,
    publishedHistoryCopyIntent: historicalIntent,
    publishedHistoryPutDeclaration: historicalDeclaration,
    publishedHistoryPutPermission: historicalPermission,
    publishedHistoryPutVersion: historicalVersion,
    publishedHistoryStagingIntent: stagingIntent,
    publishedHistoryStagingPutDeclaration: stagingDeclaration,
    publishedHistoryStagingPutPermission: stagingPermission,
    publishedHistoryStagingPutVersion: stagingVersion,
    publishedHistoryFinalIntent: finalIntent,
    publishedHistoryFinalPutDeclaration: finalDeclaration,
    publishedHistoryFinalPutPermission: finalPermission,
    publishedHistoryFinalPutVersion: finalVersion,
  } satisfies ArchiveFile;
}
