import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  PUT_DESTINATION_WRITER_GROUPS,
  putDestinationWriterCoverageValid,
  type PutDestinationWriterCoverage,
} from '../domain/transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import {
  ITEM_STABLE_CUT_SCOPE_PROTOCOL,
  LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
  type ItemStableCutScope,
  type LaterPeriodStableCutScope,
  type StableCutWriterCoverage,
} from '../domain/transfer-item-stable-cut-evidence';

export type CutScope = ItemStableCutScope | LaterPeriodStableCutScope;
type VerifiedWriterCoverage = Omit<StableCutWriterCoverage, 'issuerId'>;

export interface StableCutWriterEvidenceReader {
  readVerifiedCoverage(
    scope: CutScope,
    controlsHash: string,
  ): Promise<VerifiedWriterCoverage | null>;
}

const coverageGroups = [
  ...PUT_DESTINATION_WRITER_GROUPS,
  'copyEffects',
] as const;
type CoverageGroup = (typeof coverageGroups)[number];
type CoverageGroups<T> = Readonly<Record<CoverageGroup, T>>;

type ScopeEvidence = Readonly<{
  scopeHash: string;
  controlsHash: string;
  validFrom: string;
  validUntil: string;
}>;

type GroupInventory = Readonly<{
  completenessEvidenceHash: string;
  identityHashes: readonly string[];
}>;

type MemberEvidence = PutDestinationWriterCoverage &
  Readonly<{ identityHash: string }>;

export type StableCutWriterInventory = ScopeEvidence &
  Readonly<{ groups: CoverageGroups<GroupInventory> }>;

export type StableCutWriterFindings = ScopeEvidence &
  Readonly<{
    writerInventoryHash: string;
    groups: CoverageGroups<readonly MemberEvidence[]>;
  }>;

/**
 * Trusted operational source. Each inventory group attests completeness, even when empty.
 * Findings certify remote reconciliation and ongoing control, or effective isolation,
 * throughout their stated window for this scope and inventory.
 */
export interface StableCutOperationalEvidenceSource {
  readInventory(
    scope: CutScope,
    controlsHash: string,
  ): Promise<StableCutWriterInventory | null>;
  readFindings(
    scope: CutScope,
    controlsHash: string,
    writerInventoryHash: string,
  ): Promise<StableCutWriterFindings | null>;
}

const inconsistentEvidence = () =>
  new ConflictError('The stable-cut writer evidence is inconsistent');

export function stableCutScopeBinding(
  scope: CutScope,
  invalid: () => ConflictError,
) {
  if (!scope) throw invalid();
  const { scopeHash, ...facts } = scope;
  if (
    !sourceHashValid(scopeHash) ||
    scopeHash !== archiveHash(facts) ||
    (facts.protocol !== ITEM_STABLE_CUT_SCOPE_PROTOCOL &&
      facts.protocol !== LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL)
  )
    throw invalid();
  const initial = facts.protocol === ITEM_STABLE_CUT_SCOPE_PROTOCOL;
  return {
    scopeHash,
    initial,
    horizon: historicalPutEvidenceTime(
      initial ? facts.selection?.requiredThrough : facts.requiredThrough,
    ),
  };
}

export class StableCutInventoryEvidenceReader implements StableCutWriterEvidenceReader {
  constructor(private readonly source: StableCutOperationalEvidenceSource) {}

