import { ClientSession, Model } from 'mongoose';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { OwnershipPeriodStartProvenance } from '../../../domain/animal-ownership';
import { nextReservationEpoch } from '../../../domain/reservation-epoch';
import type { ItemOwnershipCommit } from '../../../domain/transfer-item-ownership-commit';
import { assertArchiveCallerTransaction } from './archive-reservation-fence';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';

type OwnershipTransition = Pick<
  ItemOwnershipCommit,
  | 'animalId'
  | 'previousOwnerId'
  | 'ownerId'
  | 'transferId'
  | 'effectiveAt'
  | 'closedPeriodId'
  | 'activePeriodId'
  | 'archiveId'
  | 'ownershipVersion'
  | 'reservationEpoch'
>;

function assertChanged(result: {
  matchedCount: number;
  modifiedCount: number;
}) {
  if (result.matchedCount !== 1 || result.modifiedCount !== 1)
    throw new ConflictError('The item capture admission fence changed');
}

/** Rotates periods and releases only the reservation held by this ownership writer. */
export async function writeOwnershipPeriodsAndControl(
  periods: Model<AnimalOwnershipPeriodEntity>,
  controls: Model<AnimalOwnershipControlEntity>,
  result: OwnershipTransition,
  previousReservationEpoch: number,
  session: ClientSession,
): Promise<void> {
  assertArchiveCallerTransaction(session, periods, [controls]);
  if (
    result.reservationEpoch !== nextReservationEpoch(previousReservationEpoch)
  )
    throw new ConflictError(
      'The next ownership reservation epoch is inconsistent',
    );
  const { animalId, previousOwnerId, ownerId, transferId, effectiveAt } =
    result;
  const previousOwnershipVersion = result.ownershipVersion - 1;
  assertChanged(
    await periods
      .updateOne(
        {
          id: result.closedPeriodId,
          animalId,
          ownerId: previousOwnerId,
          ownershipVersion: previousOwnershipVersion,
          status: AnimalOwnershipPeriodStatus.Active,
          endedAt: { $exists: false },
          archiveId: { $exists: false },
          $or: [
            { startedAt: { $exists: false } },
            { startedAt: { $lte: effectiveAt } },
          ],
        },
        {
          $set: {
            status: AnimalOwnershipPeriodStatus.Closed,
            endedAt: effectiveAt,
            archiveId: result.archiveId,
          },
        },
        { session },
      )
      .exec(),
  );
  await periods.create(
    [
      {
        id: result.activePeriodId,
        animalId,
        ownerId,
        ownershipVersion: result.ownershipVersion,
        startedAt: effectiveAt,
        startedAtKnown: true,
        startProvenance: OwnershipPeriodStartProvenance.Transfer,
        sourceTransferId: transferId,
        status: AnimalOwnershipPeriodStatus.Active,
      },
    ],
    { session },
  );
  assertChanged(
    await controls
      .updateOne(
        {
          animalId,
          ownerId: previousOwnerId,
          ownershipVersion: previousOwnershipVersion,
          reservationEpoch: previousReservationEpoch,
          'transferLock.transferId': transferId,
          $expr: { $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0] },
        },
        {
          $set: {
            ownerId,
            ownershipVersion: result.ownershipVersion,
            reservationEpoch: result.reservationEpoch,
          },
          $unset: { transferLock: 1 },
        },
        { session },
      )
      .exec(),
  );
}
