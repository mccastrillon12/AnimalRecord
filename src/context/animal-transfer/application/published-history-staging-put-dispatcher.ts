import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import type { OwnershipArchiveHistoryRepository } from '../domain/ownership-archive-history';
import {
  PublishedHistoryStagingPutAttempt,
  PublishedHistoryStagingReadInput,
  publishedHistoryStagingReadInput,
} from '../domain/published-history-staging';
import type {
  PublishedHistoryStagingHeldEvidence,
  PublishedHistoryStagingPermissionInput,
} from '../domain/published-history-staging-permission';
import { profileIdValid } from '../domain/transfer-item-historical-observation';
import { putDestinationAdmissionWindowContains } from '../domain/transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import type { ItemPutTransport } from '../domain/transfer-item-historical-put-transport';
import {
  PublishedHistoryStagingPutArtifactSeal,
  capturePublishedHistoryStagingPutArtifactSeal,
} from '../domain/transfer-item-staging-put-artifact';
import type { ItemSourceArtifactReader } from '../domain/transfer-item-source-artifact';
import type { PublishedHistoryStagingPutArtifacts } from './item-staging-put-artifacts';
import { prepareItemPutTransport } from './item-put-transport';

type PublishedHistoryStagingPutStore = Required<
  Pick<
    OwnershipArchiveHistoryRepository,
    | 'readPublishedStagingAttempt'
    | 'recordInitialPublishedStagingPermission'
    | 'recordPublishedStagingTransportObservation'
  >
>;
type DispatchInput = PublishedHistoryStagingReadInput &
  Readonly<{ artifact: PublishedHistoryStagingPutArtifactSeal }>;
const invalid = () =>
  new ConflictError(
    'The published history staging PUT dispatch evidence is inconsistent',
  );

/** One local delegation after acknowledgment of a fresh permission. */
export class PublishedHistoryStagingPutDispatcher {
  private used = false;
  private pending?: Readonly<{
    pins: PublishedHistoryStagingPermissionInput;
    evidence: PublishedHistoryStagingHeldEvidence;
  }>;

  constructor(
    private readonly dispatcherInstanceId: string,
    private readonly store: PublishedHistoryStagingPutStore,
    private readonly artifacts: Pick<
      PublishedHistoryStagingPutArtifacts,
      'open'
    >,
    private readonly custody: ItemSourceArtifactReader<PublishedHistoryStagingPutArtifactSeal>,
    private readonly transport: ItemPutTransport,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!profileIdValid(dispatcherInstanceId)) throw invalid();
  }

  /** Compose this callback as stagingPermissionEvidenceFor on the store. */
  readonly permissionEvidenceFor = (
    pins: PublishedHistoryStagingPermissionInput,
    attempt: PublishedHistoryStagingPutAttempt,
  ) => {
    const pending = this.pending;
    return pending &&
      attempt.dispatcherInstanceId === this.dispatcherInstanceId &&
      attempt.definitionHash === pending.pins.expectedAttemptDefinitionHash &&
      isDeepStrictEqual(pins, pending.pins)
      ? pending.evidence
      : null;
  };

  async dispatch(raw: DispatchInput) {
    if (this.used)
      throw new ConflictError(
        'The published history staging PUT dispatcher was already used',
      );
    this.used = true;
    const pins = publishedHistoryStagingReadInput(raw);
    const seal = capturePublishedHistoryStagingPutArtifactSeal(raw.artifact);
    const record = await this.store.readPublishedStagingAttempt(pins);
    const { definition, destinationProtection } = record;
    if (
      definition.dispatcherInstanceId !== this.dispatcherInstanceId ||
      definition.definitionHash !== pins.expectedAttemptDefinitionHash ||
      definition.intentDefinitionHash !== pins.expectedStagingIntentHash ||
      seal.attemptDefinitionHash !== definition.definitionHash ||
      seal.protectionHash !== destinationProtection.protectionHash ||
      seal.versionObservationHash !==
        definition.predecessor.versionObservationHash
    )
      throw invalid();

    const opened = await this.artifacts.open(pins, seal, this.custody);
    try {
      const openedSeal = capturePublishedHistoryStagingPutArtifactSeal(
        opened.seal,
      );
      if (openedSeal.artifactHash !== seal.artifactHash) throw invalid();
      const { delegate, transportRequestHash } = await prepareItemPutTransport(
        this.transport,
        definition.request,
        invalid,
      );
      const selection = Object.freeze({
        ...pins,
        expectedArtifactHash: seal.artifactHash,
        transportRequestHash,
      });
      this.pending = Object.freeze({
        pins: selection,
        evidence: Object.freeze({
          openedArtifactSeal: openedSeal,
          transportRequestHash,
        }),
      });
      const { recorded, permission } =
        await this.store.recordInitialPublishedStagingPermission(selection);
      this.pending = undefined;
      const { permissionHash, ...marker } = permission;
      const checkedAt = this.now().getTime();
      if (
        recorded !== true ||
        marker.protocol !== 'PUBLISHED_HISTORY_STAGING_PUT_PERMISSION_V1' ||
        marker.state !== 'MAY_RUN' ||
        marker.authorizationId !==
          archiveHash([marker.protocol, definition.id]) ||
        marker.selectionHash !== archiveHash(selection) ||
        marker.attemptId !== definition.id ||
        marker.attemptDefinitionHash !== definition.definitionHash ||
        marker.dispatcherInstanceId !== this.dispatcherInstanceId ||
        !isDeepStrictEqual(marker.artifact, openedSeal) ||
        marker.transportRequestHash !== transportRequestHash ||
        marker.protectionHash !== pins.expectedProtectionHash ||
        marker.accreditationHash !== pins.expectedAccreditationHash ||
        marker.destinationControlsHash !== pins.expectedControlsHash ||
        marker.historicalPermissionHash !== pins.expectedPermissionHash ||
        marker.versionObservationHash !==
          definition.predecessor.versionObservationHash ||
        marker.conservationControlsHash !==
          definition.predecessor.conservationControlsHash ||
        marker.requiredThrough !== pins.requiredThrough ||
        archiveHash(marker) !== permissionHash ||
        !(
          historicalPutEvidenceTime(marker.admittedAt) <= checkedAt &&
          checkedAt <= historicalPutEvidenceTime(pins.requiredThrough)
        ) ||
        !putDestinationAdmissionWindowContains(destinationProtection, checkedAt)
      )
        throw invalid();

      const localReturn = await delegate(opened.body);
      const transportObservation =
        await this.store.recordPublishedStagingTransportObservation({
          selection,
          expectedPermissionHash: permissionHash,
          localReturn,
        });
      return Object.freeze({
        permission,
        localReturn,
        transportObservation,
        outcome: transportObservation.outcome,
      });
    } finally {
      this.pending = undefined;
      try {
        opened.close();
      } catch {
        // Preserve the primary result when releasing custody fails.
      }
    }
  }
}
