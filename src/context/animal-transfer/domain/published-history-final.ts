import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveGenerationKey } from './ownership-archive-generation';
import { ArchiveFile, archiveHash } from './ownership-archive';
import { publishedHistoryPutRequests } from './published-history-copy';
import {
  PublishedHistoryStagingPermissionInput,
  publishedHistoryStagingPermissionInput,
} from './published-history-staging-permission';
import {
  PublishedHistoryStagingPutVersionContext,
  matchPublishedHistoryStagingPutVersionRecord,
} from './published-history-staging-reconciliation';
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import type {
  PublishedHistoryFinalPutDestinationAccreditation,
  protectPublishedHistoryFinalPutDestination,
} from './transfer-item-historical-put-destination-protection';

const invalid = () =>
  new ConflictError(
    'The published history final copy requires the exact reconciled staging version',
  );

export type PublishedHistoryFinalInput = Readonly<{
  staging: PublishedHistoryStagingPermissionInput;
  expectedStagingPermissionHash: string;
  expectedStagingVersionObservationHash: string;
  requiredThrough: string;
}>;

export function publishedHistoryFinalInput(raw: PublishedHistoryFinalInput) {
  if (
    ![
      raw?.expectedStagingPermissionHash,
      raw?.expectedStagingVersionObservationHash,
    ].every(sourceHashValid)
  )
    throw invalid();
  historicalPutEvidenceTime(raw.requiredThrough);
  return Object.freeze({
    staging: publishedHistoryStagingPermissionInput(raw.staging),
    expectedStagingPermissionHash: raw.expectedStagingPermissionHash,
    expectedStagingVersionObservationHash:
      raw.expectedStagingVersionObservationHash,
    requiredThrough: raw.requiredThrough,
  });
}

export function buildPublishedHistoryFinalIntent(
  input: PublishedHistoryFinalInput,
  file: ArchiveFile,
  original: PublishedHistoryStagingPutVersionContext,
) {
  const { definition, permission, versionRecord } = original;
  const { selection } = input.staging;
  if (
    !versionRecord ||
    file.archiveId !== selection.archiveId ||
    file.id !== selection.fileId ||
    file.definitionHash !== selection.expectedFileDefinitionHash ||
    definition.definitionHash !== input.staging.expectedAttemptDefinitionHash ||
    permission.permissionHash !== input.expectedStagingPermissionHash ||
    !file.publishedHistoryStagingIntent
  )
    throw invalid();
  const version = matchPublishedHistoryStagingPutVersionRecord(
    original,
    versionRecord,
  );
  const { observation } = version;
  const { target, sha256 } = observation.scope;
  const finalKey = archiveGenerationKey(
    file.archiveId,
    file.id,
    file.recipientFinalKey,
  );
  if (
    observation.observationHash !==
      input.expectedStagingVersionObservationHash ||
    historicalPutEvidenceTime(input.requiredThrough) >
      historicalPutEvidenceTime(observation.requiredThrough) ||
    target.key !== file.recipientStagingKey ||
    finalKey === target.key ||
    finalKey === definition.read.key
  )
    throw invalid();

  const protocol = 'PUBLISHED_HISTORY_FINAL_INTENT_V1' as const;
  const facts = {
    protocol,
    id: archiveHash([protocol, definition.intentDefinitionHash]),
    archiveId: file.archiveId,
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    reservationEpoch: selection.expectedReservationEpoch,
    reservationBindingHash:
      file.publishedHistoryStagingIntent.reservationBindingHash,
    predecessor: Object.freeze({
      attemptDefinitionHash: definition.definitionHash,
      authorizationId: permission.authorizationId,
      permissionHash: permission.permissionHash,
      versionObservationHash: observation.observationHash,
      conservationControlsHash: version.evidence.conservationControlsHash,
      requiredThrough: input.requiredThrough,
    }),
    source: Object.freeze({
      ...target,
      revision: observation.revision,
      sha256,
    }),
    destination: Object.freeze({
      ...target,
      key: finalKey,
      ifNoneMatch: '*' as const,
    }),
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type PublishedHistoryFinalIntent = ReturnType<
  typeof buildPublishedHistoryFinalIntent
>;

export type PublishedHistoryFinalAttemptInput = PublishedHistoryFinalInput &
  Readonly<{ expectedFinalIntentHash: string; dispatcherInstanceId: string }>;

export function publishedHistoryFinalAttemptInput(
  raw: PublishedHistoryFinalAttemptInput,
) {
  if (
    !sourceHashValid(raw?.expectedFinalIntentHash) ||
    !profileIdValid(raw?.dispatcherInstanceId)
  )
    throw invalid();
  return Object.freeze({
    ...publishedHistoryFinalInput(raw),
    expectedFinalIntentHash: raw.expectedFinalIntentHash,
    dispatcherInstanceId: raw.dispatcherInstanceId,
  });
}

export function buildPublishedHistoryFinalPutAttempt(
  input: PublishedHistoryFinalAttemptInput,
  intent: PublishedHistoryFinalIntent,
  staging: PublishedHistoryStagingPutVersionContext['definition'],
) {
  const { definitionHash, ...factsToVerify } = intent;
  if (
    intent.protocol !== 'PUBLISHED_HISTORY_FINAL_INTENT_V1' ||
    definitionHash !== input.expectedFinalIntentHash ||
    archiveHash(factsToVerify) !== definitionHash ||
    intent.predecessor.attemptDefinitionHash !== staging.definitionHash ||
    input.dispatcherInstanceId === staging.dispatcherInstanceId ||
    input.dispatcherInstanceId === input.staging.selection.dispatcherInstanceId
  )
    throw invalid();
  const protocol = 'PUBLISHED_HISTORY_FINAL_PUT_ATTEMPT_V1' as const;
  const facts = {
    protocol,
    id: archiveHash([protocol, intent.definitionHash, 1]),
    ordinal: 1 as const,
    operation: 'PUT_OBJECT' as const,
    intentDefinitionHash: intent.definitionHash,
    dispatcherInstanceId: input.dispatcherInstanceId,
    predecessor: intent.predecessor,
    ...publishedHistoryPutRequests(
      intent.source,
      intent.destination,
      staging.request,
    ),
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type PublishedHistoryFinalPutAttempt = ReturnType<
  typeof buildPublishedHistoryFinalPutAttempt
>;
export type PublishedHistoryFinalDeclarationInput =
  PublishedHistoryFinalAttemptInput &
    Readonly<{
      expectedControlsHash: string;
      expectedAccreditationHash: string;
    }>;
export type PublishedHistoryFinalPutDeclaration = Readonly<{
  state: 'INTENDED';
  attempt: PublishedHistoryFinalPutAttempt;
  accreditation: PublishedHistoryFinalPutDestinationAccreditation;
  protection: ReturnType<typeof protectPublishedHistoryFinalPutDestination>;
}>;
