import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import {
  sourceHashValid,
  profileIdValid,
} from './transfer-item-historical-observation';
import {
  historicalPutEvidenceTime,
  type ItemHistoricalPutVersionRecord,
} from './transfer-item-historical-put-reconciliation';
import type { PublishedHistoryFileInput } from './published-ownership-history';

const protocol = 'PUBLISHED_HISTORY_CONSERVATION_V1';
const invalid = () =>
  new ConflictError(
    'The published history conservation evidence is inconsistent',
  );

export function publishedHistoryConservationScope(
  input: PublishedHistoryFileInput,
  archiveId: string,
  fileDefinitionHash: string,
  original: ItemHistoricalPutVersionRecord,
) {
  const { observation } = original;
  const facts = {
    protocol,
    periodId: input.periodId,
    publicationHash: input.publicationHash,
    archiveId,
    fileId: input.fileId,
    fileDefinitionHash,
    originalObservationHash: observation.observationHash,
    originalRequiredThrough: observation.requiredThrough,
    target: observation.scope.target,
    revision: observation.revision,
    sha256: observation.scope.sha256,
  };
  return Object.freeze({ ...facts, scopeHash: archiveHash(facts) });
}

export type PublishedHistoryConservationScope = ReturnType<
  typeof publishedHistoryConservationScope
>;
export type PublishedHistoryConservationEvidence = Readonly<{
  protocol: typeof protocol;
  scopeHash: string;
  issuerId: string;
  controlsHash: string;
  conservationEvidenceHash: string;
  validFrom: string;
  validUntil: string;
}>;

export function publishedHistoryConservationId(
  scope: PublishedHistoryConservationScope,
) {
  return archiveHash([protocol, scope.publicationHash, scope.fileId]);
}

export function buildPublishedHistoryConservation(
  scope: PublishedHistoryConservationScope,
  gateId: string,
  evidence: PublishedHistoryConservationEvidence,
  expectedEvidenceHash: string,
  recordedAt: string,
) {
  if (
    !evidence ||
    Object.keys(evidence).sort().join(',') !==
      'conservationEvidenceHash,controlsHash,issuerId,protocol,scopeHash,validFrom,validUntil' ||
    evidence.protocol !== protocol ||
    evidence.scopeHash !== scope.scopeHash ||
    !profileIdValid(evidence.issuerId) ||
    ![
      evidence.controlsHash,
      evidence.conservationEvidenceHash,
      expectedEvidenceHash,
    ].every(sourceHashValid) ||
    archiveHash(evidence) !== expectedEvidenceHash ||
    historicalPutEvidenceTime(evidence.validUntil) <=
      historicalPutEvidenceTime(scope.originalRequiredThrough)
  )
    throw invalid();
  assertPublishedHistoryConservationWindow(
    evidence,
    recordedAt,
    historicalPutEvidenceTime(recordedAt),
  );
  const id = publishedHistoryConservationId(scope);
  const facts = {
    protocol: 'ITEM_COPY_RECORDS_V1' as const,
    row: 'PUBLISHED_HISTORY_CONSERVATION' as const,
    state: 'RECORDED' as const,
    id,
    gateId,
    identityIds: Object.freeze([id]),
    historyConservation: Object.freeze({
      evidence: Object.freeze({ ...evidence }),
      evidenceHash: expectedEvidenceHash,
    }),
    recordedAt,
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type PublishedHistoryConservationRecord = ReturnType<
  typeof buildPublishedHistoryConservation
>;

export function assertPublishedHistoryConservationWindow(
  evidence: PublishedHistoryConservationEvidence,
  requiredThrough: string,
  now: number,
) {
  if (
    !(
      historicalPutEvidenceTime(evidence.validFrom) <= now &&
      now <= historicalPutEvidenceTime(requiredThrough) &&
      historicalPutEvidenceTime(requiredThrough) <
        historicalPutEvidenceTime(evidence.validUntil)
    )
  )
    throw new ConflictError(
      'The renewed historical conservation does not cover the requested horizon',
    );
}
