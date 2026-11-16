import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  buildItemCopyGate,
  newIntendedCopyRecord,
  newItemCopyGate,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-record';
import {
  buildItemHistoricalCopyIntent,
  buildItemHistoricalSourceAnchor,
  type ItemCopyIntentContext,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import { sourceRetentionSelectorHash } from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { buildItemHistoricalPutAttemptV2 } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-attempt';
import {
  historicalPutDestinationScope,
  protectHistoricalPutDestinationFromAccreditation,
  protectRecipientFinalPutDestinationFromAccreditation,
  protectStagingPutDestinationFromAccreditation,
  recipientFinalPutDestinationScope,
  stagingPutDestinationScope,
  type PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import { buildInitialHistoricalPutPermission } from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-permission';
import {
  buildHistoricalPutVersionObservation,
  buildRecipientFinalPutVersionObservation,
  buildStagingFromHistoricalPutVersion,
  buildStagingPutVersionObservation,
  historicalPutVersionScope,
  type ItemHistoricalPutVersionScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import { buildItemRecipientFinalPutAttempt } from '../../../src/context/animal-transfer/domain/transfer-item-recipient-final-put-attempt';
import { buildInitialRecipientFinalPutPermission } from '../../../src/context/animal-transfer/domain/transfer-item-recipient-final-put-permission';
import { buildItemSourceArtifactMetadata } from '../../../src/context/animal-transfer/domain/transfer-item-source-artifact-metadata';
import { buildItemSourceArtifactSeal } from '../../../src/context/animal-transfer/domain/transfer-item-source-artifact';
import {
  buildRecipientFinalPutArtifactSeal,
  buildStagingPutArtifactSeal,
} from '../../../src/context/animal-transfer/domain/transfer-item-staging-put-artifact';
import { buildItemStagingPutAttempt } from '../../../src/context/animal-transfer/domain/transfer-item-staging-put-attempt';
import { buildInitialStagingPutPermission } from '../../../src/context/animal-transfer/domain/transfer-item-staging-put-permission';
import {
  buildFinalFromStagingPutVersion,
  recipientFinalPutVersionScope,
  stagingPutVersionScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-staging-put-reconciliation';

/** A completed synthetic copy chain. The persistence adapter still hydrates and checks every row at cut time. */
export function initialCutReconciledMedia(
  original: ItemCopyIntentContext,
  options: Readonly<{
    manifestHash: string;
    issuerId: string;
    id: (n: number) => string;
    writers: PutDestinationWriters;
    expectedBucketOwner: string;
    checkedAt: string;
    requiredThrough: string;
    validUntil: string;
    contentType?: string;
    conservationControlsHash?: string;
  }>,
) {
  const {
    manifestHash,
    issuerId,
    id,
    writers,
    expectedBucketOwner,
    checkedAt,
    requiredThrough,
    validUntil,
  } = options;
  const at = Date.parse(checkedAt);
  const intent = buildItemHistoricalCopyIntent(original);
  const { fileId } = intent.binding;
  const gate = newItemCopyGate(
    buildItemCopyGate(original.selector, original.snapshot),
  );
  const hash = archiveHash('synthetic independent destination evidence');
  const controlsHash = archiveHash('synthetic destination controls');
  const accreditation = {
    issuerId,
    writers,
    validFrom: checkedAt,
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
  const anchor = {
    binding: intent.binding,
    manifestHash,
    intentId: intent.id,
    intentDefinitionHash: intent.definitionHash,
    sourceObservationHash: original.file.sourceByteObservation!.observationHash,
    source: { bucket: intent.bucket, ...intent.source },
  };
  const selectorHash = sourceRetentionSelectorHash(
    anchor.source,
    expectedBucketOwner,
  );
  const profileFacts = {
    id: id(181),
    revision: 1,
    protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_V1' as const,
    issuerId,
    selectorHash,
    signerContextHash: hash,
    controlsHash,
    validFrom: checkedAt,
    validUntil,
  };
  const profile = {
    ...profileFacts,
    state: 'ACTIVE' as const,
    definitionHash: archiveHash(profileFacts),
  };
  const artifact = buildItemSourceArtifactSeal({
    id: 'historical-artifact',
    generation: '1',
    anchorHash: buildItemHistoricalSourceAnchor(anchor).anchorHash,
    selectorHash,
    profileDefinitionHash: profile.definitionHash,
    profileObservationHash: hash,
    expectedBucketOwner,
    observedAt: checkedAt,
    fixedRetainUntil: validUntil,
    size: intent.source.revision.size,
    sha256: intent.source.sha256,
  });
  const metadata = buildItemSourceArtifactMetadata(artifact, {
    contentType: options.contentType ?? 'image/jpeg',
  });
  const historical = buildItemHistoricalPutAttemptV2(original, {
    attemptId: id(182),
    dispatcherInstanceId: id(183),
    expectedBucketOwner,
    profile,
    anchor,
    artifact,
    metadata,
    expectedMetadataHash: metadata.metadataHash,
  });
  const historicalAccreditation = {
    ...accreditation,
    protocol: 'ITEM_HISTORICAL_PUT_DESTINATION_ACCREDITATION_V1' as const,
    scope: historicalPutDestinationScope(historical, controlsHash),
  };
  const historicalDeclaration = {
    ...newIntendedCopyRecord(historical, gate.id),
    sourceArtifactMetadata: metadata,
    destinationProtection: protectHistoricalPutDestinationFromAccreditation(
      historical,
      controlsHash,
      archiveHash(historicalAccreditation),
      historicalAccreditation,
    ),
  };
  const historicalPermission = buildInitialHistoricalPutPermission(
    gate,
    historicalDeclaration,
    {
      authorizationId: id(184),
      expectedGateRevision: 0,
      transportRequestHash: archiveHash('historical request'),
      openedArtifactSeal: artifact,
      activeProfile: profile,
      accreditation: historicalAccreditation,
      checkedAt: at,
    },
  );
  const historicalContext = {
    definition: historical,
    permission: historicalPermission,
  };
  const versionEvidence = (
    leg: string,
    scope: ItemHistoricalPutVersionScope,
  ) => ({
    issuerId,
    scopeHash: archiveHash(scope),
    revision: {
      versionId: `${leg}-version`,
      etag: `"${leg}-etag"`,
      size: scope.size,
    },
    provenanceEvidenceHash: archiveHash([leg, 'provenance']),
    conservationEvidenceHash: archiveHash([leg, 'retention']),
    conservationControlsHash:
      options.conservationControlsHash ??
      archiveHash([leg, 'conservation controls']),
    validFrom: checkedAt,
    validUntil,
  });
  const historicalScope = historicalPutVersionScope(historicalContext);
  const historicalEvidence = {
    ...versionEvidence('historical', historicalScope),
    protocol: 'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const historicalVersion = {
    evidence: historicalEvidence,
    observation: buildHistoricalPutVersionObservation(
      historicalScope,
      historicalEvidence,
      archiveHash(historicalEvidence),
      at,
      requiredThrough,
    ),
  };
  const historicalRecord = {
    ...historicalContext,
    versionRecord: historicalVersion,
  };
  const historicalSource = {
    attemptId: historical.id,
    attemptDefinitionHash: historical.definitionHash,
    authorizationId: historicalPermission.authorizationId,
    permissionHash: historicalPermission.permissionHash,
    versionObservationHash: historicalVersion.observation.observationHash,
    conservationControlsHash: historicalEvidence.conservationControlsHash,
    requiredThrough,
  };
  const stagingIntent = buildStagingFromHistoricalPutVersion(
    original,
    intent,
    manifestHash,
    historicalRecord,
    historicalSource,
  ).intent;
  const context = {
    ...original,
    file: { ...original.file, stagingCopyIntent: stagingIntent },
  };
  const staging = buildItemStagingPutAttempt(context, historicalRecord, {
    attemptId: id(185),
    dispatcherInstanceId: id(186),
    expectedManifestHash: manifestHash,
    expectedStagingIntentHash: stagingIntent.definitionHash,
  });
  const stagingAccreditation = {
    ...accreditation,
    protocol: 'ITEM_STAGING_PUT_DESTINATION_ACCREDITATION_V1' as const,
    scope: stagingPutDestinationScope(staging, controlsHash),
  };
  const stagingDeclaration = {
    ...newIntendedCopyRecord(staging, gate.id),
    stagingDestinationAccreditation: stagingAccreditation,
    destinationProtection: protectStagingPutDestinationFromAccreditation(
      staging,
      controlsHash,
      archiveHash(stagingAccreditation),
      stagingAccreditation,
    ),
  };
  const stagedArtifact = buildStagingPutArtifactSeal(
    staging,
    stagingDeclaration.destinationProtection.protectionHash,
    {
      id: 'staging-artifact',
      generation: '1',
    },
    checkedAt,
  );
  const stagingPermission = buildInitialStagingPutPermission(
    { ...gate, revision: 1 },
    stagingDeclaration,
    historicalRecord,
    {
      authorizationId: id(187),
      expectedGateRevision: 1,
      transportRequestHash: archiveHash('staging request'),
      expectedArtifactHash: stagedArtifact.artifactHash,
      openedArtifactSeal: stagedArtifact,
      checkedAt: at,
    },
  );
  const stagingContext = { definition: staging, permission: stagingPermission };
  const stagingScope = stagingPutVersionScope(stagingContext);
  const stagingEvidence = {
    ...versionEvidence('staging', stagingScope),
    protocol: 'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const stagedVersion = {
    evidence: stagingEvidence,
    observation: buildStagingPutVersionObservation(
      stagingScope,
      stagingEvidence,
      archiveHash(stagingEvidence),
      at,
      requiredThrough,
    ),
  };
  const stagingRecord = { ...stagingContext, versionRecord: stagedVersion };
  const stagingSource = {
    attemptId: staging.id,
    attemptDefinitionHash: staging.definitionHash,
    authorizationId: stagingPermission.authorizationId,
    permissionHash: stagingPermission.permissionHash,
    versionObservationHash: stagedVersion.observation.observationHash,
    conservationControlsHash: stagingEvidence.conservationControlsHash,
    requiredThrough,
  };
  const finalIntent = buildFinalFromStagingPutVersion(
    context,
    manifestHash,
    stagingRecord,
    stagingSource,
  ).intent;
  const file = { ...context.file, recipientFinalCopyIntent: finalIntent };
  const { definition: final } = buildItemRecipientFinalPutAttempt(
    { ...context, file },
    stagingRecord,
    {
      attemptId: id(188),
      dispatcherInstanceId: id(189),
      expectedManifestHash: manifestHash,
      expectedFinalIntentHash: finalIntent.definitionHash,
      source: stagingSource,
    },
  );
  const finalAccreditation = {
    ...accreditation,
    protocol: 'ITEM_RECIPIENT_FINAL_PUT_DESTINATION_ACCREDITATION_V1' as const,
    scope: recipientFinalPutDestinationScope(final, controlsHash),
  };
  const finalDeclaration = {
    ...newIntendedCopyRecord(final, gate.id),
    finalDestinationAccreditation: finalAccreditation,
    destinationProtection: protectRecipientFinalPutDestinationFromAccreditation(
      final,
      controlsHash,
      archiveHash(finalAccreditation),
      finalAccreditation,
    ),
  };
  const finalArtifact = buildRecipientFinalPutArtifactSeal(
    final,
    finalDeclaration.destinationProtection.protectionHash,
    {
      id: 'final-artifact',
      generation: '1',
    },
    checkedAt,
  );
  const finalPermission = buildInitialRecipientFinalPutPermission(
    { ...gate, revision: 2 },
    finalDeclaration,
    stagingRecord,
    {
      authorizationId: id(190),
      expectedGateRevision: 2,
      transportRequestHash: archiveHash('final request'),
      expectedArtifactHash: finalArtifact.artifactHash,
      openedArtifactSeal: finalArtifact,
      checkedAt: at,
    },
  );
  const finalScope = recipientFinalPutVersionScope({
    definition: final,
    permission: finalPermission,
  });
  const finalEvidence = {
    ...versionEvidence('final', finalScope),
    protocol: 'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1' as const,
  };
  const finalVersion = {
    evidence: finalEvidence,
    observation: buildRecipientFinalPutVersionObservation(
      finalScope,
      finalEvidence,
      archiveHash(finalEvidence),
      at,
      requiredThrough,
    ),
  };
  return {
    file,
    fileId,
    historicalVersion,
    finalVersion,
    rows: [
      { ...gate, revision: 3 },
      {
        ...historicalDeclaration,
        identityIds: [historical.id, historicalPermission.authorizationId],
        permission: historicalPermission,
        versionRecord: historicalVersion,
      },
      {
        ...stagingDeclaration,
        identityIds: [staging.id, stagingPermission.authorizationId],
        permission: stagingPermission,
        versionRecord: stagedVersion,
      },
      {
        ...finalDeclaration,
        identityIds: [final.id, finalPermission.authorizationId],
        permission: finalPermission,
        versionRecord: finalVersion,
      },
    ],
  };
}
