import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import type { OwnershipArchiveHistoryRepository } from '../domain/ownership-archive-history';
import {
  PublishedHistoryFinalPutAttempt,
  PublishedHistoryFinalReadInput,
  publishedHistoryFinalReadInput,
} from '../domain/published-history-final';
import type {
  PublishedHistoryFinalHeldEvidence,
  PublishedHistoryFinalPermissionInput,
} from '../domain/published-history-final-permission';
import { profileIdValid } from '../domain/transfer-item-historical-observation';
import { putDestinationAdmissionWindowContains } from '../domain/transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import type { ItemPutTransport } from '../domain/transfer-item-historical-put-transport';
import {
  PublishedHistoryFinalPutArtifactSeal,
  capturePublishedHistoryFinalPutArtifactSeal,
} from '../domain/transfer-item-staging-put-artifact';
import type { ItemSourceArtifactReader } from '../domain/transfer-item-source-artifact';
import type { PublishedHistoryFinalPutArtifacts } from './item-staging-put-artifacts';
import { prepareItemPutTransport } from './item-put-transport';

type PublishedHistoryFinalPutStore = Required<
  Pick<
    OwnershipArchiveHistoryRepository,
    | 'readPublishedFinalAttempt'
    | 'recordInitialPublishedFinalPermission'
    | 'recordPublishedFinalTransportObservation'
  >
>;
type DispatchInput = PublishedHistoryFinalReadInput &
  Readonly<{ artifact: PublishedHistoryFinalPutArtifactSeal }>;
const invalid = () =>
  new ConflictError(
    'The published history final PUT dispatch evidence is inconsistent',
  );

/** One local delegation after acknowledgment of a fresh permission. */
export class PublishedHistoryFinalPutDispatcher {
  private used = false;
  private pending?: Readonly<{
    pins: PublishedHistoryFinalPermissionInput;
    evidence: PublishedHistoryFinalHeldEvidence;
  }>;

  constructor(
    private readonly dispatcherInstanceId: string,
    private readonly store: PublishedHistoryFinalPutStore,
    private readonly artifacts: Pick<PublishedHistoryFinalPutArtifacts, 'open'>,
    private readonly custody: ItemSourceArtifactReader<PublishedHistoryFinalPutArtifactSeal>,
    private readonly transport: ItemPutTransport,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!profileIdValid(dispatcherInstanceId)) throw invalid();
  }

  /** Compose this callback as finalPermissionEvidenceFor on the store. */
  readonly permissionEvidenceFor = (
    pins: PublishedHistoryFinalPermissionInput,
    attempt: PublishedHistoryFinalPutAttempt,
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
        'The published history final PUT dispatcher was already used',
      );
    this.used = true;
    const pins = publishedHistoryFinalReadInput(raw);
    const seal = capturePublishedHistoryFinalPutArtifactSeal(raw.artifact);
    const record = await this.store.readPublishedFinalAttempt(pins);
    const { definition, destinationProtection } = record;
    if (
      definition.dispatcherInstanceId !== this.dispatcherInstanceId ||
      definition.definitionHash !== pins.expectedAttemptDefinitionHash ||
      definition.intentDefinitionHash !== pins.expectedFinalIntentHash ||
      seal.attemptDefinitionHash !== definition.definitionHash ||
      seal.protectionHash !== destinationProtection.protectionHash ||
      seal.versionObservationHash !==
        definition.predecessor.versionObservationHash
    )
      throw invalid();

    const opened = await this.artifacts.open(pins, seal, this.custody);
    try {
      const openedSeal = capturePublishedHistoryFinalPutArtifactSeal(
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
        await this.store.recordInitialPublishedFinalPermission(selection);
      this.pending = undefined;
      const { permissionHash, ...marker } = permission;
      const checkedAt = this.now().getTime();
      if (
        recorded !== true ||
        marker.protocol !== 'PUBLISHED_HISTORY_FINAL_PUT_PERMISSION_V1' ||
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
        marker.stagingPermissionHash !== pins.expectedStagingPermissionHash ||
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
        await this.store.recordPublishedFinalTransportObservation({
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
