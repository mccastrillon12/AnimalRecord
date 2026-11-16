import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import {
  stableCutScopeBinding,
  type CutScope,
  type StableCutWriterCompleteness,
  type StableCutWriterCompletenessSource,
} from './stable-cut-writer-evidence';

type CensusMember = Readonly<{ identityHash: string; evidenceHash: string }>;
type CensusPopulation = Readonly<{
  coverageEvidenceHash: string;
  members: readonly CensusMember[];
}>;

export type StableCutWriterCensus = Readonly<{
  scopeHash: string;
  controlsHash: string;
  validFrom: string;
  validUntil: string;
  activeDeployments: CensusPopulation;
  retiredDeployments: CensusPopulation;
  legacyUploadUrls: CensusPopulation;
  priorWritePermissions: CensusPopulation;
}>;

/** Trusted authority. All four censuses must cover the same scope and window, including empty populations. */
export interface StableCutWriterCensusReader {
  readCensus(
    scope: CutScope,
    controlsHash: string,
  ): Promise<StableCutWriterCensus | null>;
}

const invalid = () =>
  new ConflictError('The stable-cut writer census is inconsistent');

function exactFields(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  );
}

function capturePopulation(value: unknown): CensusPopulation {
  if (
    !exactFields(value, ['coverageEvidenceHash', 'members']) ||
    !sourceHashValid(value.coverageEvidenceHash) ||
    !Array.isArray(value.members)
  )
    throw invalid();
  const members = Array.from(value.members as readonly unknown[], (member) => {
    if (
      !exactFields(member, ['identityHash', 'evidenceHash']) ||
      !sourceHashValid(member.identityHash) ||
      !sourceHashValid(member.evidenceHash)
    )
      throw invalid();
    return {
      identityHash: member.identityHash,
      evidenceHash: member.evidenceHash,
    };
  });
  members.sort((a, b) => {
    if (a.identityHash === b.identityHash) return 0;
    return a.identityHash < b.identityHash ? -1 : 1;
  });
  return { coverageEvidenceHash: value.coverageEvidenceHash, members };
}

/** Captures a census in canonical order without accepting unaccounted fields. */
export function captureStableCutWriterCensus(
  value: unknown,
): StableCutWriterCensus {
  if (
    !exactFields(value, [
      'scopeHash',
      'controlsHash',
      'validFrom',
      'validUntil',
      'activeDeployments',
      'retiredDeployments',
      'legacyUploadUrls',
      'priorWritePermissions',
    ])
  )
    throw invalid();
  const { scopeHash, controlsHash, validFrom, validUntil } = value;
  if (
    !sourceHashValid(scopeHash) ||
    !sourceHashValid(controlsHash) ||
    typeof validFrom !== 'string' ||
    typeof validUntil !== 'string' ||
    historicalPutEvidenceTime(validFrom) >=
      historicalPutEvidenceTime(validUntil)
  )
    throw invalid();
  return {
    scopeHash,
    controlsHash,
    validFrom,
    validUntil,
    activeDeployments: capturePopulation(value.activeDeployments),
    retiredDeployments: capturePopulation(value.retiredDeployments),
    legacyUploadUrls: capturePopulation(value.legacyUploadUrls),
    priorWritePermissions: capturePopulation(value.priorWritePermissions),
  };
}

function groupCompleteness(
  binding: Pick<
    StableCutWriterCensus,
    'scopeHash' | 'controlsHash' | 'validFrom' | 'validUntil'
  >,
  group: keyof StableCutWriterCompleteness['groups'],
  populations: Readonly<Record<string, CensusPopulation>>,
) {
  const identityHashes = Object.values(populations)
    .flatMap(({ members }) => members.map(({ identityHash }) => identityHash))
    .sort();
  if (new Set(identityHashes).size !== identityHashes.length) throw invalid();
  return {
    identityHashes,
    completenessEvidenceHash: archiveHash({
      protocol: 'STABLE_CUT_WRITER_CENSUS_V1',
      ...binding,
      group,
      populations,
    }),
  };
}

/** Projects the authority's enumerated populations into the existing signed completeness contract. */
export class StableCutWriterCensusCompleteness implements StableCutWriterCompletenessSource {
  constructor(private readonly census: StableCutWriterCensusReader) {}

  async readCompleteness(
    raw: CutScope,
    controlsHash: string,
  ): Promise<StableCutWriterCompleteness | null> {
    const scope = structuredClone(raw);
    const { scopeHash, horizon } = stableCutScopeBinding(scope, invalid);
    if (!sourceHashValid(controlsHash)) throw invalid();
    const observed = await this.census.readCensus(scope, controlsHash);
    if (observed === null) return null;
    const proof = captureStableCutWriterCensus(observed);
    const { validFrom, validUntil } = proof;
    if (
      proof.scopeHash !== scopeHash ||
      proof.controlsHash !== controlsHash ||
      historicalPutEvidenceTime(validFrom) > horizon ||
      historicalPutEvidenceTime(validUntil) <= horizon
    )
      throw invalid();

    const binding = { scopeHash, controlsHash, validFrom, validUntil };
    return {
      ...binding,
      groups: {
        applicationDeployments: groupCompleteness(
          binding,
          'applicationDeployments',
          {
            activeDeployments: proof.activeDeployments,
            retiredDeployments: proof.retiredDeployments,
          },
        ),
        priorCapabilities: groupCompleteness(binding, 'priorCapabilities', {
          legacyUploadUrls: proof.legacyUploadUrls,
          priorWritePermissions: proof.priorWritePermissions,
        }),
      },
    };
  }
}
