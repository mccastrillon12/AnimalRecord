import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { AnimalOwnershipControl } from './animal-ownership';
import {
  ArchiveDefinition,
  OwnershipArchive,
  archiveHash,
} from './ownership-archive';
import { assertReservedEpoch } from './reservation-epoch';

export const ARCHIVE_RESERVATION_PROTOCOL = 'ARCHIVE_RESERVATION_V1' as const;
export type ArchiveReservation = {
  protocol: typeof ARCHIVE_RESERVATION_PROTOCOL;
  epoch: number;
  bindingHash: string;
};

/** Allowlist: operational metadata never silently changes the original definition hash. */
export function archiveDefinitionOnly(
  value: ArchiveDefinition,
): ArchiveDefinition {
  return {
    id: value.id,
    animalId: value.animalId,
    ownerId: value.ownerId,
    recipientId: value.recipientId,
    periodId: value.periodId,
    transferId: value.transferId,
    ownershipVersion: value.ownershipVersion,
  };
}
export function buildArchiveReservation(
  definition: ArchiveDefinition,
  epoch: number,
): ArchiveReservation {
  assertReservedEpoch(epoch);
  const protocol = ARCHIVE_RESERVATION_PROTOCOL;
  return {
    protocol,
    epoch,
    bindingHash: archiveHash({
      protocol,
      epoch,
      definitionHash: archiveHash(archiveDefinitionOnly(definition)),
    }),
  };
}
export function archiveReservationEpoch(archive: OwnershipArchive): number {
  const binding = archive.reservation;
  if (
    !binding ||
    archive.definitionHash !== archiveHash(archiveDefinitionOnly(archive)) ||
    archiveHash(binding) !==
      archiveHash(buildArchiveReservation(archive, binding.epoch))
  )
    throw new ConflictError(
      'The archive has no matching immutable reservation binding',
    );
  return assertReservedEpoch(binding.epoch);
}
export function assertArchiveReservationControl(
  archive: OwnershipArchive,
  control: AnimalOwnershipControl | null,
): void {
  const epoch = archiveReservationEpoch(archive);
  if (
    !control ||
    control.animalId !== archive.animalId ||
    control.ownerId !== archive.ownerId ||
    control.ownershipVersion !== archive.ownershipVersion ||
    control.transferLock?.transferId !== archive.transferId ||
    control.reservationEpoch !== epoch ||
    control.activeWrites?.length
  )
    throw new ConflictError(
      'The archive requires its original matching drained transfer reservation',
    );
}
