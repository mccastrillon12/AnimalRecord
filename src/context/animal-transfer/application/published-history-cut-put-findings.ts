import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import type {
  PublishedHistoryStableCutFile,
  PublishedHistoryStableCutPutObservations,
} from '../domain/published-history-stable-cut-scope';
import {
  readStableCutPutFinding,
  type StableCutPutVersionEvidenceReader,
  type StableCutVersionStorage,
} from './stable-cut-version-evidence';

const protocols = {
  historical: 'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1',
  staging: 'PUBLISHED_HISTORY_STAGING_PUT_VERSION_EVIDENCE_V1',
  final: 'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1',
} as const;

type Readers = Readonly<
  Record<keyof typeof protocols, StableCutPutVersionEvidenceReader>
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
      findings.push(
        await readStableCutPutFinding(
          this.readers[leg],
          this.versions,
          observation,
          protocols[leg],
          horizon,
          invalid,
          'The exact retained PUT version could not be read',
        ),
      );
    }
    return findings;
  }
}
