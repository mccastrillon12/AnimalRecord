import { Inject, Injectable } from '@nestjs/common';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  ArchiveMetadataRevalidation,
  OwnershipArchiveMetadataRevalidationRepository,
} from '../domain/ownership-archive-metadata-revalidation';

/** Database metadata observation only: no S3 verification, publication or commit permission. */
@Injectable()
export class OwnershipArchiveMetadataRevalidator {
  constructor(
    @Inject('OwnershipArchiveMetadataRevalidationRepository')
    private readonly repository: OwnershipArchiveMetadataRevalidationRepository,
  ) {}
  async start(
    id: string,
    archiveId: string,
  ): Promise<ArchiveMetadataRevalidation> {
    new Uuid(id);
    new Uuid(archiveId);
    return this.repository.start(id, archiveId);
  }
  async nextPage(id: string, limit = 20): Promise<ArchiveMetadataRevalidation> {
    new Uuid(id);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new InvalidArgumentError(
        'Metadata revalidation page size must be between 1 and 100',
      );
    return this.repository.nextPage(id, limit);
  }
}
