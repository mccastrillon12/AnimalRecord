import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  profileIdValid,
  sourceHashValid,
} from './transfer-item-historical-observation';
import type { ItemHistoricalPutAttemptV2 } from './transfer-item-historical-put-attempt';

/** References supplied by an internal producer for this exact effect. */
export type ItemHistoricalPutDestinationProtectionFacts = Readonly<{
  attemptDefinitionHash: string;
  requestHash: string;
  controlsHash: string;
  conditionalCreationEvidenceHash: string;
  deletionAndRecreationEvidenceHash: string;
  writerCoverageEvidenceHash: string;
  controlsContinuityEvidenceHash: string;
  accreditationHash?: string;
  validFrom: string;
  admitBefore: string;
}>;

const invalid = () =>
  new ConflictError(
    'The historical PUT destination protection evidence is inconsistent',
  );

function canonicalMillis(value: string) {
  if (typeof value !== 'string') return NaN;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value
    ? millis
    : NaN;
}

/** Binds producer references to a revalidated PUT V2. It does not attest provider state. */
export function buildItemHistoricalPutDestinationProtection(
  attempt: ItemHistoricalPutAttemptV2,
  raw: ItemHistoricalPutDestinationProtectionFacts,
) {
  if (!attempt || !raw) throw invalid();
  const { definitionHash, ...definition } = attempt;
  const { request } = definition;
  const {
    attemptDefinitionHash,
    requestHash,
    controlsHash,
    conditionalCreationEvidenceHash,
    deletionAndRecreationEvidenceHash,
    writerCoverageEvidenceHash,
    controlsContinuityEvidenceHash,
    accreditationHash,
    validFrom,
    admitBefore,
  } = raw;
  const references = {
    attemptDefinitionHash,
    requestHash,
    controlsHash,
    conditionalCreationEvidenceHash,
    deletionAndRecreationEvidenceHash,
    writerCoverageEvidenceHash,
    controlsContinuityEvidenceHash,
  };
  const facts = {
    ...references,
    ...(accreditationHash === undefined ? {} : { accreditationHash }),
    validFrom,
    admitBefore,
  };
  if (
    definition.protocol !== 'ITEM_HISTORICAL_PUT_ATTEMPT_V2' ||
    definition.operation !== 'PUT_OBJECT' ||
    request?.ifNoneMatch !== '*' ||
    !Object.values(references).every(sourceHashValid) ||
    (accreditationHash !== undefined && !sourceHashValid(accreditationHash)) ||
    definitionHash !== attemptDefinitionHash ||
    archiveHash(definition) !== definitionHash ||
    archiveHash(request) !== requestHash ||
    !(canonicalMillis(validFrom) < canonicalMillis(admitBefore)) ||
    !isDeepStrictEqual(raw, facts)
  )
    throw invalid();

  const evidence = {
    protocol: 'ITEM_HISTORICAL_PUT_DESTINATION_PROTECTION_V1' as const,
    ...facts,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  };
  return Object.freeze({ ...evidence, protectionHash: archiveHash(evidence) });
}

export type ItemHistoricalPutDestinationProtection = ReturnType<
  typeof buildItemHistoricalPutDestinationProtection
>;

export function matchItemHistoricalPutDestinationProtection(
  attempt: ItemHistoricalPutAttemptV2,
  raw: ItemHistoricalPutDestinationProtection,
  expectedProtectionHash: string,
) {
  if (!raw) throw invalid();
  const { protocol, protectionHash, copyDispatch, businessCommit, ...facts } =
    raw;
  const expected = buildItemHistoricalPutDestinationProtection(attempt, facts);
  if (
    protectionHash !== expectedProtectionHash ||
    expected.protectionHash !== protectionHash ||
    protocol !== expected.protocol ||
    copyDispatch !== expected.copyDispatch ||
    businessCommit !== expected.businessCommit
  )
    throw invalid();
  return expected;
}

const deletionRoutes = [
  'keyDeletion',
  'versionDeletion',
  'deleteMarkers',
  'lifecycle',
] as const;
const writerGroups = [
  'applicationDeployments',
  'externalSystems',
  'priorCapabilities',
  'multipartUploads',
  'replication',
  'administrative',
] as const;

export function historicalPutDestinationScope(
  attempt: ItemHistoricalPutAttemptV2,
  controlsHash: string,
) {
  if (
    attempt?.protocol !== 'ITEM_HISTORICAL_PUT_ATTEMPT_V2' ||
    attempt.request?.ifNoneMatch !== '*' ||
    !sourceHashValid(controlsHash)
  )
    throw invalid();
  const { bucket, key, expectedBucketOwner } = attempt.request;
  return Object.freeze({
    bucket,
    key,
    expectedBucketOwner,
    attemptDefinitionHash: attempt.definitionHash,
    requestHash: archiveHash(attempt.request),
    controlsHash,
  });
}

export type ItemHistoricalPutDestinationScope = ReturnType<
  typeof historicalPutDestinationScope
>;

type WriterCoverage = Readonly<{
  disposition: 'RECONCILED_AND_CONTROLLED' | 'ISOLATED';
  evidenceHash: string;
}>;

