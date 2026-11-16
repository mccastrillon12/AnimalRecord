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

function capturePopulation(value: CensusPopulation) {
  if (
    !sourceHashValid(value?.coverageEvidenceHash) ||
    !Array.isArray(value.members)
  )
    throw invalid();
  const members = Array.from(
    value.members as readonly CensusMember[],
    (member) => {
      if (
        !sourceHashValid(member?.identityHash) ||
        !sourceHashValid(member.evidenceHash)
      )
        throw invalid();
      return {
        identityHash: member.identityHash,
        evidenceHash: member.evidenceHash,
      };
    },
  );
  members.sort((a, b) => {
    if (a.identityHash === b.identityHash) return 0;
    return a.identityHash < b.identityHash ? -1 : 1;
  });
  return { coverageEvidenceHash: value.coverageEvidenceHash, members };
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
    const proof = await this.census.readCensus(scope, controlsHash);
    if (proof === null) return null;
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
            activeDeployments: capturePopulation(proof.activeDeployments),
            retiredDeployments: capturePopulation(proof.retiredDeployments),
          },
        ),
        priorCapabilities: groupCompleteness(binding, 'priorCapabilities', {
          legacyUploadUrls: capturePopulation(proof.legacyUploadUrls),
          priorWritePermissions: capturePopulation(proof.priorWritePermissions),
        }),
      },
    };
  }
}
