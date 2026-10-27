import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { fenceArchiveReservation } from './archive-reservation-fence';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import {
  ArchiveEntry,
  ArchiveFile,
  ArchiveHistoryProgress,
  OwnershipArchive,
} from '../../../domain/ownership-archive';
import { OwnershipArchiveHistoryRepository } from '../../../domain/ownership-archive-history';
import {
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
} from './ownership-archive.schema';

@Injectable()
export class MongoOwnershipArchiveHistory implements OwnershipArchiveHistoryRepository {
  constructor(
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(OWNERSHIP_ARCHIVE_ENTRY_MODEL)
    private readonly entries: Model<ArchiveEntry>,
    @InjectModel(OWNERSHIP_ARCHIVE_FILE_MODEL)
    private readonly files: Model<ArchiveFile>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
  ) {}

  async start(
    archiveId: string,
    sourceArchiveId: string,
  ): Promise<OwnershipArchive> {
    return this.transaction(async (session) => {
      const archive = await this.archives
        .findOne({ id: archiveId })
        .session(session)
        .lean()
        .exec();
      if (
        !archive ||
        archive.capture ||
        archive.state !== 'COLLECTING' ||
        (archive.history && archive.history.sourceArchiveId !== sourceArchiveId)
      ) {
        throw new ConflictError(
          'History import requires the same collecting manual archive',
        );
      }
      await fenceArchiveReservation(
        archive,
        this.controls,
        this.periods,
        session,
      );
      const source = await this.loadSource(archive, sourceArchiveId, session);
      if (archive.history) {
        this.assertPinned(archive.history, source);
        return archive;
      }
      const history: ArchiveHistoryProgress = {
        sourceArchiveId,
        sourceDefinitionHash: source.definitionHash,
        expectedEntryCount: source.expectedEntryCount!,
        expectedFileCount: source.expectedFileCount!,
        revision: 0,
        phase: 'IMPORTING',
        entryCount: 0,
      };
      const result = await this.archives
        .updateOne(
          {
            id: archiveId,
            state: 'COLLECTING',
            capture: { $exists: false },
            history: { $exists: false },
          },
          { $set: { history }, $inc: { __v: 1 } },
          { session },
        )
        .exec();
      if (result.modifiedCount !== 1)
        throw new ConflictError(
          'The history import changed; refresh before retrying',
        );
      return { ...archive, history };
    });
  }

  async source(archive: OwnershipArchive): Promise<OwnershipArchive> {
    if (!archive.history)
      throw new ConflictError('Start the explicit history import first');
    return this.transaction(async (session) => {
      const source = await this.loadSource(
        archive,
        archive.history!.sourceArchiveId,
        session,
      );
      this.assertPinned(archive.history!, source);
      return source;
    });
  }

  async findFile(
    archiveId: string,
    fileId: string,
  ): Promise<ArchiveFile | null> {
    return this.files
      .findOne({ archiveId, id: fileId })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  }

  async checkpoint(
    archiveId: string,
    expected: ArchiveHistoryProgress,
    next: ArchiveHistoryProgress,
  ): Promise<boolean> {
    if (
      next.revision !== expected.revision + 1 ||
      expected.phase !== 'IMPORTING' ||
      !['IMPORTING', 'COMPLETE'].includes(next.phase) ||
      !Number.isSafeInteger(next.entryCount) ||
      next.sourceArchiveId !== expected.sourceArchiveId ||
      next.sourceDefinitionHash !== expected.sourceDefinitionHash ||
      next.expectedEntryCount !== expected.expectedEntryCount ||
      next.expectedFileCount !== expected.expectedFileCount ||
      next.entryCount < expected.entryCount ||
      next.entryCount > expected.expectedEntryCount ||
      (expected.afterId &&
        (!next.afterId ||
          next.afterId < expected.afterId ||
          (next.afterId === expected.afterId && next.phase !== 'COMPLETE')))
    ) {
      throw new ConflictError('Invalid retained history checkpoint');
    }
    return this.transaction(async (session) => {
      // Serialize against append/seal before counting the final persisted page.
      const archive = await this.archives
        .findOne({ id: archiveId })
        .session(session)
        .lean()
        .exec();
      if (!archive)
        throw new ConflictError('The history target archive is missing');
      await fenceArchiveReservation(
        archive,
        this.controls,
        this.periods,
        session,
      );
      const updated = await this.archives
        .updateOne(
          { id: archiveId, state: 'COLLECTING', history: expected },
          { $set: { history: next }, $inc: { __v: 1 } },
          { session },
        )
        .exec();
      if (updated.modifiedCount !== 1) return false;
      if (next.phase === 'COMPLETE') {
        const entryCount = await this.entries
          .countDocuments({ archiveId, kind: 'RETAINED_RECORD' })
          .session(session)
          .exec();
        const fileCount = await this.files
          .countDocuments({
            archiveId,
            'retained.sourceArchiveId': next.sourceArchiveId,
          })
          .session(session)
          .exec();
        if (
          next.entryCount !== next.expectedEntryCount ||
          entryCount !== next.expectedEntryCount ||
          fileCount !== next.expectedFileCount
        ) {
          throw new ConflictError(
            'Retained history is incomplete; refusing completion',
          );
        }
      }
      return true;
    });
  }

