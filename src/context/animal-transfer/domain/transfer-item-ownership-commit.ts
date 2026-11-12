import { ArchiveDefinition, archiveHash } from './ownership-archive';
import { nextReservationEpoch } from './reservation-epoch';
import {
  ItemStableCutAccreditationSelection,
  ItemStableCutConsumption,
} from './transfer-item-stable-cut-evidence';
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
