import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { matchLaterPeriodStableCutCopyPermissionIdentities } from '../domain/later-period-stable-cut-copy-evidence';
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
  matchItemStableCutCopyPermissionIdentities,
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

export const STABLE_CUT_COVERAGE_GROUPS = [
  ...PUT_DESTINATION_WRITER_GROUPS,
  'copyEffects',
] as const;
type CoverageGroup = (typeof STABLE_CUT_COVERAGE_GROUPS)[number];
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

const independentlyVerifiedGroups = [
  'applicationDeployments',
  'priorCapabilities',
] as const;
type IndependentlyVerifiedGroup = (typeof independentlyVerifiedGroups)[number];

export type StableCutWriterCompleteness = ScopeEvidence &
  Readonly<{
    groups: Readonly<Record<IndependentlyVerifiedGroup, GroupInventory>>;
  }>;

/** Supplies authenticated censuses, including explicit attestations for empty groups. */
export interface StableCutWriterCompletenessSource {
  readCompleteness(
    scope: CutScope,
    controlsHash: string,
  ): Promise<StableCutWriterCompleteness | null>;
}

type MemberEvidence = PutDestinationWriterCoverage &
  Readonly<{ identityHash: string }>;

export type StableCutWriterInventory = ScopeEvidence &
  Readonly<{
    groups: CoverageGroups<GroupInventory>;
    initialCopyAttempts?: unknown;
    laterCopyEvidence?: unknown;
  }>;

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

export function stableCutWriterInventoryBinding(
  inventory: StableCutWriterInventory,
) {
  const { scopeHash, controlsHash } = inventory;
  const groups = canonicalInventoryGroups(inventory.groups);
  const window = evidenceWindow(inventory);
  if (
    !sourceHashValid(scopeHash) ||
    !sourceHashValid(controlsHash) ||
    !groups ||
    window.validFrom >= window.validUntil
  )
    return null;

  return {
    groups,
    ...window,
    writerInventoryHash: archiveHash({
      scopeHash,
      controlsHash,
      ...window,
      groups,
    }),
  };
}

export class StableCutInventoryEvidenceReader implements StableCutWriterEvidenceReader {
  constructor(
    private readonly source: StableCutOperationalEvidenceSource,
    private readonly completeness?: StableCutWriterCompletenessSource,
  ) {}

  async readVerifiedCoverage(raw: CutScope, controlsHash: string) {
    const evidence = await this.readVerifiedEvidence(raw, controlsHash);
    return evidence?.coverage ?? null;
  }

