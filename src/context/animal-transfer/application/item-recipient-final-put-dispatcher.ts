import { isDeepStrictEqual } from 'node:util';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from '../domain/ownership-archive';
import {
  ItemCopyRecordStore,
  ItemRecipientFinalPutPermissionPins,
  ItemRecipientFinalPutPermissionRecordInput,
  nextCopyGateRevision,
  recipientFinalPutPermissionPins,
} from '../domain/transfer-item-copy-record';
import { profileIdValid } from '../domain/transfer-item-historical-observation';
import {
  ItemPutTransport,
  matchRecipientFinalPutTransportObservation,
} from '../domain/transfer-item-historical-put-transport';
import type { ItemRecipientFinalPutAttempt } from '../domain/transfer-item-recipient-final-put-attempt';
import type { ItemSourceArtifactReader } from '../domain/transfer-item-source-artifact';
import {
  ItemRecipientFinalPutArtifactSeal,
  captureRecipientFinalPutArtifactSeal,
} from '../domain/transfer-item-staging-put-artifact';
import { prepareItemPutTransport } from './item-put-transport';
import type { ItemRecipientFinalPutArtifacts } from './item-staging-put-artifacts';

export type ItemRecipientFinalPutDispatchInput =
  ItemRecipientFinalPutPermissionPins &
    Readonly<{ artifact: ItemRecipientFinalPutArtifactSeal }>;

const invalid = () =>
  new ConflictError(
    'The recipient final PUT dispatch evidence is inconsistent',
  );

/** One dispatcher instance can delegate only after recognizing its own commit. */
export class ItemRecipientFinalPutDispatcher {
  private used = false;
  private pending?: Readonly<{
    pins: ItemRecipientFinalPutPermissionRecordInput;
    openedArtifactSeal: ItemRecipientFinalPutArtifactSeal;
  }>;

  constructor(
    private readonly dispatcherInstanceId: string,
    private readonly store: Pick<
      ItemCopyRecordStore,
      | 'readRecipientFinalPutAttempt'
      | 'recordInitialRecipientFinalPutPermission'
      | 'recordRecipientFinalPutTransportObservation'
    >,
    private readonly artifacts: Pick<ItemRecipientFinalPutArtifacts, 'open'>,
    private readonly custody: ItemSourceArtifactReader<ItemRecipientFinalPutArtifactSeal>,
    private readonly transport: ItemPutTransport,
  ) {
    if (!profileIdValid(dispatcherInstanceId)) throw invalid();
  }

  /** Bind as finalPermissionEvidenceFor on the explicitly composed store. */
  readonly permissionEvidenceFor = (
    pins: ItemRecipientFinalPutPermissionRecordInput,
    definition: ItemRecipientFinalPutAttempt,
  ) => {
    const pending = this.pending;
    return pending &&
      definition.dispatcherInstanceId === this.dispatcherInstanceId &&
      definition.definitionHash ===
        pending.pins.expectedAttemptDefinitionHash &&
      isDeepStrictEqual(pins, pending.pins)
      ? Object.freeze({
          openedArtifactSeal: pending.openedArtifactSeal,
          transportRequestHash: pending.pins.transportRequestHash,
        })
      : null;
  };

  async dispatch(raw: ItemRecipientFinalPutDispatchInput) {
    if (this.used)
      throw new ConflictError('The final PUT dispatcher was already used');
    this.used = true;
    const { artifact, ...selection } = raw ?? {};
    const seal = captureRecipientFinalPutArtifactSeal(artifact);
    const { authorizationId, ...readPins } =
      recipientFinalPutPermissionPins(selection);
    const record = await this.store.readRecipientFinalPutAttempt(readPins);
    const { definition, gateId, destinationProtection: protection } = record;
    if (
      record.permission ||
      definition.protocol !== 'ITEM_RECIPIENT_FINAL_PUT_ATTEMPT_V1' ||
      definition.dispatcherInstanceId !== this.dispatcherInstanceId ||
      definition.id !== readPins.attemptId ||
      definition.definitionHash !== readPins.expectedAttemptDefinitionHash ||
      seal.attemptDefinitionHash !== definition.definitionHash ||
      seal.protectionHash !== protection.protectionHash
    )
      throw invalid();

    const opened = await this.artifacts.open(readPins, seal, this.custody);
    try {
      const openedSeal = captureRecipientFinalPutArtifactSeal(opened.seal);
      if (openedSeal.artifactHash !== seal.artifactHash) throw invalid();
      const { delegate, transportRequestHash } = await prepareItemPutTransport(
        this.transport,
        definition.request,
        invalid,
      );
      const pins = Object.freeze({
        ...readPins,
        authorizationId,
        expectedArtifactHash: openedSeal.artifactHash,
        transportRequestHash,
      });
      this.pending = { pins, openedArtifactSeal: openedSeal };
      const receipt =
        await this.store.recordInitialRecipientFinalPutPermission(pins);
      this.pending = undefined;
      if (receipt?.recorded !== true || !receipt.permission) throw invalid();
      const { permission } = receipt;
      const { permissionHash, ...marker } = permission;
      if (
        marker.protocol !== 'ITEM_RECIPIENT_FINAL_PUT_PERMISSION_V1' ||
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
        marker.stagingPermissionHash !== readPins.source.permissionHash ||
        marker.versionObservationHash !==
          readPins.source.versionObservationHash ||
        marker.conservationControlsHash !==
          readPins.source.conservationControlsHash ||
        archiveHash(marker) !== permissionHash
      )
        throw invalid();

      const localReturn = await delegate(opened.body);
      const transportObservation = matchRecipientFinalPutTransportObservation(
        permission,
        await this.store.recordRecipientFinalPutTransportObservation({
          selector: readPins.anchor.preparation.selector,
          attemptId: definition.id,
          expectedAttemptDefinitionHash: definition.definitionHash,
          authorizationId,
          expectedPermissionHash: permissionHash,
          localReturn,
        }),
      );
      if (transportObservation.localReturn !== localReturn) throw invalid();
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
