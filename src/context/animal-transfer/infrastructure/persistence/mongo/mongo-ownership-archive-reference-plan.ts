import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../../../shared/domain/errors/ResourceNotFoundError';
import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchive,
  archiveHash,
} from '../../../domain/ownership-archive';
import {
  ARCHIVE_REFERENCE_PLAN_PROTOCOL,
  ArchiveEntryReferencePlan,
  ArchiveReferencePlanProgress,
  OwnershipArchiveReferencePlanRepository,
  assertReferencePlanArchive,
  assertReferencePlanProgress,
} from '../../../domain/ownership-archive-reference-plan';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
} from './ownership-archive.schema';

@Injectable()
export class MongoOwnershipArchiveReferencePlan implements OwnershipArchiveReferencePlanRepository {
  constructor(
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(OWNERSHIP_ARCHIVE_ENTRY_MODEL)
    private readonly entries: Model<ArchiveEntry>,
    @InjectModel(OWNERSHIP_ARCHIVE_FILE_MODEL)
    private readonly files: Model<ArchiveFile>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
  ) {}

  async find(archiveId: string): Promise<OwnershipArchive | null> {
    return this.archives
      .findOne({ id: archiveId })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
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
  async start(archiveId: string): Promise<OwnershipArchive> {
    return this.transaction(async (session) => {
      const archive = await this.readArchive(archiveId, session);
      await this.fence(archive, session);
      if (archive.referencePlan) {
        assertReferencePlanProgress(archive, archive.referencePlan);
        return archive;
      }
      const referencePlan: ArchiveReferencePlanProgress = {
        protocol: ARCHIVE_REFERENCE_PLAN_PROTOCOL,
        definitionHash: archive.definitionHash,
        revision: 0,
        phase: 'PLANNING',
        entryCount: 0,
      };
      const updated = await this.archives
        .updateOne(
          {
            id: archiveId,
            state: 'READY',
            definitionHash: archive.definitionHash,
            referencePlan: { $exists: false },
          },
          { $set: { referencePlan }, $inc: { __v: 1 } },
          { session },
        )
        .exec();
      if (updated.modifiedCount !== 1)
        throw new ConflictError(
          'The archive reference plan changed; refresh before retrying',
        );
      return { ...archive, referencePlan };
    });
  }

  async savePage(
    archiveId: string,
    expected: ArchiveReferencePlanProgress,
    plans: ArchiveEntryReferencePlan[],
    next: ArchiveReferencePlanProgress,
  ): Promise<boolean> {
    if (
      expected.protocol !== ARCHIVE_REFERENCE_PLAN_PROTOCOL ||
      expected.phase !== 'PLANNING' ||
      next.protocol !== expected.protocol ||
      next.definitionHash !== expected.definitionHash ||
      next.revision !== expected.revision + 1 ||
      plans.length > 100 ||
      next.entryCount !== expected.entryCount + plans.length ||
      next.phase !== (plans.length < 100 ? 'PLANNED' : 'PLANNING')
    )
      throw new ConflictError('Invalid reference plan checkpoint');
    let afterId = expected.afterId;
    for (const plan of plans) {
      const { planHash, ...definition } = plan;
      if (
        plan.protocol !== expected.protocol ||
        plan.archiveId !== archiveId ||
        plan.definitionHash !== expected.definitionHash ||
        planHash !== archiveHash(definition) ||
        plan.entryId <= (afterId ?? '')
      )
        throw new ConflictError('Invalid reference plan page');
      afterId = plan.entryId;
    }
    if (next.afterId !== afterId)
      throw new ConflictError('Invalid reference plan cursor');
    return this.transaction(async (session) => {
      const archive = await this.readArchive(archiveId, session);
      if (
        archive.definitionHash !== expected.definitionHash ||
        archiveHash(archive.referencePlan) !== archiveHash(expected)
      )
        return false;
      assertReferencePlanProgress(archive, expected);
      assertReferencePlanProgress(archive, next);
      await this.fence(archive, session);
      const advanced = await this.archives
        .updateOne(
          {
            id: archiveId,
            state: 'READY',
            definitionHash: expected.definitionHash,
            referencePlan: expected,
          },
          { $set: { referencePlan: next }, $inc: { __v: 1 } },
          { session },
        )
        .exec();
      if (advanced.modifiedCount !== 1) return false;
      for (const plan of plans) {
        const written = await this.entries
          .updateOne(
            {
              archiveId,
              id: plan.entryId,
              contentHash: plan.sourceContentHash,
              $or: [
                { referencePlan: { $exists: false } },
                { 'referencePlan.planHash': plan.planHash },
              ],
            },
            { $set: { referencePlan: plan } },
            { session },
          )
          .exec();
        if (written.matchedCount !== 1)
          throw new ConflictError(
            'An archived entry changed or already has a different reference plan',
          );
      }
      if (next.phase === 'PLANNED')
        await this.assertComplete(archive, next, session);
      return true;
    });
  }

  private async readArchive(
    id: string,
    session: ClientSession,
  ): Promise<OwnershipArchive> {
    const archive = await this.archives
      .findOne({ id })
      .session(session)
      .lean()
      .exec();
    if (!archive)
      throw new ResourceNotFoundError('Ownership archive not found');
    assertReferencePlanArchive(archive);
    return archive;
  }
  private async fence(
    archive: OwnershipArchive,
    session: ClientSession,
  ): Promise<void> {
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
        'Reference planning requires the matching active period',
      );
    const control = await this.controls
      .updateOne(
        {
          animalId: archive.animalId,
          ownerId: archive.ownerId,
          ownershipVersion: archive.ownershipVersion,
          'transferLock.transferId': archive.transferId,
          $expr: { $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0] },
        },
        { $inc: { archiveReferencePlanRevision: 1 } },
        { session },
      )
      .exec();
    if (control.modifiedCount !== 1)
      throw new ConflictError(
        'Reference planning requires the matching drained transfer reservation',
      );
  }
  private async assertComplete(
    archive: OwnershipArchive,
    progress: ArchiveReferencePlanProgress,
    session: ClientSession,
  ): Promise<void> {
    const entryCount = await this.entries
      .countDocuments({ archiveId: archive.id })
      .session(session)
      .exec();
    const profiles = await this.entries
      .countDocuments({ archiveId: archive.id, kind: 'ANIMAL' })
      .session(session)
      .exec();
    const planned = await this.entries
      .countDocuments({
        archiveId: archive.id,
        'referencePlan.protocol': ARCHIVE_REFERENCE_PLAN_PROTOCOL,
        'referencePlan.definitionHash': archive.definitionHash,
        $expr: { $eq: ['$referencePlan.sourceContentHash', '$contentHash'] },
      })
      .session(session)
      .exec();
    const fileCount = await this.files
      .countDocuments({ archiveId: archive.id })
      .session(session)
      .exec();
    const pending = await this.files
      .exists({ archiveId: archive.id, state: { $ne: 'VERIFIED' } })
      .session(session)
      .exec();
    const referenced = await this.entries
      .aggregate<{ count: number }>([
        { $match: { archiveId: archive.id } },
        { $unwind: '$fileBindings' },
        { $group: { _id: '$fileBindings.fileId' } },
        { $count: 'count' },
      ])
      .session(session)
      .exec();
    if (archive.history) {
      const retainedEntries = await this.entries
        .countDocuments({ archiveId: archive.id, kind: 'RETAINED_RECORD' })
        .session(session)
        .exec();
      const retainedFiles = await this.files
        .countDocuments({
          archiveId: archive.id,
          'retained.sourceArchiveId': archive.history.sourceArchiveId,
        })
        .session(session)
        .exec();
      if (
        retainedEntries !== archive.history.expectedEntryCount ||
        retainedFiles !== archive.history.expectedFileCount
      )
        throw new ConflictError(
          'The archive reference plan omitted retained history',
        );
    }
    if (
      progress.entryCount !== archive.expectedEntryCount ||
      entryCount !== archive.expectedEntryCount ||
      planned !== entryCount ||
      profiles !== 1 ||
      fileCount !== archive.expectedFileCount ||
      (referenced[0]?.count ?? 0) !== fileCount ||
      pending
    )
      throw new ConflictError(
        'The archive reference plan or its manifest is incomplete',
      );
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
