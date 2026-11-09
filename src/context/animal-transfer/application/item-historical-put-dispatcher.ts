import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import {
  ItemCopyRecordStore,
  ItemHistoricalPutPermissionPins,
  ItemHistoricalPutPermissionRecordInput,
  historicalPutPermissionPins,
  nextCopyGateRevision,
} from '../domain/transfer-item-copy-record';
import {
  ItemHistoricalPutDestinationAccreditationReader,
  historicalPutDestinationScope,
  protectHistoricalPutDestinationFromAccreditation,
} from '../domain/transfer-item-historical-put-destination-protection';
import type { ItemHistoricalPutAttemptV2 } from '../domain/transfer-item-historical-put-attempt';
import type { ItemHistoricalPutPermissionInput } from '../domain/transfer-item-historical-put-permission';
import type { ItemHistoricalPutTransport } from '../domain/transfer-item-historical-put-transport';
import {
  profileIdValid,
  sourceHashValid,
} from '../domain/transfer-item-historical-observation';
import { ItemSourceArtifactReader } from '../domain/transfer-item-source-artifact';
import { ItemManifestObserver } from './item-manifest-observer';
import { prepareItemPutTransport } from './item-put-transport';

export type ItemHistoricalPutDispatchInput = ItemHistoricalPutPermissionPins &
  Readonly<{ expectedAccreditationHash: string }>;

const invalid = () =>
  new ConflictError('The historical PUT V2 dispatch evidence is inconsistent');

/** An explicitly composed, single-use instance for the dispatcher pinned in the declaration. */
export class ItemHistoricalPutDispatcher {
  private used = false;
  private pending?: Readonly<{
    pins: ItemHistoricalPutPermissionRecordInput;
    evidence: Pick<
      ItemHistoricalPutPermissionInput,
      'openedArtifactSeal' | 'accreditation' | 'transportRequestHash'
    >;
  }>;

  constructor(
    private readonly dispatcherInstanceId: string,
    private readonly store: Pick<
      ItemCopyRecordStore,
      | 'readHistoricalPutAttemptV2'
      | 'recordInitialHistoricalPutPermission'
      | 'recordHistoricalPutTransportObservation'
    >,
    private readonly observer: Pick<
      ItemManifestObserver,
      'openHistoricalSourceArtifact'
    >,
    private readonly custody: ItemSourceArtifactReader,
    private readonly accreditations: ItemHistoricalPutDestinationAccreditationReader,
    private readonly transport: ItemHistoricalPutTransport,
  ) {
    if (!profileIdValid(dispatcherInstanceId)) throw invalid();
  }

  /** Explicitly bind this local callback to the store used by the instance. */
  readonly permissionEvidenceFor = (
    pins: ItemHistoricalPutPermissionRecordInput,
    definition: ItemHistoricalPutAttemptV2,
  ) => {
    const pending = this.pending;
    return pending &&
      definition.dispatcherInstanceId === this.dispatcherInstanceId &&
      definition.definitionHash ===
        pending.pins.expectedAttemptDefinitionHash &&
      isDeepStrictEqual(pins, pending.pins)
      ? pending.evidence
      : null;
  };

  async dispatch(raw: ItemHistoricalPutDispatchInput) {
    if (this.used)
      throw new ConflictError(
        'The historical PUT V2 dispatcher was already used',
      );
    this.used = true;
    const { expectedAccreditationHash, ...selector } = raw ?? {};
    if (!sourceHashValid(expectedAccreditationHash)) throw invalid();
    const {
      authorizationId,
      expectedControlsHash,
      expectedProtectionHash,
      ...readPins
    } = historicalPutPermissionPins(selector);
    const { definition, gateId } =
      await this.store.readHistoricalPutAttemptV2(readPins);
    if (
      definition.dispatcherInstanceId !== this.dispatcherInstanceId ||
      definition.id !== readPins.attemptId ||
      definition.definitionHash !== readPins.expectedAttemptDefinitionHash ||
      authorizationId === definition.id ||
      authorizationId === this.dispatcherInstanceId
    )
      throw invalid();

    const scope = historicalPutDestinationScope(
      definition,
      expectedControlsHash,
    );
    const accreditation =
      await this.accreditations.readDestinationAccreditation(
        scope,
        expectedAccreditationHash,
      );
    if (!accreditation) throw invalid();
    const protection = protectHistoricalPutDestinationFromAccreditation(
      definition,
      expectedControlsHash,
      expectedAccreditationHash,
      accreditation,
    );
    if (protection.protectionHash !== expectedProtectionHash) throw invalid();

    const artifact = await this.observer.openHistoricalSourceArtifact(
      { anchor: readPins.anchor, expectedProfile: readPins.expectedProfile },
      definition.artifact,
      this.custody,
    );
    try {
      const { delegate, transportRequestHash } = await prepareItemPutTransport(
        this.transport,
        definition.request,
        invalid,
      );
      const pins = Object.freeze({
        ...readPins,
        authorizationId,
        expectedControlsHash,
        expectedProtectionHash,
        transportRequestHash,
      });
      this.pending = {
        pins,
        evidence: Object.freeze({
          openedArtifactSeal: artifact.seal,
          accreditation,
          transportRequestHash,
        }),
      };
      const committed =
        await this.store.recordInitialHistoricalPutPermission(pins);
      this.pending = undefined;
      const { permission, recorded } = committed;
      const { permissionHash, ...marker } = permission;
      if (
        recorded !== true ||
        marker.protocol !== 'ITEM_HISTORICAL_PUT_PERMISSION_V1' ||
        marker.state !== 'MAY_RUN' ||
        marker.authorizationId !== authorizationId ||
        marker.gateId !== gateId ||
        marker.expectedGateRevision !== readPins.expectedGateRevision ||
        marker.gateRevision !==
          nextCopyGateRevision(readPins.expectedGateRevision) ||
        marker.attemptId !== definition.id ||
        marker.attemptDefinitionHash !== definition.definitionHash ||
        marker.dispatcherInstanceId !== this.dispatcherInstanceId ||
        marker.artifactHash !== definition.artifact.artifactHash ||
        marker.transportRequestHash !== transportRequestHash ||
        marker.protectionHash !== expectedProtectionHash ||
        marker.accreditationHash !== expectedAccreditationHash ||
        marker.destinationControlsHash !== expectedControlsHash ||
        archiveHash(marker) !== permissionHash
      )
        throw invalid();
      const localReturn = await delegate(artifact.body);
      const transportObservation =
        await this.store.recordHistoricalPutTransportObservation({
          selector: readPins.anchor.preparation.selector,
          attemptId: definition.id,
          expectedAttemptDefinitionHash: definition.definitionHash,
          authorizationId,
          expectedPermissionHash: permissionHash,
          localReturn,
        });
      return Object.freeze({
        permission,
        transportObservation,
        outcome: transportObservation.outcome,
      });
    } finally {
      this.pending = undefined;
      try {
        artifact.close();
      } catch {
        // Preserve the permission and transport outcome when releasing custody fails.
      }
    }
  }
}