export type ItemHistoricalPutDestinationAccreditation = Readonly<{
  protocol: 'ITEM_HISTORICAL_PUT_DESTINATION_ACCREDITATION_V1';
  issuerId: string;
  scope: ItemHistoricalPutDestinationScope;
  validFrom: string;
  admitBefore: string;
  conditionalCreationEvidenceHash: string;
  deletion: Readonly<Record<(typeof deletionRoutes)[number], string>>;
  writerInventoryHash: string;
  writers: Readonly<Record<(typeof writerGroups)[number], WriterCoverage>>;
  continuity: Readonly<{
    until: 'RECONCILED_OR_ISOLATED';
    evidenceHash: string;
  }>;
}>;

/** Explicitly composed trusted source for independently verified evidence. */
export interface ItemHistoricalPutDestinationAccreditationReader {
  readDestinationAccreditation(
    scope: ItemHistoricalPutDestinationScope,
    expectedAccreditationHash: string,
  ): Promise<ItemHistoricalPutDestinationAccreditation | null>;
}

function exactFields(value: unknown, fields: readonly string[]) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) =>
      Object.prototype.propertyIsEnumerable.call(value, field),
    )
  );
}

/** Projects a trusted report into the existing protection record. */
export function protectHistoricalPutDestinationFromAccreditation(
  attempt: ItemHistoricalPutAttemptV2,
  controlsHash: string,
  expectedAccreditationHash: string,
  raw: ItemHistoricalPutDestinationAccreditation,
) {
  const scope = historicalPutDestinationScope(attempt, controlsHash);
  if (
    !exactFields(raw, [
      'protocol',
      'issuerId',
      'scope',
      'validFrom',
      'admitBefore',
      'conditionalCreationEvidenceHash',
      'deletion',
      'writerInventoryHash',
      'writers',
      'continuity',
    ]) ||
    raw.protocol !== 'ITEM_HISTORICAL_PUT_DESTINATION_ACCREDITATION_V1' ||
    !profileIdValid(raw.issuerId) ||
    !isDeepStrictEqual(raw.scope, scope) ||
    !sourceHashValid(raw.conditionalCreationEvidenceHash) ||
    !exactFields(raw.deletion, deletionRoutes) ||
    !deletionRoutes.every((route) => sourceHashValid(raw.deletion[route])) ||
    !sourceHashValid(raw.writerInventoryHash) ||
    !exactFields(raw.writers, writerGroups) ||
    !writerGroups.every((group) => {
      const coverage = raw.writers[group];
      return (
        exactFields(coverage, ['disposition', 'evidenceHash']) &&
        (coverage.disposition === 'RECONCILED_AND_CONTROLLED' ||
          coverage.disposition === 'ISOLATED') &&
        sourceHashValid(coverage.evidenceHash)
      );
    }) ||
    !exactFields(raw.continuity, ['until', 'evidenceHash']) ||
    raw.continuity.until !== 'RECONCILED_OR_ISOLATED' ||
    !sourceHashValid(raw.continuity.evidenceHash) ||
    !(canonicalMillis(raw.validFrom) < canonicalMillis(raw.admitBefore)) ||
    !sourceHashValid(expectedAccreditationHash) ||
    archiveHash(raw) !== expectedAccreditationHash
  )
    throw invalid();

  return buildItemHistoricalPutDestinationProtection(attempt, {
    attemptDefinitionHash: scope.attemptDefinitionHash,
    requestHash: scope.requestHash,
    controlsHash,
    conditionalCreationEvidenceHash: raw.conditionalCreationEvidenceHash,
    deletionAndRecreationEvidenceHash: archiveHash(raw.deletion),
    writerCoverageEvidenceHash: archiveHash({
      inventoryHash: raw.writerInventoryHash,
      writers: raw.writers,
    }),
    controlsContinuityEvidenceHash: raw.continuity.evidenceHash,
    accreditationHash: expectedAccreditationHash,
    validFrom: raw.validFrom,
    admitBefore: raw.admitBefore,
  });
}

/** Expected protection comes from the trusted report for the pinned controls. */
export function evaluateHistoricalPutDestinationAdmission(
  stored: ItemHistoricalPutDestinationProtection,
  expected: ItemHistoricalPutDestinationProtection,
  checkedAt: number,
) {
  const {
    accreditationHash,
    protectionHash,
    controlsHash,
    validFrom,
    admitBefore,
  } = expected;
  if (
    !sourceHashValid(accreditationHash) ||
    !isDeepStrictEqual(stored, expected)
  )
    throw invalid();
  if (
    !Number.isSafeInteger(checkedAt) ||
    !(
      canonicalMillis(validFrom) <= checkedAt &&
      checkedAt < canonicalMillis(admitBefore)
    )
  )
    throw new ConflictError(
      'The historical PUT destination is outside its admission window',
    );
  return Object.freeze({
    assessment: 'ADMISSION_WINDOW_FITS' as const,
    accreditationHash,
    protectionHash,
    controlsHash,
    checkedAt: new Date(checkedAt).toISOString(),
    validFrom,
    admitBefore,
    reservation: 'OBSERVED_ONLY' as const,
    copyDispatch: 'NOT_AUTHORIZED' as const,
    businessCommit: 'NOT_AUTHORIZED' as const,
  });
}