  async readVerifiedCoverage(raw: CutScope, controlsHash: string) {
    const scope = structuredClone(raw);
    const { scopeHash, horizon } = stableCutScopeBinding(
      scope,
      inconsistentEvidence,
    );
    if (!sourceHashValid(controlsHash)) throw inconsistentEvidence();

    const inventory = await this.source.readInventory(
      structuredClone(scope),
      controlsHash,
    );
    if (!hasScope(inventory, scopeHash, controlsHash)) return null;
    const inventoryWindow = coverageWindow(inventory, horizon);
    const inventoryGroups = canonicalInventoryGroups(inventory.groups);
    if (!inventoryWindow || !inventoryGroups) return null;

    const writerInventoryHash = archiveHash({
      scopeHash,
      controlsHash,
      ...inventoryWindow,
      groups: inventoryGroups,
    });
    const findings = await this.source.readFindings(
      structuredClone(scope),
      controlsHash,
      writerInventoryHash,
    );
    if (
      !hasScope(findings, scopeHash, controlsHash) ||
      findings.writerInventoryHash !== writerInventoryHash ||
      !hasCoverageGroups(findings.groups)
    )
      return null;
    const findingsWindow = coverageWindow(findings, horizon);
    if (!findingsWindow) return null;

    const coverage = {} as Record<CoverageGroup, PutDestinationWriterCoverage>;
    for (const group of coverageGroups) {
      const members = coveredMembers(
        inventoryGroups[group],
        findings.groups[group],
      );
      if (!members) return null;
      coverage[group] = {
        disposition: members.every(
          ({ disposition }) => disposition === 'ISOLATED',
        )
          ? 'ISOLATED'
          : 'RECONCILED_AND_CONTROLLED',
        evidenceHash: archiveHash({
          writerInventoryHash,
          group,
          ...findingsWindow,
          members,
        }),
      };
    }

    const { copyEffects, ...writers } = coverage;
    return {
      scopeHash,
      controlsHash,
      writerInventoryHash,
      writers,
      copyEffects,
      validFrom: new Date(
        Math.max(inventoryWindow.validFrom, findingsWindow.validFrom),
      ).toISOString(),
      validUntil: new Date(
        Math.min(inventoryWindow.validUntil, findingsWindow.validUntil),
      ).toISOString(),
    } satisfies VerifiedWriterCoverage;
  }
}

function hasScope<T extends ScopeEvidence>(
  evidence: T | null,
  scopeHash: string,
  controlsHash: string,
): evidence is T {
  return (
    evidence?.scopeHash === scopeHash && evidence.controlsHash === controlsHash
  );
}

function coverageWindow(evidence: ScopeEvidence, horizon: number) {
  const validFrom = historicalPutEvidenceTime(evidence.validFrom);
  const validUntil = historicalPutEvidenceTime(evidence.validUntil);
  return validFrom <= horizon && horizon < validUntil
    ? { validFrom, validUntil }
    : null;
}

function hasCoverageGroups(groups: unknown) {
  return (
    groups !== null &&
    typeof groups === 'object' &&
    Object.keys(groups).length === coverageGroups.length &&
    coverageGroups.every((group) =>
      Object.prototype.hasOwnProperty.call(groups, group),
    )
  );
}

function canonicalInventoryGroups(groups: CoverageGroups<GroupInventory>) {
  if (!hasCoverageGroups(groups)) return null;
  const inventory = {} as Record<CoverageGroup, GroupInventory>;
  for (const group of coverageGroups) {
    const entry = groups[group];
    if (
      !sourceHashValid(entry?.completenessEvidenceHash) ||
      !Array.isArray(entry.identityHashes)
    )
      return null;
    const identityHashes = Array.from<unknown>(entry.identityHashes);
    if (
      !identityHashes.every(sourceHashValid) ||
      new Set(identityHashes).size !== identityHashes.length
    )
      return null;
    inventory[group] = {
      completenessEvidenceHash: entry.completenessEvidenceHash,
      identityHashes: identityHashes.sort(),
    };
  }
  return inventory;
}

function coveredMembers(
  inventory: GroupInventory,
  findings: readonly MemberEvidence[],
) {
  if (
    !Array.isArray(findings) ||
    findings.length !== inventory.identityHashes.length
  )
    return null;
  const missing = new Set(inventory.identityHashes);
  const members: MemberEvidence[] = [];
  for (const finding of findings as readonly MemberEvidence[]) {
    if (!finding) return null;
    const { identityHash, disposition, evidenceHash } = finding;
    if (
      !missing.delete(identityHash) ||
      !putDestinationWriterCoverageValid({ disposition, evidenceHash })
    )
      return null;
    members.push({ identityHash, disposition, evidenceHash });
  }
  return members.sort((a, b) => (a.identityHash < b.identityHash ? -1 : 1));
}
