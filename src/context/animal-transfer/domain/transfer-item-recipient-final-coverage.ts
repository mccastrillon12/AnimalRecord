import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { sourceHashValid } from './transfer-item-historical-observation';
import { historicalPutEvidenceTime } from './transfer-item-historical-put-reconciliation';
import {
  ItemManifestDigestInput,
  ItemManifestDigestResult,
  itemManifestDigestInput,
} from './transfer-item-manifest-digest';

export const ITEM_RECIPIENT_FINAL_COVERAGE_PROTOCOL =
  'ITEM_RECIPIENT_FINAL_COVERAGE_V1' as const;
export const ITEM_RECIPIENT_PREPARED_COVERAGE_PROTOCOL =
  'ITEM_RECIPIENT_PREPARED_COVERAGE_V1' as const;

export type ItemRecipientFinalCoverageInput = ItemManifestDigestInput &
  Readonly<{ expectedManifestHash: string; requiredThrough: string }>;

export type ItemRecipientFinalCoveragePageInput =
  ItemRecipientFinalCoverageInput & Readonly<{ afterId?: string }>;

export type ItemRecipientFinalMediaRegistrationInput =
  ItemRecipientFinalCoverageInput &
    Readonly<{ fileId: string; expectedVersionObservationHash: string }>;

export type ItemRecipientFinalCoverageFile = Readonly<{
  fileId: string;
  fileDefinitionHash: string;
  intentDefinitionHash: string;
  attemptDefinitionHash: string;
  permissionHash: string;
  versionObservationHash: string;
  conservationControlsHash: string;
}>;

export type ItemRecipientFinalCoveragePage = Readonly<{
  manifest: ItemManifestDigestResult;
  rows: readonly ItemRecipientFinalCoverageFile[];
}>;
export type ItemRecipientPreparedCoverageFile = ItemRecipientFinalCoverageFile &
  Readonly<{ registrationDefinitionHash: string }>;
export type ItemRecipientPreparedCoveragePage = Readonly<{
  manifest: ItemManifestDigestResult;
  rows: readonly ItemRecipientPreparedCoverageFile[];
}>;

type ItemRecipientCoverageObservation = Readonly<{
  binding: ItemManifestDigestResult['binding'];
  manifestHash: string;
  fileCount: number;
  filesDigest: string;
  versionsDigest: string;
  requiredThrough: string;
  reservation: 'OBSERVED_ONLY';
  stableCut: 'NOT_ASSESSED';
  retention: 'NOT_ASSESSED';
  copyDispatch: 'NOT_AUTHORIZED';
  businessCommit: 'NOT_AUTHORIZED';
  observationHash: string;
}>;
export type ItemRecipientFinalCoverageObservation =
  ItemRecipientCoverageObservation &
    Readonly<{
      protocol: typeof ITEM_RECIPIENT_FINAL_COVERAGE_PROTOCOL;
      coverage: 'ALL_MANIFEST_FILES_OBSERVED';
    }>;
export type ItemRecipientPreparedCoverageObservation =
  ItemRecipientCoverageObservation &
    Readonly<{
      protocol: typeof ITEM_RECIPIENT_PREPARED_COVERAGE_PROTOCOL;
      coverage: 'ALL_MANIFEST_FILES_PREPARED';
      registrationsDigest: string;
    }>;

export function recipientFinalCoverageInput(
  raw: ItemRecipientFinalCoverageInput,
): ItemRecipientFinalCoverageInput {
  const { expectedManifestHash, requiredThrough, ...selection } = raw ?? {};
  if (!sourceHashValid(expectedManifestHash))
    throw new InvalidArgumentError('Invalid recipient final coverage manifest');
  historicalPutEvidenceTime(requiredThrough);
  return Object.freeze({
    ...itemManifestDigestInput(selection),
    expectedManifestHash,
    requiredThrough,
  });
}

export function recipientFinalCoveragePageInput(
  raw: ItemRecipientFinalCoveragePageInput,
): ItemRecipientFinalCoveragePageInput {
  const { afterId, ...selection } = raw ?? {};
  if (afterId !== undefined && !sourceHashValid(afterId))
    throw new InvalidArgumentError('Invalid recipient final coverage cursor');
  return Object.freeze({ ...recipientFinalCoverageInput(selection), afterId });
}

export function recipientFinalMediaRegistrationInput(
  raw: ItemRecipientFinalMediaRegistrationInput,
): ItemRecipientFinalMediaRegistrationInput {
  const { fileId, expectedVersionObservationHash, ...selection } = raw ?? {};
  if (![fileId, expectedVersionObservationHash].every(sourceHashValid))
    throw new InvalidArgumentError(
      'Invalid recipient final media registration identity',
    );
  return Object.freeze({
    ...recipientFinalCoverageInput(selection),
    fileId,
    expectedVersionObservationHash,
  });
}
