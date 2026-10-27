import { Inject, Injectable } from '@nestjs/common';
import { assertArchiveReservationControl } from '../domain/ownership-archive-reservation';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { AnimalOwnershipRepository } from '../domain/animal-ownership';
import {
  ArchiveFile,
  OwnershipArchive,
  OwnershipArchiveRepository,
  OwnershipArchiveStorage,
} from '../domain/ownership-archive';
import {
  buildRetainedArchiveEntry,
  OwnershipArchiveHistoryRepository,
} from '../domain/ownership-archive-history';

const PAGE_SIZE = 100;

/** Explicit internal import only. Does not publish, activate, unlock, or transfer. */
@Injectable()
export class OwnershipArchiveHistoryImporter {
  constructor(
    @Inject('AnimalOwnershipRepository')
    private readonly ownership: AnimalOwnershipRepository,
    @Inject('OwnershipArchiveRepository')
    private readonly archives: OwnershipArchiveRepository,
    @Inject('OwnershipArchiveHistoryRepository')
    private readonly history: OwnershipArchiveHistoryRepository,
    @Inject('OwnershipArchiveStorage')
    private readonly storage: OwnershipArchiveStorage,
  ) {}

  async start(
    archiveId: string,
    sourceArchiveId: string,
  ): Promise<OwnershipArchive> {
    new Uuid(archiveId);
    new Uuid(sourceArchiveId);
    const archive = await this.find(archiveId);
    await this.assertReservation(archive);
    return this.history.start(archiveId, sourceArchiveId);
  }

  async importBatch(archiveId: string): Promise<OwnershipArchive> {
    new Uuid(archiveId);
    const archive = await this.find(archiveId);
    await this.assertReservation(archive);
    const progress = archive.history;
    if (
      !progress ||
      archive.capture ||
      !Number.isSafeInteger(progress.revision) ||
      progress.revision < 0 ||
      !Number.isSafeInteger(progress.entryCount) ||
      progress.entryCount < 0 ||
      !['IMPORTING', 'COMPLETE'].includes(progress.phase)
    )
      throw new ConflictError('No valid explicit retained history import');
    const source = await this.history.source(archive);
    if (progress.phase === 'COMPLETE') return archive;
    if (archive.state !== 'COLLECTING')
      throw new ConflictError('The archive no longer accepts retained history');
    const page = await this.archives.listEntries(
      source.id,
      progress.afterId,
      PAGE_SIZE,
    );
    if (page.length > PAGE_SIZE)
      throw new ConflictError('The retained source exceeded its page limit');
    let afterId = progress.afterId;
    for (const original of page) {
      if (!original.id || original.id <= (afterId ?? ''))
        throw new ConflictError('The retained source cursor did not advance');
      const files: ArchiveFile[] = [];
      for (const fileId of new Set(
        original.fileBindings.map((binding) => binding.fileId),
      )) {
        const file = await this.history.findFile(source.id, fileId);
        if (!file)
          throw new ConflictError('A retained file binding is missing');
        files.push(file);
      }
      const retained = buildRetainedArchiveEntry(
        archive,
        source,
        original,
        files,
        (url) => this.storage.keyFromUrl(url),
      );
      await this.assertReservation(archive);
      await this.archives.append(archive.id, retained.entry, retained.files);
      afterId = original.id;
    }
    const entryCount = progress.entryCount + page.length;
    if (
      entryCount > progress.expectedEntryCount ||
      (page.length < PAGE_SIZE && entryCount !== progress.expectedEntryCount)
    ) {
      throw new ConflictError(
        'The retained source count differs from its sealed cut',
      );
    }
    await this.assertReservation(archive);
    await this.history.checkpoint(archive.id, progress, {
      ...progress,
      revision: progress.revision + 1,
      entryCount,
      phase: page.length < PAGE_SIZE ? 'COMPLETE' : 'IMPORTING',
      ...(afterId ? { afterId } : {}),
    });
    return this.find(archive.id);
  }

  private async find(id: string): Promise<OwnershipArchive> {
    const archive = await this.archives.find(id);
    if (!archive)
      throw new ResourceNotFoundError('Ownership archive not found');
    return archive;
  }

  private async assertReservation(archive: OwnershipArchive): Promise<void> {
    const control = await this.ownership.findControl(archive.animalId);
    assertArchiveReservationControl(archive, control);
    if (
      !control ||
      control.ownerId !== archive.ownerId ||
      control.ownershipVersion !== archive.ownershipVersion ||
      control.transferLock?.transferId !== archive.transferId ||
      control.activeWrites?.length
    ) {
      throw new ConflictError(
        'History import requires the matching drained transfer reservation',
      );
    }
  }
}
