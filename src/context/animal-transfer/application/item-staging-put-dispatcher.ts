import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import {
  ItemCopyRecordStore,
  ItemStagingPutPermissionPins,
  ItemStagingPutPermissionRecordInput,
  nextCopyGateRevision,
  stagingPutPermissionPins,
} from '../domain/transfer-item-copy-record';
import { profileIdValid } from '../domain/transfer-item-historical-observation';
import type { ItemPutTransport } from '../domain/transfer-item-historical-put-transport';
import type { ItemSourceArtifactReader } from '../domain/transfer-item-source-artifact';
import {
  ItemStagingPutArtifactSeal,
  captureStagingPutArtifactSeal,
} from '../domain/transfer-item-staging-put-artifact';
import type { ItemStagingPutAttempt } from '../domain/transfer-item-staging-put-attempt';
import type { ItemStagingPutPermissionInput } from '../domain/transfer-item-staging-put-permission';
import { prepareItemPutTransport } from './item-put-transport';
import type { ItemStagingPutArtifacts } from './item-staging-put-artifacts';

export type ItemStagingPutDispatchInput = ItemStagingPutPermissionPins &
  Readonly<{ artifact: ItemStagingPutArtifactSeal }>;

const invalid = () =>
  new ConflictError('The staging PUT dispatch evidence is inconsistent');

/** Explicit single-use composition. It never adopts an existing permission. */
export class ItemStagingPutDispatcher {
  private used = false;
  private pending?: Readonly<{
    pins: ItemStagingPutPermissionRecordInput;
    evidence: Pick<
      ItemStagingPutPermissionInput,
      'openedArtifactSeal' | 'transportRequestHash'
    >;
  }>;

  constructor(
    private readonly dispatcherInstanceId: string,
    private readonly store: Pick<
      ItemCopyRecordStore,
      | 'readStagingPutAttempt'
      | 'recordInitialStagingPutPermission'
      | 'recordStagingPutTransportObservation'
    >,
    private readonly artifacts: Pick<ItemStagingPutArtifacts, 'open'>,
    private readonly custody: ItemSourceArtifactReader<ItemStagingPutArtifactSeal>,
    private readonly transport: ItemPutTransport,
  ) {
    if (!profileIdValid(dispatcherInstanceId)) throw invalid();
  }

  /** Bind this callback as stagingPermissionEvidenceFor on the explicitly composed store. */
  readonly permissionEvidenceFor = (
    pins: ItemStagingPutPermissionRecordInput,
    definition: ItemStagingPutAttempt,
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

  async dispatch(raw: ItemStagingPutDispatchInput) {
    if (this.used)
      throw new ConflictError('The staging PUT dispatcher was already used');
    this.used = true;
    const { artifact: expected, ...selection } = raw ?? {};
    const seal = captureStagingPutArtifactSeal(expected);
    const { authorizationId, ...readPins } =
      stagingPutPermissionPins(selection);
    const record = await this.store.readStagingPutAttempt(readPins);
    const { definition, gateId, destinationProtection: protection } = record;
    if (
      record.permission ||
      definition.dispatcherInstanceId !== this.dispatcherInstanceId ||
      definition.id !== readPins.attemptId ||
      definition.definitionHash !== readPins.expectedAttemptDefinitionHash ||
      seal.attemptDefinitionHash !== definition.definitionHash ||
      seal.protectionHash !== protection.protectionHash ||
      [
        definition.id,
        definition.dispatcherInstanceId,
        definition.predecessor.attemptId,
        definition.predecessor.authorizationId,
      ].includes(authorizationId)
    )
      throw invalid();

    const opened = await this.artifacts.open(readPins, seal, this.custody);
    try {
      const openedSeal = captureStagingPutArtifactSeal(opened.seal);
      if (openedSeal.artifactHash !== seal.artifactHash) throw invalid();
      const { delegate, transportRequestHash } = await prepareItemPutTransport(
        this.transport,
        definition.request,
        invalid,
      );
      const pins = Object.freeze({
        ...readPins,
        authorizationId,
        expectedArtifactHash: seal.artifactHash,
        transportRequestHash,
      });
      this.pending = {
        pins,
        evidence: Object.freeze({
          openedArtifactSeal: openedSeal,
          transportRequestHash,
        }),
      };
      const { recorded, permission } =
        await this.store.recordInitialStagingPutPermission(pins);
      this.pending = undefined;
      const { permissionHash, ...marker } = permission;
      if (
        recorded !== true ||
        marker.protocol !== 'ITEM_STAGING_PUT_PERMISSION_V1' ||
        marker.state !== 'MAY_RUN' ||
        marker.authorizationId !== authorizationId ||
        marker.gateId !== gateId ||
        marker.expectedGateRevision !== readPins.expectedGateRevision ||
        marker.gateRevision !==
          nextCopyGateRevision(readPins.expectedGateRevision) ||
        marker.attemptId !== definition.id ||
        marker.attemptDefinitionHash !== definition.definitionHash ||
        marker.dispatcherInstanceId !== this.dispatcherInstanceId ||
        !isDeepStrictEqual(marker.artifact, openedSeal) ||
        marker.transportRequestHash !== transportRequestHash ||
        marker.protectionHash !== protection.protectionHash ||
        marker.accreditationHash !== readPins.expectedAccreditationHash ||
        marker.destinationControlsHash !== readPins.expectedControlsHash ||
        marker.historicalPermissionHash !== readPins.source.permissionHash ||
        marker.versionObservationHash !==
          readPins.source.versionObservationHash ||
        marker.conservationControlsHash !==
          readPins.source.conservationControlsHash ||
        archiveHash(marker) !== permissionHash
      )
        throw invalid();

      const localReturn = await delegate(opened.body);
      const transportObservation =
        await this.store.recordStagingPutTransportObservation({
          selector: readPins.anchor.preparation.selector,
          attemptId: definition.id,
          expectedAttemptDefinitionHash: definition.definitionHash,
          authorizationId,
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
