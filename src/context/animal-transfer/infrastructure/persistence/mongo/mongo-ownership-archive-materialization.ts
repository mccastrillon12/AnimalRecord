import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../../../shared/domain/value-object/Uuid';
import {
  ArchiveEntry,
  ArchiveFile,
  ObjectRevision,
  OwnershipArchive,
  archiveHash,
} from '../../../domain/ownership-archive';
import {
  ARCHIVE_MATERIALIZATION_PROTOCOL,
  ArchiveMaterializationProtocol,
  ArchiveMaterializationIntent,
  OwnershipArchiveMaterializationRepository,
  assertArchiveMaterialization,
  assertMaterializationIntent,
  buildArchiveMaterialization,
  buildArchiveMaterializationIntent,
} from '../../../domain/ownership-archive-materialization';
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

@Injectable()
export class MongoOwnershipArchiveMaterialization implements OwnershipArchiveMaterializationRepository {
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
  async start(
    archiveId: string,
    protocol: ArchiveMaterializationProtocol = ARCHIVE_MATERIALIZATION_PROTOCOL,
  ): Promise<OwnershipArchive> {
    return this.transaction(async (session) => {
      const archive = await this.read(archiveId, session);
      const materialization = buildArchiveMaterialization(archive, protocol);
      await this.fence(archive, session);
      if (archive.materialization) {
        assertArchiveMaterialization(archive);
        if (archive.materialization.protocol !== protocol)
          throw new ConflictError(
            'An issued materialization protocol cannot change',
          );
        return archive;
      }
      const saved = await this.archives
        .updateOne(
          {
            id: archiveId,
            state: 'READY',
            definitionHash: archive.definitionHash,
            materialization: { $exists: false },
          },
          { $set: { materialization }, $inc: { __v: 1 } },
          { session },
        )
        .exec();
      if (saved.modifiedCount !== 1)
        throw new ConflictError(
          'Archive materialization changed; refresh before retrying',
        );
      return { ...archive, materialization };
    });
  }
  async claim(
    archiveId: string,
    token: string,
    now: string,
    until: string,
  ): Promise<ArchiveMaterializationIntent | null> {
    new Uuid(token);
    if (
      !Number.isFinite(Date.parse(now)) ||
      !Number.isFinite(Date.parse(until)) ||
      Date.parse(until) <= Date.parse(now)
    )
      throw new ConflictError('Invalid materialization work lease');
    return this.transaction(async (session) => {
      const archive = await this.read(archiveId, session);
      assertArchiveMaterialization(archive);
      await this.fence(archive, session);
      if (archive.materialization!.phase === 'MATERIALIZED') return null;
      const file = await this.files
        .findOne({
          archiveId,
          state: 'VERIFIED',
          $or: [
            { materialization: { $exists: false } },
            { 'materialization.state': 'PENDING' },
            {
              'materialization.state': 'MATERIALIZING',
              'materialization.leaseUntil': { $lte: now },
            },
          ],
        })
        .sort({ id: 1 })
        .session(session)
        .lean()
        .exec();
      if (!file) return null;
      const intent = await this.intent(archive, file, session);
      if (
        file.materialization &&
        archiveHash(file.materialization.intent) !== archiveHash(intent)
      )
        throw new ConflictError('A materialization intent cannot be replaced');
      const saved = await this.files
        .updateOne(
          {
            id: file.id,
            archiveId,
            state: 'VERIFIED',
            materialization: file.materialization ?? { $exists: false },
          },
          {
            $set: {
              materialization: {
                intent,
                state: 'MATERIALIZING',
                leaseToken: token,
                leaseUntil: until,
              },
            },
          },
          { session },
        )
        .exec();
      if (saved.modifiedCount !== 1)
        throw new ConflictError(
          'The materialization file changed before acquisition',
        );
      return intent;
    });
  }
  async complete(
    intent: ArchiveMaterializationIntent,
    token: string,
    revision: ObjectRevision,
  ): Promise<boolean> {
    assertMaterializationIntent(intent);
    if (!revision.etag || revision.size !== intent.source.size)
      throw new ConflictError('Invalid materialization verification result');
    return this.transaction(async (session) => {
      const archive = await this.read(intent.archiveId, session);
      assertArchiveMaterialization(archive);
      await this.fence(archive, session);
      this.assertDefinition(archive, intent);
      const file = await this.files
        .findOne({ archiveId: intent.archiveId, id: intent.fileId })
        .session(session)
        .lean()
        .exec();
      if (
        !file ||
        file.materialization?.state !== 'MATERIALIZING' ||
        file.materialization.leaseToken !== token
      )
        return false;
      if (
        archiveHash(await this.intent(archive, file, session)) !==
          archiveHash(intent) ||
        archiveHash(file.materialization.intent) !== archiveHash(intent)
      )
        throw new ConflictError(
          'The materialization intent changed before verification',
        );
      const result = await this.files
        .updateOne(
          {
            id: intent.fileId,
            archiveId: intent.archiveId,
            'materialization.state': 'MATERIALIZING',
            'materialization.leaseToken': token,
            'materialization.intent.definitionHash': intent.definitionHash,
          },
          {
            $set: {
              'materialization.state': 'VERIFIED',
              'materialization.verified': revision,
            },
            $unset: {
              'materialization.leaseToken': 1,
              'materialization.leaseUntil': 1,
            },
          },
          { session },
        )
        .exec();
      return result.modifiedCount === 1;
    });
  }
  async release(
    intent: ArchiveMaterializationIntent,
    token: string,
  ): Promise<void> {
    assertMaterializationIntent(intent);
    await this.transaction(async (session) => {
      const archive = await this.read(intent.archiveId, session);
      assertArchiveMaterialization(archive);
      await this.fence(archive, session);
      this.assertDefinition(archive, intent);
      await this.files
        .updateOne(
          {
            id: intent.fileId,
            archiveId: intent.archiveId,
            'materialization.state': 'MATERIALIZING',
            'materialization.leaseToken': token,
            'materialization.intent.definitionHash': intent.definitionHash,
          },
          {
            $set: { 'materialization.state': 'PENDING' },
            $unset: {
              'materialization.leaseToken': 1,
              'materialization.leaseUntil': 1,
            },
          },
          { session },
        )
        .exec();
    });
  }
  async markComplete(archiveId: string): Promise<boolean> {
    return this.transaction(async (session) => {
      const archive = await this.read(archiveId, session);
      assertArchiveMaterialization(archive);
      await this.fence(archive, session);
      const count = await this.files
        .countDocuments({ archiveId })
        .session(session)
        .exec();
      const pending = await this.files
        .exists({
          archiveId,
          $or: [
            { state: { $ne: 'VERIFIED' } },
            { 'materialization.state': { $ne: 'VERIFIED' } },
            {
              'materialization.intent.protocol': {
                $ne: archive.materialization!.protocol,
              },
            },
            {
              'materialization.intent.materializationDefinitionHash': {
                $ne: archive.materialization!.definitionHash,
              },
            },
            { 'materialization.verified.etag': { $in: [null, ''] } },
            {
              $expr: {
                $ne: [
                  '$materialization.verified.size',
                  '$materialization.intent.source.size',
                ],
              },
            },
          ],
        })
        .session(session)
        .exec();
      if (count !== archive.expectedFileCount || pending) {
        if (archive.materialization!.phase === 'MATERIALIZED')
          throw new ConflictError(
            'Recorded materialization no longer matches its manifest',
          );
        return false;
      }
      if (archive.materialization!.phase === 'MATERIALIZED') return true;
      const saved = await this.archives
        .updateOne(
          {
            id: archiveId,
            state: 'READY',
            'materialization.definitionHash':
              archive.materialization!.definitionHash,
            'materialization.phase': 'MATERIALIZING',
          },
          {
            $set: { 'materialization.phase': 'MATERIALIZED' },
            $inc: { __v: 1 },
          },
          { session },
        )
        .exec();
      if (saved.modifiedCount !== 1)
        throw new ConflictError(
          'Archive materialization changed before completion',
        );
      return true;
    });
  }
  private async intent(
    archive: OwnershipArchive,
    file: ArchiveFile,
    session: ClientSession,
  ): Promise<ArchiveMaterializationIntent> {
    const entry = await this.entries
      .findOne({
        archiveId: archive.id,
        'referencePlan.protocol': ARCHIVE_REFERENCE_PLAN_PROTOCOL,
        'referencePlan.definitionHash': archive.definitionHash,
        'referencePlan.bindings.fileId': file.id,
        $expr: { $eq: ['$referencePlan.sourceContentHash', '$contentHash'] },
      })
      .select({ id: 1, referencePlan: 1 })
      .session(session)
      .lean()
      .exec();
    if (!entry?.referencePlan || entry.referencePlan.entryId !== entry.id)
      throw new ConflictError(
        'The archive file has no matching immutable reference plan',
      );
    return buildArchiveMaterializationIntent(
      archive,
      file,
      entry.referencePlan,
    );
  }
  private assertDefinition(
    archive: OwnershipArchive,
    intent: ArchiveMaterializationIntent,
  ): void {
    if (
      archive.materialization!.phase !== 'MATERIALIZING' ||
      archive.materialization!.definitionHash !==
        intent.materializationDefinitionHash
    )
      throw new ConflictError(
        'The archive no longer accepts this materialization work',
      );
  }
  private async read(
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
        'Materialization requires the matching active ownership period',
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
        { $inc: { archiveMaterializationRevision: 1 } },
        { session },
      )
      .exec();
    if (control.modifiedCount !== 1)
      throw new ConflictError(
        'Materialization requires the matching drained transfer reservation',
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
