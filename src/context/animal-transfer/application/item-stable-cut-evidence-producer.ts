import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import {
  appendItemStableCutVersionsDigest,
  ITEM_STABLE_CUT_SCOPE_PROTOCOL,
  itemStableCutVersionsDigestSeed,
  matchItemStableCutAccreditation,
  type ItemStableCutAccreditation,
  type ItemStableCutRetainedFile,
  type ItemStableCutScope,
  type StableCutWriterCoverage,
} from '../domain/transfer-item-stable-cut-evidence';
import {
  assertStableCutWriterCoverage,
  verifyStableCutVersion,
  type StableCutVersionStorage,
} from './stable-cut-version-evidence';

const invalid = () =>
  new ConflictError(
    'The selected initial item stable-cut evidence is inconsistent',
  );

/** The selected observation hashes bind both remote reads to the existing cut scope. */
export class ItemStableCutEvidenceProducer {
  constructor(
    private readonly coverage: {
      readCoverage(
        scope: ItemStableCutScope,
      ): Promise<StableCutWriterCoverage | null>;
    },
    private readonly storage: StableCutVersionStorage,
    private readonly now: () => Date,
  ) {}

  async produce(
    raw: Readonly<{
      scope: ItemStableCutScope;
      retainedFiles: readonly ItemStableCutRetainedFile[];
    }>,
  ) {
    const { scope, retainedFiles } = structuredClone(raw);
    const { scopeHash, ...facts } = scope;
    if (
      scope.protocol !== ITEM_STABLE_CUT_SCOPE_PROTOCOL ||
      scopeHash !== archiveHash(facts) ||
      scope.retained.fileCount !== retainedFiles.length
    )
      throw invalid();
    const controls = new Set<string>();
    let versionsDigest = itemStableCutVersionsDigestSeed();
    for (const file of retainedFiles) {
      const { historical, final } = file;
      if (
        ![file.fileId, file.fileDefinitionHash].every(sourceHashValid) ||
        historical.protocol !== 'ITEM_HISTORICAL_PUT_VERSION_OBSERVATION_V1' ||
        final.protocol !== 'ITEM_RECIPIENT_FINAL_PUT_VERSION_OBSERVATION_V1' ||
        historical.scope.sha256 !== final.scope.sha256
      )
        throw invalid();
      for (const { observationHash, ...observation } of [historical, final]) {
        if (
          archiveHash(observation) !== observationHash ||
          !sourceHashValid(observation.conservationControlsHash)
        )
          throw invalid();
        controls.add(observation.conservationControlsHash);
      }
      versionsDigest = appendItemStableCutVersionsDigest(versionsDigest, file);
    }
    if (
      versionsDigest !== scope.retained.versionsDigest ||
      archiveHash([...controls].sort()) !==
        archiveHash(scope.retained.conservationControlsHashes)
    )
      throw invalid();

    const horizon = historicalPutEvidenceTime(scope.selection.requiredThrough);
    const startedAt = this.now().getTime();
    if (!Number.isSafeInteger(startedAt) || startedAt > horizon)
      throw invalid();
    const coverage = structuredClone(
      await this.coverage.readCoverage(structuredClone(scope)),
    );
    assertStableCutWriterCoverage(
      coverage,
      scopeHash,
      startedAt,
      horizon,
      invalid,
    );

    let validUntil = historicalPutEvidenceTime(coverage.validUntil);
    const observations = [];
    for (const file of retainedFiles) {
      for (const observation of [file.historical, file.final]) {
        const { target, sha256 } = observation.scope;
        const observed = await verifyStableCutVersion(
          this.storage,
          {
            target,
            sha256,
            revision: observation.revision,
            conservationControlsHash: observation.conservationControlsHash,
          },
          horizon,
          invalid,
          'A selected initial-period object version could not be verified',
        );
        validUntil = Math.min(
          validUntil,
          historicalPutEvidenceTime(observed.retainUntil),
        );
        observations.push({
          observationHash: observation.observationHash,
          ...observed,
        });
      }
    }
    const accreditation: ItemStableCutAccreditation = {
      ...coverage,
      protocol: 'ITEM_STABLE_CUT_ACCREDITATION_V1',
      validUntil: new Date(validUntil).toISOString(),
      ...(observations.length
        ? {
            retainedVersionsEvidenceHash: archiveHash([
              versionsDigest,
              observations,
            ]),
          }
        : {}),
    };
    const checkedAt = this.now().getTime();
    if (checkedAt < startedAt) throw invalid();
    const observation = matchItemStableCutAccreditation(
      scope,
      accreditation,
      archiveHash(accreditation),
      checkedAt,
    );
    return Object.freeze({
      accreditation: Object.freeze(accreditation),
      observation,
    });
  }
}