  async readVerifiedEvidence(raw: CutScope, controlsHash: string) {
    const scope = structuredClone(raw);
    const { scopeHash, horizon } = stableCutScopeBinding(
      scope,
      inconsistentEvidence,
    );
    if (!sourceHashValid(controlsHash)) throw inconsistentEvidence();

    const inventory = structuredClone(
      await this.source.readInventory(structuredClone(scope), controlsHash),
    );
    if (!hasScope(inventory, scopeHash, controlsHash)) return null;
    const inventoryBinding = stableCutWriterInventoryBinding(inventory);
    if (!inventoryBinding || !coversHorizon(inventoryBinding, horizon))
      return null;
    const { writerInventoryHash, groups: inventoryGroups } = inventoryBinding;
    const required =
      scope.protocol === ITEM_STABLE_CUT_SCOPE_PROTOCOL
        ? matchItemStableCutCopyPermissionIdentities(
            scope.copyInventory,
            inventory.initialCopyAttempts === undefined
              ? []
              : inventory.initialCopyAttempts,
          )
        : matchLaterPeriodStableCutCopyPermissionIdentities(
            scope,
            inventory.laterCopyEvidence,
          );
    const declared = new Set(inventoryGroups.copyEffects.identityHashes);
    if (
      !required ||
      required.some((identityHash) => !declared.has(identityHash))
    )
      return null;
    if (this.completeness) {
      const attestation = await this.completeness.readCompleteness(
        structuredClone(scope),
        controlsHash,
      );
      if (!matchesWriterCompleteness(inventory, inventoryBinding, attestation))
        return null;
    }
    const findings = structuredClone(
      await this.source.readFindings(
        structuredClone(scope),
        controlsHash,
        writerInventoryHash,
      ),
    );
    if (
      !hasScope(findings, scopeHash, controlsHash) ||
      findings.writerInventoryHash !== writerInventoryHash ||
      !hasCoverageGroups(findings.groups)
    )
      return null;
    const findingsWindow = evidenceWindow(findings);
    if (!coversHorizon(findingsWindow, horizon)) return null;

    const coverage = {} as Record<CoverageGroup, PutDestinationWriterCoverage>;
    const findingsGroups = {} as Record<
      CoverageGroup,
      readonly MemberEvidence[]
    >;
    for (const group of STABLE_CUT_COVERAGE_GROUPS) {
      const members = coveredMembers(
        inventoryGroups[group],
        findings.groups[group],
      );
      if (!members) return null;
      findingsGroups[group] = members;
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
    const verifiedCoverage = {
      scopeHash,
      controlsHash,
      writerInventoryHash,
      writers,
      copyEffects,
      validFrom: new Date(
        Math.max(inventoryBinding.validFrom, findingsWindow.validFrom),
      ).toISOString(),
      validUntil: new Date(
        Math.min(inventoryBinding.validUntil, findingsWindow.validUntil),
      ).toISOString(),
    } satisfies VerifiedWriterCoverage;
    return {
      coverage: verifiedCoverage,
      inventory: {
        scopeHash,
        controlsHash,
        validFrom: inventory.validFrom,
        validUntil: inventory.validUntil,
        groups: inventoryGroups,
        ...(scope.protocol === ITEM_STABLE_CUT_SCOPE_PROTOCOL
          ? { initialCopyAttempts: inventory.initialCopyAttempts }
          : { laterCopyEvidence: inventory.laterCopyEvidence }),
      } satisfies StableCutWriterInventory,
      findings: {
        scopeHash,
        controlsHash,
        writerInventoryHash,
        validFrom: findings.validFrom,
        validUntil: findings.validUntil,
        groups: findingsGroups,
      } satisfies StableCutWriterFindings,
    };
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

function evidenceWindow(evidence: ScopeEvidence) {
  return {
    validFrom: historicalPutEvidenceTime(evidence.validFrom),
    validUntil: historicalPutEvidenceTime(evidence.validUntil),
  };
}

function coversHorizon(
  { validFrom, validUntil }: ReturnType<typeof evidenceWindow>,
  horizon: number,
) {
  return validFrom <= horizon && horizon < validUntil;
}

function hasCoverageGroups(groups: unknown) {
  return (
    groups !== null &&
    typeof groups === 'object' &&
    Object.keys(groups).length === STABLE_CUT_COVERAGE_GROUPS.length &&
    STABLE_CUT_COVERAGE_GROUPS.every((group) =>
      Object.prototype.hasOwnProperty.call(groups, group),
    )
  );
}

function canonicalInventoryGroups(groups: CoverageGroups<GroupInventory>) {
  if (!hasCoverageGroups(groups)) return null;
  const inventory = {} as Record<CoverageGroup, GroupInventory>;
  for (const group of STABLE_CUT_COVERAGE_GROUPS) {
    const entry = canonicalGroupInventory(groups[group]);
    if (!entry) return null;
    inventory[group] = entry;
  }
  return inventory;
}

function canonicalGroupInventory(value: GroupInventory | undefined) {
  if (
    !sourceHashValid(value?.completenessEvidenceHash) ||
    !Array.isArray(value.identityHashes)
  )
    return null;
  const identityHashes = Array.from<unknown>(value.identityHashes);
  if (
    !identityHashes.every(sourceHashValid) ||
    new Set(identityHashes).size !== identityHashes.length
  )
    return null;
  return {
    completenessEvidenceHash: value.completenessEvidenceHash,
    identityHashes: identityHashes.sort(),
  };
}

function matchesWriterCompleteness(
  inventory: StableCutWriterInventory,
  binding: NonNullable<ReturnType<typeof stableCutWriterInventoryBinding>>,
  attestation: StableCutWriterCompleteness | null,
) {
  if (!hasScope(attestation, inventory.scopeHash, inventory.controlsHash))
    return false;
  const window = evidenceWindow(attestation);
  return (
    window.validFrom <= binding.validFrom &&
    window.validUntil >= binding.validUntil &&
    independentlyVerifiedGroups.every((group) => {
      const verified = canonicalGroupInventory(attestation.groups?.[group]);
      const declared = binding.groups[group];
      return (
        verified !== null &&
        verified.completenessEvidenceHash ===
          declared.completenessEvidenceHash &&
        verified.identityHashes.length === declared.identityHashes.length &&
        verified.identityHashes.every(
          (identity, index) => identity === declared.identityHashes[index],
        )
      );
    })
  );
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
