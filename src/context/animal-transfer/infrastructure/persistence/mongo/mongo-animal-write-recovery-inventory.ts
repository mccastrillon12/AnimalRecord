import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AnimalOwnershipControlEntity } from './animal-ownership.schema';
import { LEGACY_MEDIA_MIGRATION_MODEL } from '../../../../animal-media/infrastructure/mongo-legacy-media-migration-repository';
import { MediaMigration } from '../../../../animal-media/domain/legacy-media-migration';
import {
  AnimalWriteRecoveryInventoryRepository,
  WriteRecoveryObservation,
} from '../../../domain/animal-write-recovery-inventory';
import { InvalidArgumentError } from '../../../../shared/domain/errors/InvalidArgumentError';

@Injectable()
export class MongoAnimalWriteRecoveryInventory implements AnimalWriteRecoveryInventoryRepository {
  constructor(
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(LEGACY_MEDIA_MIGRATION_MODEL)
    private readonly jobs: Model<MediaMigration>,
  ) {}

  async list(
    afterAnimalId: string | undefined,
    limit: number,
  ): Promise<WriteRecoveryObservation[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 51)
      throw new InvalidArgumentError('Invalid inventory page size');
    const controls = await this.controls
      .find({
        ...(afterAnimalId ? { animalId: { $gt: afterAnimalId } } : {}),
        $or: [
          { 'activeWrites.0': { $exists: true } },
          { transferLock: { $exists: true } },
        ],
      })
      .select({
        _id: 0,
        animalId: 1,
        ownerId: 1,
        ownershipVersion: 1,
        activeWrites: 1,
        uploadsValidUntil: 1,
        transferLock: 1,
      })
      .sort({ animalId: 1 })
      .limit(limit)
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
    const migrationId = (transferId: unknown): string | undefined =>
      typeof transferId === 'string' &&
      transferId.startsWith('media-migration:')
        ? transferId.slice('media-migration:'.length)
        : undefined;
    const ids = [
      ...new Set(
        controls
          .map((c) => migrationId(c.transferLock?.transferId))
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const jobs = ids.length
      ? await this.jobs
          .find({ id: { $in: ids } })
          .select({
            _id: 0,
            id: 1,
            animalId: 1,
            ownerId: 1,
            ownershipVersion: 1,
            phase: 1,
            revision: 1,
            afterId: 1,
          })
          .read('primary')
          .readConcern('majority')
          .lean()
          .exec()
      : [];
    const byId = new Map(jobs.map((job) => [job.id, job]));
    return controls.map((control) => {
      const id = migrationId(control.transferLock?.transferId);
      if (id === undefined) return { control, migrationLink: 'NOT_MIGRATION' };
      const job = byId.get(id);
      if (!job) return { control, migrationLink: 'MISSING' };
      if (
        job.animalId !== control.animalId ||
        job.ownerId !== control.ownerId ||
        job.ownershipVersion !== control.ownershipVersion
      )
        return { control, migrationLink: 'MISMATCH' };
      return {
        control,
        migrationLink: 'MATCHED',
        migration: {
          id: job.id,
          animalId: job.animalId,
          ownerId: job.ownerId,
          ownershipVersion: job.ownershipVersion,
          phase: job.phase,
          revision: job.revision,
          ...(job.afterId ? { afterId: job.afterId } : {}),
        },
      };
    });
  }
}
