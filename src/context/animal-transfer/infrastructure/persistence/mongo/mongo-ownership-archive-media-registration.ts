import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { archiveReservationEpoch } from '../../../domain/ownership-archive-reservation';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../../../shared/domain/errors/ResourceNotFoundError';
import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchive,
} from '../../../domain/ownership-archive';
import {
  ArchiveMediaRegistration,
  TransferredMediaRegistration,
  OwnershipArchiveMediaRegistrationRepository,
  assertMediaRegistrationArchive,
  assertSameMediaRegistration,
  buildArchiveMediaRegistration,
} from '../../../domain/ownership-archive-media-registration';
import { ARCHIVE_REFERENCE_PLAN_PROTOCOL } from '../../../domain/ownership-archive-reference-plan';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
} from './ownership-archive.schema';
import { OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL } from './ownership-archive-media-registration.schema';

/** Called only after the caller has fenced and validated its protocol in the same session. */
export async function persistTransferredMediaRegistration(
  registrations: Model<TransferredMediaRegistration>,
  registration: TransferredMediaRegistration,
  session: ClientSession,
) {
  const { id, key, archiveId, fileId } = registration;
  const existing = await registrations
    .find({ $or: [{ id }, { key }, { archiveId, fileId }] })
    .limit(2)
    .session(session)
    .lean()
    .exec();
  if (existing.length > 1)
    throw new ConflictError(
      'Archive media registration identities are duplicated',
    );
  if (existing.length === 1) {
    assertSameMediaRegistration(existing[0], registration);
    return;
  }
  // A conflicting unique key aborts the transaction.
  await registrations.create([registration], { session });
}

@Injectable()
export class MongoOwnershipArchiveMediaRegistration implements OwnershipArchiveMediaRegistrationRepository {
  constructor(
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(OWNERSHIP_ARCHIVE_ENTRY_MODEL)
    private readonly entries: Model<ArchiveEntry>,
    @InjectModel(OWNERSHIP_ARCHIVE_FILE_MODEL)
    private readonly files: Model<ArchiveFile>,
    @InjectModel(OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL)
    private readonly registrations: Model<TransferredMediaRegistration>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
  ) {}

  async registerFile(
    archiveId: string,
    fileId: string,
  ): Promise<ArchiveMediaRegistration> {
    const session = await this.archives.db.startSession();
    try {
      return await session.withTransaction(
        async () => {
          const archive = await this.archives
            .findOne({ id: archiveId })
            .session(session)
            .lean()
            .exec();
          if (!archive)
            throw new ResourceNotFoundError('Ownership archive not found');
          assertMediaRegistrationArchive(archive);
          const active = await this.periods
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
              'Media registration requires the matching active period',
            );
          // Competes with materialization and the future commit/recovery through the SAME control.
          const control = await this.controls
            .updateOne(
              {
                animalId: archive.animalId,
                ownerId: archive.ownerId,
                ownershipVersion: archive.ownershipVersion,
                'transferLock.transferId': archive.transferId,
                reservationEpoch: archiveReservationEpoch(archive),
                $expr: {
                  $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0],
                },
              },
              { $inc: { archiveMaterializationRevision: 1 } },
              { session },
            )
            .exec();
          if (control.modifiedCount !== 1)
            throw new ConflictError(
              'Media registration requires the matching drained transfer reservation',
            );
          const file = await this.files
            .findOne({ archiveId, id: fileId })
            .session(session)
            .lean()
            .exec();
          if (!file)
            throw new ResourceNotFoundError('Ownership archive file not found');
          const entry = await this.entries
            .findOne({
              archiveId,
              'fileBindings.fileId': fileId,
              'referencePlan.protocol': ARCHIVE_REFERENCE_PLAN_PROTOCOL,
              'referencePlan.definitionHash': archive.definitionHash,
              'referencePlan.bindings.fileId': fileId,
              $expr: {
                $eq: ['$referencePlan.sourceContentHash', '$contentHash'],
              },
            })
            .select({ id: 1, referencePlan: 1 })
            .session(session)
            .lean()
            .exec();
          if (!entry?.referencePlan || entry.referencePlan.entryId !== entry.id)
            throw new ConflictError(
              'The archive file has no matching immutable reference plan',
            );
          const registration = buildArchiveMediaRegistration(
            archive,
            file,
            entry.referencePlan,
          );
          await persistTransferredMediaRegistration(
            this.registrations,
            registration,
            session,
          );
          return registration;
        },
        {
          readConcern: { level: 'snapshot' },
          readPreference: 'primary',
          writeConcern: { w: 'majority' },
        },
      );
    } finally {
      await session.endSession();
    }
  }
}
