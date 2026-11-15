import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import {
  matchItemStableCutCopyPermissionIdentities,
  type ItemStableCutAttemptPin,
  type ItemStableCutPutObservation,
  type ItemStableCutScope,
} from '../domain/transfer-item-stable-cut-evidence';
import {
  readStableCutPutFinding,
  type StableCutPutVersionEvidenceReader,
  type StableCutVersionStorage,
} from './stable-cut-version-evidence';
import {
  stableCutScopeBinding,
  type CutScope,
  type StableCutOperationalEvidenceSource,
  type StableCutWriterFindings,
} from './stable-cut-writer-evidence';

const protocols = {
  ITEM_HISTORICAL_PUT_VERSION_OBSERVATION_V1:
    'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1',
  ITEM_STAGING_PUT_VERSION_OBSERVATION_V1:
    'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1',
  ITEM_RECIPIENT_FINAL_PUT_VERSION_OBSERVATION_V1:
    'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1',
} as const;

type Selection = Readonly<{
  scope: ItemStableCutScope;
  initialCopyAttempts: readonly ItemStableCutAttemptPin[];
  putObservations: readonly ItemStableCutPutObservation[];
}>;

type EvidenceAuthority = Pick<
  StableCutOperationalEvidenceSource,
  'readInventory'
> & {
  readOtherFindings(
    scope: ItemStableCutScope,
    controlsHash: string,
    writerInventoryHash: string,
    collectedIdentityHashes: readonly string[],
  ): Promise<StableCutWriterFindings | null>;
};

const invalid = () =>
  new ConflictError(
    'The initial PUT findings do not match the selected stable cut',
  );

/** Reads independent reports for the reconciled PUT observations selected by the original snapshot. */
export class ItemStableCutPutEvidenceSource implements StableCutOperationalEvidenceSource {
  private readonly selection: Selection;
  private readonly horizon: number;
  private readonly identities: readonly string[];

  constructor(
    raw: Selection,
    private readonly authority: EvidenceAuthority,
    private readonly readers: Readonly<
      Record<
        (typeof protocols)[keyof typeof protocols],
        StableCutPutVersionEvidenceReader
      >
    >,
    private readonly storage: StableCutVersionStorage,
  ) {
    this.selection = structuredClone(raw);
    const { scope, initialCopyAttempts, putObservations } = this.selection;
    const { initial, horizon } = stableCutScopeBinding(scope, invalid);
    if (
      !initial ||
      !matchItemStableCutCopyPermissionIdentities(
        scope.copyInventory,
        initialCopyAttempts,
      )
    )
      throw invalid();
    this.horizon = horizon;
    const pins = new Map(
      initialCopyAttempts.map((pin) => [pin.attemptId, pin]),
    );
    this.identities = Object.freeze(
      putObservations.map(({ attemptId, observation }) => {
        const pin = pins.get(attemptId);
        const { observationHash, ...facts } = observation;
        if (
          !pin?.permission ||
          !Object.prototype.hasOwnProperty.call(protocols, facts.protocol) ||
          archiveHash(facts) !== observationHash ||
          facts.scope.permissionHash !== pin.permission.permissionHash ||
          facts.scope.authorizationId !== pin.permission.authorizationId
        )
          throw invalid();
        pins.delete(attemptId);
        return archiveHash(pin);
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
        initialCopyAttempts: structuredClone(
          this.selection.initialCopyAttempts,
        ),
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
    const other = structuredClone(
      await this.authority.readOtherFindings(
        structuredClone(this.selection.scope),
        controlsHash,
        writerInventoryHash,
        this.identities,
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
    const collected = new Set(this.identities);
    const copyEffects = [...other.groups.copyEffects];
    if (copyEffects.some(({ identityHash }) => collected.has(identityHash)))
      throw invalid();

    for (const [
      index,
      { observation },
    ] of this.selection.putObservations.entries()) {
      const protocol = protocols[observation.protocol];
      const finding = await readStableCutPutFinding(
        this.readers[protocol],
        this.storage,
        observation,
        protocol,
        this.horizon,
        invalid,
        'The exact initial PUT version could not be read',
      );
      validFrom = Math.max(validFrom, finding.validFrom);
      validUntil = Math.min(validUntil, finding.validUntil);
      const identityHash = this.identities[index];
      copyEffects.push({
        identityHash,
        disposition: 'RECONCILED_AND_CONTROLLED',
        evidenceHash: archiveHash({
          scopeHash: scope.scopeHash,
          controlsHash,
          writerInventoryHash,
          identityHash,
          ...finding,
        }),
      });
    }

    return {
      ...other,
      validFrom: new Date(validFrom).toISOString(),
      validUntil: new Date(validUntil).toISOString(),
      groups: { ...other.groups, copyEffects },
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
