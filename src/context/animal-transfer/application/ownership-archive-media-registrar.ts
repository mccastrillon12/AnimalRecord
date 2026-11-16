import { Inject, Injectable } from '@nestjs/common';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  ArchiveMediaRegistration,
  OwnershipArchiveMediaRegistrationRepository,
} from '../domain/ownership-archive-media-registration';

/** Internal per-file evidence registration. No publication, upload or activation API. */
@Injectable()
export class OwnershipArchiveMediaRegistrar {
  constructor(
    @Inject('OwnershipArchiveMediaRegistrationRepository')
    private readonly repository: OwnershipArchiveMediaRegistrationRepository,
  ) {}

  async registerFile(
    archiveId: string,
    fileId: string,
  ): Promise<ArchiveMediaRegistration> {
    new Uuid(archiveId);
    if (
      typeof fileId !== 'string' ||
      fileId.length !== 64 ||
      !/^[a-f0-9]+$/.test(fileId)
    )
      throw new InvalidArgumentError('A canonical archive file ID is required');
    return this.repository.registerFile(archiveId, fileId);
  }
}
