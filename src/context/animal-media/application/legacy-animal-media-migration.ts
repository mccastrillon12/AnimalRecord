import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import {
  LegacyMediaCopier,
  LegacyMediaMigrationRepository,
  MediaMigration,
  MediaMigrationDefinition,
  MediaMigrationStop,
} from '../domain/legacy-media-migration';

@Injectable()
export class LegacyAnimalMediaMigration {
  constructor(
    @Inject('LegacyMediaMigrationRepository')
    private readonly jobs: LegacyMediaMigrationRepository,
    @Inject('LegacyMediaCopier') private readonly copier: LegacyMediaCopier,
  ) {}

  async start(definition: MediaMigrationDefinition): Promise<MediaMigration> {
    if (
      ![definition.id, definition.animalId, definition.ownerId].every(isUuid) ||
      !Number.isSafeInteger(definition.ownershipVersion) ||
      definition.ownershipVersion < 1
    )
      throw new InvalidArgumentError('Invalid media migration definition');
    return this.jobs.start(definition);
  }

  async migrateBatch(id: string): Promise<MediaMigration> {
    const job = await this.jobs.find(id);
    if (!job) throw new ResourceNotFoundError('Media migration not found');
    if (job.phase === 'COMPLETED' || job.phase === 'STOPPED') return job;
    const page = await this.jobs.readPage(job, 20);
    const changes = [];
    for (const reference of page.references) {
      const afterUrl = await this.copier.prepare(job, reference);
      if (afterUrl !== reference.url)
        changes.push({ before: reference, afterUrl });
    }
    await this.jobs.commitPage(job, page, changes);
    const persisted = await this.jobs.find(id);
    if (!persisted)
      throw new ConflictError('The media migration checkpoint is missing');
    return persisted;
  }

  /** Technical intervention only; not transfer cancellation or a force-unlock. */
  async stopForRecovery(input: MediaMigrationStop): Promise<MediaMigration> {
    if (
      ![input.id, input.requestId, input.operatorId].every(isUuid) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !['SOURCE_REVISION_UNAVAILABLE', 'OPERATOR_INTERVENTION'].includes(
        input.reason,
      ) ||
      typeof input.evidenceRef !== 'string' ||
      input.evidenceRef.trim() !== input.evidenceRef ||
      input.evidenceRef.length < 1 ||
      input.evidenceRef.length > 200 ||
      /[\r\n]/.test(input.evidenceRef)
    )
      throw new InvalidArgumentError(
        'Invalid explicit migration recovery request',
      );
    return this.jobs.stopForRecovery(input);
  }
}
