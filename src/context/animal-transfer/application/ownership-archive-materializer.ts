import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { OwnershipArchive } from '../domain/ownership-archive';
import {
  OwnershipArchiveMaterializationRepository,
  OwnershipArchiveMaterializationStorage,
} from '../domain/ownership-archive-materialization';

/** Internal only: copies final objects, never activates references or changes owner. */
@Injectable()
export class OwnershipArchiveMaterializer {
  constructor(
    @Inject('OwnershipArchiveMaterializationRepository')
    private readonly repository: OwnershipArchiveMaterializationRepository,
    @Inject('OwnershipArchiveMaterializationStorage')
    private readonly storage: OwnershipArchiveMaterializationStorage,
  ) {}
  async start(archiveId: string): Promise<OwnershipArchive> {
    new Uuid(archiveId);
    return this.repository.start(archiveId);
  }
  async copyBatch(
    archiveId: string,
    limit = 5,
  ): Promise<{ processed: number; materialized: boolean }> {
    new Uuid(archiveId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new InvalidArgumentError(
        'Materialization batch size must be between 1 and 20',
      );
    let processed = 0;
    for (; processed < limit; processed++) {
      const now = new Date();
      const token = uuidv4();
      // Work lease only, never a business deadline or evidence of remote completion.
      const intent = await this.repository.claim(
        archiveId,
        token,
        now.toISOString(),
        new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      );
      if (!intent) break;
      try {
        const revision = await this.storage.materialize(intent);
        if (!(await this.repository.complete(intent, token, revision)))
          throw new ConflictError(
            'The materialization worker no longer owns this file lease',
          );
      } catch (error) {
        await this.repository.release(intent, token).catch(() => undefined);
        throw error;
      }
    }
    return {
      processed,
      materialized: await this.repository.markComplete(archiveId),
    };
  }
}
