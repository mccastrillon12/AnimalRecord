import { ClientSession, Model } from 'mongoose';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { OwnershipArchive } from '../../../domain/ownership-archive';
import { archiveReservationEpoch } from '../../../domain/ownership-archive-reservation';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';

/** Short Mongo-only fence; never wrap S3 in this transaction. */
export async function fenceArchiveReservation<
  P extends AnimalOwnershipPeriodEntity,
>(
  archive: OwnershipArchive,
  controls: Model<AnimalOwnershipControlEntity>,
  periods: Model<P>,
  session: ClientSession,
): Promise<void> {
  const epoch = archiveReservationEpoch(archive);
  const active = await periods
    .exists({
      id: archive.periodId,
      animalId: archive.animalId,
      ownerId: archive.ownerId,
      ownershipVersion: archive.ownershipVersion,
      status: 'ACTIVE',
    })
    .session(session)
    .exec();
  if (!active)
    throw new ConflictError(
      'The archive requires the matching active ownership period',
    );
  const filter = {
    animalId: archive.animalId,
    ownerId: archive.ownerId,
    ownershipVersion: archive.ownershipVersion,
    'transferLock.transferId': archive.transferId,
    reservationEpoch: epoch,
    $expr: { $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0] },
  };
  const control = await controls.findOne(filter).session(session).lean().exec();
  const revision = control?.archivePreparationRevision;
  if (
    !control ||
    (revision !== undefined &&
      (!Number.isSafeInteger(revision) ||
        revision < 0 ||
        revision >= Number.MAX_SAFE_INTEGER))
  )
    throw new ConflictError(
      'The archive reservation or preparation fence changed',
    );
  const saved = await controls
    .updateOne(
      { ...filter, archivePreparationRevision: revision ?? { $exists: false } },
      { $inc: { archivePreparationRevision: 1 } },
      { session },
    )
    .exec();
  if (saved.modifiedCount !== 1)
    throw new ConflictError('The archive reservation fence changed');
}
