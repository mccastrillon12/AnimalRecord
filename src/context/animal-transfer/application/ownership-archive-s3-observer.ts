import { Inject, Injectable } from '@nestjs/common';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ArchiveMetadataRevalidation } from '../domain/ownership-archive-metadata-revalidation';
import {
  ArchiveS3ObservationReceipt,
  OwnershipArchiveS3ObservationRepository,
  OwnershipArchiveS3ObservationStorage,
  assertS3Observation,
  assertS3ObservationItem,
} from '../domain/ownership-archive-s3-observation';

/** Internal read-only remote observations, never an activation/commit permission. */
@Injectable()
export class OwnershipArchiveS3Observer {
  constructor(
    @Inject('OwnershipArchiveS3ObservationRepository')
    private readonly repository: OwnershipArchiveS3ObservationRepository,
    @Inject('OwnershipArchiveS3ObservationStorage')
    private readonly storage: OwnershipArchiveS3ObservationStorage,
  ) {}
  async start(id: string): Promise<ArchiveMetadataRevalidation> {
    new Uuid(id);
    return this.repository.startS3(id);
  }
  async observeBatch(
    id: string,
    limit = 5,
  ): Promise<ArchiveMetadataRevalidation> {
    new Uuid(id);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new InvalidArgumentError(
        'S3 observation batch size must be between 1 and 20',
      );
    const page = await this.repository.s3Page(id, limit);
    assertS3Observation(page.run);
    if (page.run.id !== id || page.limit !== limit || page.items.length > limit)
      throw new ConflictError('Invalid S3 observation work page');
    if (page.run.s3Observation!.phase === 'S3_OBSERVED') return page.run;
    let afterId = page.run.s3Observation!.afterId;
    for (const item of page.items) {
      assertS3ObservationItem(item);
      if (
        item.intent.archiveId !== page.run.archiveId ||
        item.fileId <= (afterId ?? '')
      )
        throw new ConflictError('Invalid S3 observation file scope or cursor');
      afterId = item.fileId;
    }
    const receipts: ArchiveS3ObservationReceipt[] = [];
    // Sequential bounded reads, outside any Mongo transaction; failure never repairs or checkpoints a partial page.
    for (const item of page.items)
      receipts.push(await this.storage.observe(item));
    return this.repository.confirmS3(page, receipts);
  }
}
