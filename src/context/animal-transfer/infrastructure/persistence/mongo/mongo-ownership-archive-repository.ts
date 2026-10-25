import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../../../shared/domain/errors/ResourceNotFoundError';
import {
  ArchiveEntry,
  ArchiveCaptureProgress,
  ArchiveFile,
  OwnershipArchive,
  OwnershipArchiveRepository,
  VerifiedArchiveCopies,
} from '../../../domain/ownership-archive';
import {
  AnimalOwnershipPeriodDocument,
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';
import {
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
  OWNERSHIP_ARCHIVE_MODEL,
} from './ownership-archive.schema';

@Injectable()
export class MongoOwnershipArchiveRepository implements OwnershipArchiveRepository {
  constructor(
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(OWNERSHIP_ARCHIVE_ENTRY_MODEL)
    private readonly entries: Model<ArchiveEntry>,
    @InjectModel(OWNERSHIP_ARCHIVE_FILE_MODEL)
    private readonly files: Model<ArchiveFile>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodDocument>,
  ) {}

  async create(archive: OwnershipArchive): Promise<OwnershipArchive> {
    const period = await this.periods.exists({
      id: archive.periodId,
      animalId: archive.animalId,
      ownerId: archive.ownerId,
      ownershipVersion: archive.ownershipVersion,
      status: AnimalOwnershipPeriodStatus.Active,
    });
    if (!period)
      throw new ConflictError(
        'The archive requires the active ownership period',
      );
    try {
      await this.archives
        .updateOne(
          { id: archive.id },
          { $setOnInsert: archive },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 11000) throw error;
    }
    const persisted = await this.find(archive.id);
    if (!persisted || persisted.definitionHash !== archive.definitionHash) {
      throw new ConflictError(
        'An archive already exists with a different definition',
      );
    }
    return persisted;
  }

  async find(id: string): Promise<OwnershipArchive | null> {
    return this.archives.findOne({ id }).lean().exec();
  }

  async checkpointCapture(
    archiveId: string,
    expectedRevision: number,
    next: ArchiveCaptureProgress,
  ): Promise<boolean> {
    if (next.revision !== expectedRevision + 1)
      throw new ConflictError('Invalid capture revision');
    const result = await this.archives
      .updateOne(
        {
          id: archiveId,
          state: 'COLLECTING',
          'capture.revision': expectedRevision,
        },
        {
          $set: { capture: next },
        },
        { writeConcern: { w: 'majority' } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async findEntry(
    archiveId: string,
    entryId: string,
  ): Promise<ArchiveEntry | null> {
    return this.entries.findOne({ archiveId, id: entryId }).lean().exec();
  }

  async append(
    archiveId: string,
    entry: ArchiveEntry,
    files: ArchiveFile[],
  ): Promise<void> {
    const session = await this.archives.db.startSession();
    try {
      await session.withTransaction(async () => {
        const previous = await this.entries
          .findOne({ archiveId, id: entry.id })
          .session(session)
          .lean()
          .exec();
        if (previous) {
          if (previous.contentHash !== entry.contentHash)
            throw new ConflictError('An archived record cannot be overwritten');
          return;
        }
        // This write serializes collection against sealing, including two API instances.
        const claimed = await this.archives
          .updateOne(
            { id: archiveId, state: 'COLLECTING' },
            { $inc: { __v: 1 } },
            { session },
          )
          .exec();
        if (claimed.matchedCount !== 1)
          throw new ConflictError('The archive no longer accepts records');
        for (const file of files) {
          const existing = await this.files
            .findOne({ archiveId, id: file.id })
            .session(session)
            .lean()
            .exec();
          if (existing && existing.definitionHash !== file.definitionHash) {
            throw new ConflictError(
              'An archive source file changed while the cut was collected',
            );
          }
          await this.files
            .updateOne(
              { id: file.id, archiveId },
              { $setOnInsert: file },
              { upsert: true, session },
            )
            .exec();
        }
        await this.entries.create([entry], { session });
      });
    } finally {
      await session.endSession();
    }
  }

  async seal(archiveId: string, expectedEntryCount: number): Promise<void> {
    const session = await this.archives.db.startSession();
    try {
      await session.withTransaction(async () => {
        const archive = await this.archives
          .findOne({ id: archiveId })
          .session(session)
          .lean()
          .exec();
        if (!archive)
          throw new ResourceNotFoundError('Ownership archive not found');
        if (archive.state !== 'COLLECTING') {
          if (archive.expectedEntryCount !== expectedEntryCount)
            throw new ConflictError(
              'The archive was sealed with a different record count',
            );
          return;
        }
        if (
          archive.capture &&
          (archive.capture.phase !== 'COMPLETE' ||
            archive.capture.entryCount !== expectedEntryCount)
        ) {
          throw new ConflictError('The live dossier capture has not completed');
        }
        await this.archives
          .updateOne(
            { id: archiveId, state: 'COLLECTING' },
            { $inc: { __v: 1 } },
            { session },
          )
          .exec();
        const count = await this.entries
          .countDocuments({ archiveId })
          .session(session)
          .exec();
        const profiles = await this.entries
          .countDocuments({ archiveId, kind: 'ANIMAL' })
          .session(session)
          .exec();
        if (count !== expectedEntryCount || profiles !== 1)
          throw new ConflictError(
            'The archive is incomplete or lacks its animal snapshot',
          );
        const fileCount = await this.files
          .countDocuments({ archiveId })
          .session(session)
          .exec();
        await this.archives
          .updateOne(
            { id: archiveId },
            {
              $set: {
                state: 'COPYING',
                expectedEntryCount,
                expectedFileCount: fileCount,
              },
            },
            { session },
          )
          .exec();
      });
    } finally {
      await session.endSession();
    }
  }

  async listEntries(
    archiveId: string,
    afterId: string | undefined,
    limit: number,
  ): Promise<ArchiveEntry[]> {
    return this.entries
      .find({ archiveId, ...(afterId ? { id: { $gt: afterId } } : {}) })
      .sort({ id: 1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async claimFile(
    archiveId: string,
    token: string,
    now: string,
    leaseUntil: string,
  ): Promise<ArchiveFile | null> {
    return this.files
      .findOneAndUpdate(
        {
          archiveId,
          $or: [
            { state: 'PENDING' },
            { state: 'COPYING', leaseUntil: { $lte: now } },
          ],
        },
        { $set: { state: 'COPYING', leaseToken: token, leaseUntil } },
        { new: true, sort: { id: 1 } },
      )
      .lean()
      .exec();
  }

  async completeFile(
    fileId: string,
    token: string,
    verified: VerifiedArchiveCopies,
  ): Promise<boolean> {
    const result = await this.files
      .updateOne(
        { id: fileId, state: 'COPYING', leaseToken: token },
        {
          $set: { state: 'VERIFIED', verified },
          $unset: { leaseToken: 1, leaseUntil: 1 },
        },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async releaseFile(fileId: string, token: string): Promise<void> {
    await this.files
      .updateOne(
        { id: fileId, state: 'COPYING', leaseToken: token },
        {
          $set: { state: 'PENDING' },
          $unset: { leaseToken: 1, leaseUntil: 1 },
        },
      )
      .exec();
  }

  async markReadyIfComplete(archiveId: string): Promise<boolean> {
    const archive = await this.find(archiveId);
    if (!archive)
      throw new ResourceNotFoundError('Ownership archive not found');
    if (archive.state === 'READY') return true;
    if (archive.state !== 'COPYING') return false;
    const total = await this.files.countDocuments({ archiveId }).exec();
    const pending = await this.files.exists({
      archiveId,
      state: { $ne: 'VERIFIED' },
    });
    if (pending || total !== archive.expectedFileCount) return false;
    const result = await this.archives
      .updateOne(
        { id: archiveId, state: 'COPYING' },
        { $set: { state: 'READY' } },
      )
      .exec();
    return (
      result.modifiedCount === 1 ||
      (await this.find(archiveId))?.state === 'READY'
    );
  }
}
