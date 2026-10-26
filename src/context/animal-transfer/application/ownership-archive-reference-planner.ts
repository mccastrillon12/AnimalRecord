import { Inject, Injectable } from '@nestjs/common';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { AnimalOwnershipRepository } from '../domain/animal-ownership';
import {
  ArchiveFile,
  OwnershipArchive,
  OwnershipArchiveRepository,
  OwnershipArchiveStorage,
} from '../domain/ownership-archive';
import {
  ArchiveEntryReferencePlan,
  OwnershipArchiveReferencePlanRepository,
  assertReferencePlanArchive,
  assertReferencePlanProgress,
  buildArchiveEntryReferencePlan,
} from '../domain/ownership-archive-reference-plan';

/** Plan only. Never activates files/references, publishes, or changes ownership. */
@Injectable()
export class OwnershipArchiveReferencePlanner {
  constructor(
    @Inject('AnimalOwnershipRepository')
    private readonly ownership: AnimalOwnershipRepository,
    @Inject('OwnershipArchiveRepository')
    private readonly archives: OwnershipArchiveRepository,
    @Inject('OwnershipArchiveReferencePlanRepository')
    private readonly plans: OwnershipArchiveReferencePlanRepository,
    @Inject('OwnershipArchiveStorage')
    private readonly storage: OwnershipArchiveStorage,
  ) {}

  async start(archiveId: string): Promise<OwnershipArchive> {
    new Uuid(archiveId);
    return this.plans.start(archiveId);
  }

  async planBatch(archiveId: string): Promise<OwnershipArchive> {
    new Uuid(archiveId);
    const archive = await this.find(archiveId);
    assertReferencePlanArchive(archive);
    await this.assertReservation(archive);
    const progress = archive.referencePlan;
    assertReferencePlanProgress(archive, progress);
    if (progress.phase === 'PLANNED') {
      if (progress.entryCount !== archive.expectedEntryCount)
        throw new ConflictError('The reference plan is incomplete');
      return archive;
    }
    const page = await this.archives.listEntries(
      archiveId,
      progress.afterId,
      100,
    );
    if (page.length > 100)
      throw new ConflictError('Reference plan page exceeded its limit');
    let afterId = progress.afterId;
    const plans: ArchiveEntryReferencePlan[] = [];
    for (const entry of page) {
      if (!entry.id || entry.id <= (afterId ?? ''))
        throw new ConflictError('Reference plan cursor did not advance');
      const files: ArchiveFile[] = [];
      for (const id of new Set(entry.fileBindings.map((b) => b.fileId))) {
        const file = await this.plans.findFile(archiveId, id);
        if (!file) throw new ConflictError('Reference plan file is missing');
        files.push(file);
      }
      plans.push(
        buildArchiveEntryReferencePlan(archive, entry, files, (url) =>
          this.storage.keyFromUrl(url),
        ),
      );
      afterId = entry.id;
    }
    const entryCount = progress.entryCount + page.length;
    if (
      entryCount > archive.expectedEntryCount! ||
      (page.length < 100 && entryCount !== archive.expectedEntryCount)
    )
      throw new ConflictError(
        'Reference plan count differs from the sealed cut',
      );
    await this.plans.savePage(archiveId, progress, plans, {
      ...progress,
      revision: progress.revision + 1,
      entryCount,
      phase: page.length < 100 ? 'PLANNED' : 'PLANNING',
      ...(afterId ? { afterId } : {}),
    });
    return this.find(archiveId);
  }

  private async find(id: string): Promise<OwnershipArchive> {
    const archive = await this.plans.find(id);
    if (!archive)
      throw new ResourceNotFoundError('Ownership archive not found');
    return archive;
  }
  private async assertReservation(archive: OwnershipArchive): Promise<void> {
    const control = await this.ownership.findControl(archive.animalId);
    if (
      !control ||
      control.ownerId !== archive.ownerId ||
      control.ownershipVersion !== archive.ownershipVersion ||
      control.transferLock?.transferId !== archive.transferId ||
      control.activeWrites?.length
    )
      throw new ConflictError(
        'Reference planning requires the matching drained transfer reservation',
      );
  }
}
