import { ArchiveDefinition, archiveHash } from './ownership-archive';
import { nextReservationEpoch } from './reservation-epoch';
import {
  ItemStableCutAccreditationSelection,
  ItemStableCutConsumption,
  LaterPeriodStableCutConsumption,
} from './transfer-item-stable-cut-evidence';
import type { ItemCaptureInput } from './transfer-item-capture';
import { transferRecordId } from './transfer-record-id';

/** Immutable item result. A value produced inside a transaction is provisional. */
export function buildItemOwnershipCommit(
  definition: ArchiveDefinition,
  selection: ItemStableCutAccreditationSelection,
  consumption: ItemStableCutConsumption,
  requestVersion: number,
) {
  const {
    id: archiveId,
    transferId,
    animalId,
    ownerId,
    recipientId,
  } = definition;
  const { itemId, decisionOperationId } = selection.selection.selector;
  const result = {
    protocol: 'TRANSFER_ITEM_OWNERSHIP_COMMIT_V1' as const,
    id: transferRecordId('ownership-commit', transferId, itemId),
    selectionHash: archiveHash(selection),
    consumptionHash: consumption.definitionHash,
    transferId,
    itemId,
    animalId,
    archiveId,
    decisionOperationId,
    previousOwnerId: ownerId,
    ownerId: recipientId,
    closedPeriodId: definition.periodId,
    activePeriodId: transferRecordId('ownership-period', transferId, itemId),
    ownershipVersion: definition.ownershipVersion + 1,
    reservationEpoch: nextReservationEpoch(
      consumption.binding.observedSeal.reservationEpoch,
    ),
    requestVersion,
    effectiveAt: consumption.consumedAt,
  };
  return Object.freeze({ ...result, commitHash: archiveHash(result) });
}

export type ItemOwnershipCommit = ReturnType<typeof buildItemOwnershipCommit>;

export function buildLaterPeriodItemOwnershipCommit(
  definition: ArchiveDefinition,
  selection: Readonly<{ selector: ItemCaptureInput }>,
  consumption: LaterPeriodStableCutConsumption,
  originalReservationEpoch: number,
  requestVersion: number,
) {
  const {
    id: archiveId,
    transferId,
    animalId,
    ownerId,
    recipientId,
  } = definition;
  const { itemId, decisionOperationId } = selection.selector;
  const result = {
    protocol: 'TRANSFER_LATER_PERIOD_ITEM_OWNERSHIP_COMMIT_V1' as const,
    id: transferRecordId('ownership-commit', transferId, itemId),
    selectionHash: archiveHash(selection),
    consumptionHash: consumption.definitionHash,
    retainedReferencesReceiptHash: consumption.retainedReceiptHash,
    transferId,
    itemId,
    animalId,
    archiveId,
    decisionOperationId,
    previousOwnerId: ownerId,
    ownerId: recipientId,
    closedPeriodId: definition.periodId,
    activePeriodId: transferRecordId('ownership-period', transferId, itemId),
    ownershipVersion: definition.ownershipVersion + 1,
    reservationEpoch: nextReservationEpoch(originalReservationEpoch),
    requestVersion,
    effectiveAt: consumption.consumedAt,
  };
  return Object.freeze({ ...result, commitHash: archiveHash(result) });
}

export type LaterPeriodItemOwnershipCommit = ReturnType<
  typeof buildLaterPeriodItemOwnershipCommit
>;
export type TransferItemOwnershipCommit =
  | ItemOwnershipCommit
  | LaterPeriodItemOwnershipCommit;
