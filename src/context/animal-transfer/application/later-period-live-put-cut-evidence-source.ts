import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { assertSameLaterPeriodLiveCopies } from '../domain/later-period-live-media';
import {
  matchLaterPeriodStableCutCopyPermissionIdentities,
  type LaterPeriodStableCutCopyEvidence,
} from '../domain/later-period-stable-cut-copy-evidence';
import { archiveHash } from '../domain/ownership-archive';
import {
  itemCaptureInput,
  type ItemCaptureInput,
} from '../domain/transfer-item-capture';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import type { LaterPeriodStableCutScope } from '../domain/transfer-item-stable-cut-evidence';
import type {
  LaterPeriodLiveMediaEvidenceProducer,
  LaterPeriodLiveMediaStore,
} from './later-period-live-media-reconciler';
import {
  stableCutScopeBinding,
  type CutScope,
  type StableCutOperationalEvidenceSource,
  type StableCutWriterFindings,
} from './stable-cut-writer-evidence';

type Selection = Readonly<{
  item: ItemCaptureInput;
  scope: LaterPeriodStableCutScope;
  laterCopyEvidence: LaterPeriodStableCutCopyEvidence;
}>;

/** The authority covers the full inventory and all findings except the selected live PUTs. */
type EvidenceAuthority = Pick<
  StableCutOperationalEvidenceSource,
  'readInventory'
> & {
  readOtherFindings(
    scope: LaterPeriodStableCutScope,
    controlsHash: string,
    writerInventoryHash: string,
    livePermissionHashes: readonly string[],
  ): Promise<StableCutWriterFindings | null>;
};

const invalid = () =>
  new ConflictError(
    'The live PUT findings do not match the selected stable cut',
  );

/** Rechecks the original live copy effects without invoking registration or dispatch. */
export class LaterPeriodLivePutCutEvidenceSource implements StableCutOperationalEvidenceSource {
  private readonly selection: Selection;
  private readonly livePermissionHashes: readonly string[];
  private readonly horizon: number;

  constructor(
    raw: Selection,
    private readonly authority: EvidenceAuthority,
    private readonly live: Pick<
      LaterPeriodLiveMediaStore,
      'observe' | 'readCopyEffects'
    >,
    private readonly producer: LaterPeriodLiveMediaEvidenceProducer,
  ) {
    const { item, scope, laterCopyEvidence } = structuredClone(raw);
    const { initial, horizon } = stableCutScopeBinding(scope, invalid);
    if (
      initial ||
      !laterCopyEvidence ||
      !matchLaterPeriodStableCutCopyPermissionIdentities(
        scope,
        laterCopyEvidence,
      )
    )
      throw invalid();
    this.horizon = horizon;
    this.selection = {
      item: itemCaptureInput(item),
      scope,
      laterCopyEvidence,
    };
    this.livePermissionHashes = Object.freeze(
      laterCopyEvidence.liveMedia.flatMap(({ evidence }) => {
        const permissions = evidence.copyPermissionHashes;
        if (!permissions) throw invalid();
        return [permissions.historical, permissions.final];
      }),
    );
  }

  async readInventory(scope: CutScope, controlsHash: string) {
    if (!this.matchesScope(scope, controlsHash)) return null;
    const inventory = await this.authority.readInventory(
      structuredClone(this.selection.scope),
      controlsHash,
    );
    return (
      inventory && {
        ...inventory,
        laterCopyEvidence: structuredClone(this.selection.laterCopyEvidence),
      }
    );
  }

  async readFindings(
    scope: CutScope,
    controlsHash: string,
    writerInventoryHash: string,
  ) {
    if (
      !this.matchesScope(scope, controlsHash) ||
      !sourceHashValid(writerInventoryHash)
    )
      return null;
    const selected = this.selection;
    const other = structuredClone(
      await this.authority.readOtherFindings(
        structuredClone(selected.scope),
        controlsHash,
        writerInventoryHash,
        this.livePermissionHashes,
      ),
    );
    if (
      !other ||
      other.scopeHash !== scope.scopeHash ||
      other.controlsHash !== controlsHash ||
      other.writerInventoryHash !== writerInventoryHash
    )
      return null;

    let validFrom = historicalPutEvidenceTime(other.validFrom);
    let validUntil = historicalPutEvidenceTime(other.validUntil);
    if (validFrom > this.horizon || validUntil <= this.horizon) return null;

    const liveIds = new Set(this.livePermissionHashes);
    const findings = [...other.groups.copyEffects];
    if (findings.some(({ identityHash }) => liveIds.has(identityHash)))
      throw invalid();
    for (const { fileId, evidence } of selected.laterCopyEvidence.liveMedia) {
      const evidenceHash = archiveHash(evidence);
      const current = await this.live.observe(selected.item, fileId);
      if (
        current.scopeHash !== evidence.scopeHash ||
        current.scope.archiveId !== selected.scope.archiveId ||
        current.scope.fileId !== fileId ||
        archiveHash(current.scope) !== current.scopeHash ||
        current.currentEvidenceHash !== evidenceHash
      )
        throw invalid();

      const effects = await this.live.readCopyEffects(
        selected.item,
        fileId,
        current.scopeHash,
      );
      if (
        effects.historical.permissionHash !==
          evidence.copyPermissionHashes?.historical ||
        effects.final.permissionHash !== evidence.copyPermissionHashes?.final
      )
        throw invalid();

      const observed = await this.producer.produce(
        current.scope,
        effects,
        selected.scope.requiredThrough,
      );
      assertSameLaterPeriodLiveCopies(evidence, observed);
      const recordedFrom = historicalPutEvidenceTime(evidence.validFrom);
      const recordedUntil = historicalPutEvidenceTime(evidence.validUntil);
      if (
        observed.scopeHash !== current.scopeHash ||
        historicalPutEvidenceTime(observed.validFrom) > recordedFrom ||
        historicalPutEvidenceTime(observed.validUntil) < recordedUntil ||
        observed.historical.conservationControlsHash !==
          evidence.historical.conservationControlsHash ||
        observed.final.conservationControlsHash !==
          evidence.final.conservationControlsHash
      )
        throw invalid();

      validFrom = Math.max(validFrom, recordedFrom);
      validUntil = Math.min(validUntil, recordedUntil);
      for (const { permissionHash } of [effects.historical, effects.final]) {
        findings.push({
          identityHash: permissionHash,
          disposition: 'RECONCILED_AND_CONTROLLED',
          evidenceHash: archiveHash({
            scopeHash: scope.scopeHash,
            controlsHash,
            writerInventoryHash,
            permissionHash,
            evidenceHash,
          }),
        });
      }
    }
    if (validFrom > this.horizon || validUntil <= this.horizon) return null;
    return {
      ...other,
      validFrom: new Date(validFrom).toISOString(),
      validUntil: new Date(validUntil).toISOString(),
      groups: { ...other.groups, copyEffects: findings },
    } satisfies StableCutWriterFindings;
  }

  private matchesScope(scope: CutScope, controlsHash: string) {
    const { scopeHash } = stableCutScopeBinding(scope, invalid);
    return (
      scopeHash === this.selection.scope.scopeHash &&
      sourceHashValid(controlsHash)
    );
  }
}
