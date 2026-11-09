import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import { sourceHashValid } from './transfer-item-historical-observation';
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
  const facts = { ...references, validFrom, admitBefore };
  if (
    definition.protocol !== 'ITEM_HISTORICAL_PUT_ATTEMPT_V2' ||
    definition.operation !== 'PUT_OBJECT' ||
    request?.ifNoneMatch !== '*' ||
    !Object.values(references).every(sourceHashValid) ||
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