  private assertPinned(
    history: ArchiveHistoryProgress,
    source: OwnershipArchive,
  ): void {
    if (
      history.sourceDefinitionHash !== source.definitionHash ||
      history.expectedEntryCount !== source.expectedEntryCount ||
      history.expectedFileCount !== source.expectedFileCount
    ) {
      throw new ConflictError('The retained history source definition changed');
    }
  }

  private async loadSource(
    destination: OwnershipArchive,
    sourceId: string,
    session: ClientSession,
  ): Promise<OwnershipArchive> {
    const source = await this.archives
      .findOne({ id: sourceId })
      .session(session)
      .lean()
      .exec();
    const active = await this.periods
      .findOne({
        id: destination.periodId,
        animalId: destination.animalId,
        ownerId: destination.ownerId,
        ownershipVersion: destination.ownershipVersion,
        status: 'ACTIVE',
      })
      .session(session)
      .lean()
      .exec();
    const previous = await this.periods
      .find({
        animalId: destination.animalId,
        ownershipVersion: destination.ownershipVersion - 1,
      })
      .limit(2)
      .session(session)
      .lean()
      .exec();
    const period = previous[0];
    if (
      !source ||
      !active ||
      previous.length !== 1 ||
      period.status !== AnimalOwnershipPeriodStatus.Closed ||
      !period.endedAt ||
      period.archiveId !== source.id ||
      source.periodId !== period.id ||
      source.ownerId !== period.ownerId ||
      source.animalId !== destination.animalId ||
      source.ownershipVersion !== destination.ownershipVersion - 1 ||
      source.recipientId !== destination.ownerId ||
      active.sourceTransferId !== source.transferId ||
      source.id === destination.id ||
      source.state !== 'READY' ||
      !Number.isSafeInteger(source.expectedEntryCount) ||
      source.expectedEntryCount! < 1 ||
      !Number.isSafeInteger(source.expectedFileCount) ||
      source.expectedFileCount! < 0 ||
      (source.capture && source.capture.phase !== 'COMPLETE') ||
      (source.ownershipVersion > 1 &&
        (!source.history ||
          source.history.phase !== 'COMPLETE' ||
          source.history.entryCount !== source.history.expectedEntryCount))
    ) {
      throw new ConflictError(
        'History import requires the effective immediate predecessor, not merely a READY archive',
      );
    }
    const entries = await this.entries
      .countDocuments({ archiveId: source.id })
      .session(session)
      .exec();
    const files = await this.files
      .countDocuments({ archiveId: source.id })
      .session(session)
      .exec();
    const profiles = await this.entries
      .countDocuments({ archiveId: source.id, kind: 'ANIMAL' })
      .session(session)
      .exec();
    const pending = await this.files
      .exists({ archiveId: source.id, state: { $ne: 'VERIFIED' } })
      .session(session)
      .exec();
    if (
      profiles !== 1 ||
      entries !== source.expectedEntryCount ||
      files !== source.expectedFileCount ||
      pending
    ) {
      throw new ConflictError(
        'The retained predecessor has an incomplete manifest',
      );
    }
    if (source.history) {
      const retainedEntries = await this.entries
        .countDocuments({ archiveId: source.id, kind: 'RETAINED_RECORD' })
        .session(session)
        .exec();
      const retainedFiles = await this.files
        .countDocuments({
          archiveId: source.id,
          'retained.sourceArchiveId': source.history.sourceArchiveId,
        })
        .session(session)
        .exec();
      if (
        retainedEntries !== source.history.expectedEntryCount ||
        retainedFiles !== source.history.expectedFileCount
      )
        throw new ConflictError('The predecessor omitted retained antecedents');
    }
    return source;
  }

  private async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.archives.db.startSession();
    try {
      return await session.withTransaction(() => work(session), {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      });
    } finally {
      await session.endSession();
    }
  }
}
