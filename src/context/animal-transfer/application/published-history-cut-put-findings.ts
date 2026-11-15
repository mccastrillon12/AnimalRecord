import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import type {
  PublishedHistoryStableCutFile,
  PublishedHistoryStableCutPutObservations,
} from '../domain/published-history-stable-cut-scope';
import {
  historicalPutEvidenceTime,
  matchPutVersionEvidence,
  type ItemHistoricalPutVersionScope,
  type PutVersionEvidence,
} from '../domain/transfer-item-historical-put-reconciliation';
import {
  verifyStableCutVersion,
  type StableCutVersionStorage,
} from './stable-cut-version-evidence';

const protocols = {
  historical: 'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1',
  staging: 'PUBLISHED_HISTORY_STAGING_PUT_VERSION_EVIDENCE_V1',
  final: 'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1',
} as const;

type Readers = Readonly<
  Record<
    keyof typeof protocols,
    {
      readVersionEvidence(
        scope: ItemHistoricalPutVersionScope,
        hash: string,
      ): Promise<PutVersionEvidence | null>;
    }
  >
>;

const invalid = () =>
  new ConflictError(
    'The retained PUT findings do not match the selected stable cut',
  );

export class PublishedHistoryCutPutFindings {
  constructor(
    private readonly readers: Readers,
    private readonly versions: StableCutVersionStorage,
  ) {}

  async read(
    file: PublishedHistoryStableCutFile,
    raw: PublishedHistoryStableCutPutObservations,
    horizon: number,
  ) {
    if (!raw || raw.fileId !== file.fileId) throw invalid();
    const { historical, staging, final, finalPermission } =
      structuredClone(raw);
    const { permissionHash, ...permissionFacts } = finalPermission;
    if (
      permissionHash !== file.attempts[2].permissionHash ||
      archiveHash(permissionFacts) !== permissionHash ||
      permissionFacts.versionObservationHash !== staging.observationHash ||
      permissionFacts.stagingPermissionHash !==
        file.attempts[1].permissionHash ||
      permissionFacts.conservationControlsHash !==
        staging.conservationControlsHash ||
      historical.observationHash !== file.historical.observationHash ||
      final.observationHash !== file.final.observationHash
    )
      throw invalid();

    const legs = [
      { leg: 'historical', observation: historical, pin: file.attempts[0] },
      { leg: 'staging', observation: staging, pin: file.attempts[1] },
      { leg: 'final', observation: final, pin: file.attempts[2] },
    ] as const;
    for (const { observation, pin } of legs) {
      const { observationHash, ...facts } = observation;
      if (
        archiveHash(facts) !== observationHash ||
        facts.scope.permissionHash !== pin.permissionHash ||
        facts.scope.authorizationId !== pin.authorizationId
      )
        throw invalid();
    }

    const findings = [];
    for (const { leg, observation } of legs) {
      const { scope, revision, evidenceHash, conservationControlsHash } =
        observation;
      const report = matchPutVersionEvidence(
        scope,
        await this.readers[leg].readVersionEvidence(scope, evidenceHash),
        evidenceHash,
        protocols[leg],
      );
      const validFrom = historicalPutEvidenceTime(report.validFrom);
      const validUntil = historicalPutEvidenceTime(report.validUntil);
      if (
        validFrom > horizon ||
        validUntil <= horizon ||
        archiveHash(report.revision) !== archiveHash(revision) ||
        report.conservationControlsHash !== conservationControlsHash
      )
        throw invalid();
      const version = await verifyStableCutVersion(
        this.versions,
        {
          target: scope.target,
          revision,
          sha256: scope.sha256,
          conservationControlsHash,
        },
        horizon,
        invalid,
        'The exact retained PUT version could not be read',
      );
      if (historicalPutEvidenceTime(version.retainUntil) < validUntil)
        throw invalid();
      findings.push({
        permissionHash: scope.permissionHash,
        evidenceHash: archiveHash({
          observationHash: observation.observationHash,
          evidenceHash,
        }),
        validFrom,
        validUntil,
      });
    }
    return findings;
  }
}
