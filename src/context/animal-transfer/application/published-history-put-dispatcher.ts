import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import type { OwnershipArchiveHistoryRepository } from '../domain/ownership-archive-history';
import {
  PublishedHistoryPutAttempt,
  PublishedHistoryPutReadInput,
  publishedHistoryPutReadInput,
} from '../domain/published-history-copy';
import type {
  PublishedHistoryPutHeldEvidence,
  PublishedHistoryPutPermissionInput,
} from '../domain/published-history-put-permission';
import { profileIdValid } from '../domain/transfer-item-historical-observation';
import { putDestinationAdmissionWindowContains } from '../domain/transfer-item-historical-put-destination-protection';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import type { ItemPutTransport } from '../domain/transfer-item-historical-put-transport';
import {
  PublishedHistoryPutArtifactSeal,
  capturePublishedHistoryPutArtifactSeal,
} from '../domain/transfer-item-staging-put-artifact';
import type { ItemSourceArtifactReader } from '../domain/transfer-item-source-artifact';
import type { PublishedHistoryPutArtifacts } from './item-staging-put-artifacts';
import { prepareItemPutTransport } from './item-put-transport';

type PublishedHistoryPutStore = Required<
  Pick<
    OwnershipArchiveHistoryRepository,
    | 'readPublishedCopyAttempt'
    | 'recordInitialPublishedCopyPermission'
    | 'recordPublishedCopyTransportObservation'
  >
>;
type DispatchInput = PublishedHistoryPutReadInput &
  Readonly<{ artifact: PublishedHistoryPutArtifactSeal }>;
const invalid = () =>
  new ConflictError(
    'The published history PUT dispatch evidence is inconsistent',
  );

/** One local delegation after acknowledgment of a fresh permission. */
export class PublishedHistoryPutDispatcher {
  private used = false;
  private pending?: Readonly<{
    pins: PublishedHistoryPutPermissionInput;
    evidence: PublishedHistoryPutHeldEvidence;
  }>;

  constructor(
    private readonly dispatcherInstanceId: string,
    private readonly store: PublishedHistoryPutStore,
    private readonly keyFromUrl: (url: string) => string | undefined,
    private readonly artifacts: Pick<PublishedHistoryPutArtifacts, 'open'>,
    private readonly custody: ItemSourceArtifactReader<PublishedHistoryPutArtifactSeal>,
    private readonly transport: ItemPutTransport,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!profileIdValid(dispatcherInstanceId)) throw invalid();
  }

  /** Compose this callback as permissionEvidenceFor on the store. */
  readonly permissionEvidenceFor = (
    pins: PublishedHistoryPutPermissionInput,
    attempt: PublishedHistoryPutAttempt,
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
        'The published history PUT dispatcher was already used',
      );
    this.used = true;
    const pins = publishedHistoryPutReadInput(raw);
    const seal = capturePublishedHistoryPutArtifactSeal(raw.artifact);
    const record = await this.store.readPublishedCopyAttempt(
      pins,
      this.keyFromUrl,
    );
    const { definition, destinationProtection } = record;
    if (
      definition.dispatcherInstanceId !== this.dispatcherInstanceId ||
      definition.definitionHash !== pins.expectedAttemptDefinitionHash ||
      definition.intentDefinitionHash !== pins.expectedIntentHash ||
      seal.attemptDefinitionHash !== definition.definitionHash ||
      seal.protectionHash !== destinationProtection.protectionHash ||
      seal.versionObservationHash !== record.versionObservationHash
    )
      throw invalid();

    const opened = await this.artifacts.open(pins, seal, this.custody);
    try {
      const openedSeal = capturePublishedHistoryPutArtifactSeal(opened.seal);
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
        await this.store.recordInitialPublishedCopyPermission(
          selection,
          this.keyFromUrl,
        );
      this.pending = undefined;
      const { permissionHash, ...marker } = permission;
      const checkedAt = this.now().getTime();
      if (
        recorded !== true ||
        marker.protocol !== 'PUBLISHED_HISTORY_PUT_PERMISSION_V1' ||
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
        marker.versionObservationHash !== record.versionObservationHash ||
        marker.conservationControlsHash !== record.conservationControlsHash ||
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
        await this.store.recordPublishedCopyTransportObservation({
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
