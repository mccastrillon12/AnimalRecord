import { Inject, Injectable, Logger } from '@nestjs/common';
import { AnimalPrimitiveType } from '../../animal/domain/animal';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';
import { AnimalOwnershipRepository } from '../domain/animal-ownership';
import {
  ArchiveCaptureProgress,
  ArchiveDefinition,
  OwnershipArchive,
  OwnershipArchiveRepository,
  OwnershipArchiveStorage,
  archiveHash,
  buildArchiveEntry,
  validateArchiveDefinition,
} from '../domain/ownership-archive';
import { OwnershipArchiveSource } from '../domain/ownership-archive-source';
import { OwnershipArchivePreparer } from './ownership-archive-preparer';

const PAGE_SIZE = 100;

/** Internal only. Captures Mongo records, NOT an effective transfer or S3 drain. */
@Injectable()
export class OwnershipArchiveCapture {
  private readonly logger = new Logger(OwnershipArchiveCapture.name);

  constructor(
    @Inject('AnimalOwnershipRepository')
    private readonly ownership: AnimalOwnershipRepository,
    @Inject('OwnershipArchiveRepository')
    private readonly repository: OwnershipArchiveRepository,
    @Inject('OwnershipArchiveSource')
    private readonly source: OwnershipArchiveSource,
    @Inject('OwnershipArchiveStorage')
    private readonly storage: OwnershipArchiveStorage,
    private readonly preparer: OwnershipArchivePreparer,
  ) {}

  async start(definition: ArchiveDefinition): Promise<OwnershipArchive> {
    validateArchiveDefinition(definition);
    const existing = await this.repository.find(definition.id);
    if (existing) {
      if (
        existing.definitionHash !== archiveHash(definition) ||
        !existing.capture
      ) {
        throw new ConflictError(
          'The archive belongs to a different capture definition or mode',
        );
      }
      await this.assertReservation(existing);
      return existing;
    }
    // A matching transferId without a persisted capture is NOT permission to
    // join a preflight that another instance may still be running/unlocking.
    await this.readEligibleAnimal(definition);
    const acquired = await this.ownership.acquireTransferLock({
      animalId: definition.animalId,
      ownerId: definition.ownerId,
      expectedOwnershipVersion: definition.ownershipVersion,
      transferId: definition.transferId,
      lockedAt: new Date().toISOString(),
    });
    if (!acquired)
      throw new ConflictError(
        'The animal is busy or reserved; retry capture later',
      );

    let beginAttempted = false;
    try {
      await this.assertReservation(definition);
      const animal = await this.readEligibleAnimal(definition);
      await this.source.assertInitialPeriod(definition);
      await this.assertNoPendingMedicalWork(definition.animalId);
      buildArchiveEntry(definition, { kind: 'ANIMAL', data: animal }, (url) =>
        this.storage.keyFromUrl(url),
      );
      // Validate legacy/foreign/inconsistent accepted records BEFORE creating
      // an archive. Owner must be able to normalize them after a denial.
      let afterId: string | undefined;
      while (true) {
        const page = await this.source.listAcceptedDocuments(
          definition.animalId,
          afterId,
          PAGE_SIZE,
        );
        this.assertPage(page, afterId);
        for (const data of page)
          buildArchiveEntry(
            definition,
            { kind: 'MEDICAL_DOCUMENT', data },
            (url) => this.storage.keyFromUrl(url),
          );
        if (page.length < PAGE_SIZE) break;
        afterId = page[page.length - 1].id;
        await this.assertReservation(definition);
      }
      await this.assertReservation(definition);
      // From here persistence may have succeeded even if acknowledgement fails.
      // Never unlock a possibly started archive; retry the same definition.
      beginAttempted = true;
      return await this.preparer.begin(definition, true);
    } catch (error) {
      if (!beginAttempted) {
        try {
          if (
            !(await this.ownership.releaseTransferLock(
              definition.animalId,
              definition.transferId,
            ))
          ) {
            this.logger.warn(
              `Capture preflight reservation recovery required for animal ${definition.animalId}`,
            );
          }
        } catch {
          this.logger.warn(
            `Capture preflight reservation recovery required for animal ${definition.animalId}`,
          );
        }
      }
      throw error;
    }
  }

  /** One persisted cursor step, at most 100 records, replay-safe after any failure. */
  async captureBatch(archiveId: string): Promise<OwnershipArchive> {
    const archive = await this.find(archiveId);
    const progress = this.progress(archive);
    await this.assertReservation(archive);
    if (archive.state !== 'COLLECTING') {
      if (progress.phase !== 'COMPLETE')
        throw new ConflictError('The live dossier capture has not completed');
      return archive;
    }
    await this.source.assertInitialPeriod(archive);
    const animal = await this.readEligibleAnimal(archive);
    await this.assertNoPendingMedicalWork(archive.animalId);
    if (progress.phase === 'COMPLETE') {
      await this.preparer.seal(archiveId, progress.entryCount);
      return this.find(archiveId);
    }

    let next: ArchiveCaptureProgress;
    if (progress.phase === 'ANIMAL') {
      await this.preparer.append(archiveId, { kind: 'ANIMAL', data: animal });
      next = { revision: progress.revision + 1, phase: 'DIARY', entryCount: 1 };
    } else {
      let page: Array<{ id: string }>;
      if (progress.phase === 'DIARY') {
        const records = await this.source.listDiary(
          archive.animalId,
          progress.afterId,
          PAGE_SIZE,
        );
        this.assertPage(records, progress.afterId);
        for (const data of records) {
          await this.preparer.append(archiveId, { kind: 'DIARY_ENTRY', data });
        }
        page = records;
      } else {
        const records = await this.source.listAcceptedDocuments(
          archive.animalId,
          progress.afterId,
          PAGE_SIZE,
        );
        this.assertPage(records, progress.afterId);
        for (const data of records) {
          await this.preparer.append(archiveId, {
            kind: 'MEDICAL_DOCUMENT',
            data,
          });
        }
        page = records;
      }
      next = {
        revision: progress.revision + 1,
        entryCount: progress.entryCount + page.length,
        phase:
          page.length < PAGE_SIZE
            ? progress.phase === 'DIARY'
              ? 'MEDICAL'
              : 'COMPLETE'
            : progress.phase,
        ...(page.length === PAGE_SIZE
          ? { afterId: page[page.length - 1].id }
          : {}),
      };
    }
    await this.assertReservation(archive);
    // A stale concurrent worker may replay records but cannot regress progress.
    await this.repository.checkpointCapture(archiveId, progress.revision, next);
    return this.find(archiveId);
  }

  private async find(id: string): Promise<OwnershipArchive> {
    const archive = await this.repository.find(id);
    if (!archive)
      throw new ResourceNotFoundError('Ownership archive not found');
    return archive;
  }

  private progress(archive: OwnershipArchive): ArchiveCaptureProgress {
    const progress = archive.capture;
    if (
      !progress ||
      !Number.isSafeInteger(progress.revision) ||
      progress.revision < 0 ||
      !Number.isSafeInteger(progress.entryCount) ||
      progress.entryCount < 0 ||
      !['ANIMAL', 'DIARY', 'MEDICAL', 'COMPLETE'].includes(progress.phase)
    ) {
      throw new ConflictError('The archive has no valid live capture progress');
    }
    return progress;
  }

  private assertPage(
    page: Array<{ id: string }>,
    afterId: string | undefined,
  ): void {
    let previous = afterId ?? '';
    if (page.length > PAGE_SIZE)
      throw new ConflictError('The capture source exceeded its page limit');
    for (const record of page) {
      if (!record.id || record.id <= previous)
        throw new ConflictError('The capture source cursor did not advance');
      previous = record.id;
    }
  }

  private async readEligibleAnimal(
    definition: ArchiveDefinition,
  ): Promise<AnimalPrimitiveType> {
    const animal = await this.source.findAnimal(definition.animalId);
    if (!animal) throw new ResourceNotFoundError('Animal not found');
    if (
      animal.id !== definition.animalId ||
      animal.ownerId !== definition.ownerId ||
      animal.isActive === false
    ) {
      throw new ConflictError(
        'Capture requires the active animal and expected owner',
      );
    }
    return animal;
  }

  private async assertNoPendingMedicalWork(animalId: string): Promise<void> {
    if (await this.source.hasPendingMedicalWork(animalId))
      throw new ConflictError(
        'Finish or discard pending medical analysis and review before transfer capture',
      );
  }

  private async assertReservation(
    definition: ArchiveDefinition,
  ): Promise<void> {
    const control = await this.ownership.findControl(definition.animalId);
    if (
      !control ||
      control.ownerId !== definition.ownerId ||
      control.ownershipVersion !== definition.ownershipVersion ||
      control.transferLock?.transferId !== definition.transferId ||
      control.activeWrites?.length
    ) {
      throw new ConflictError(
        'Capture requires the matching drained transfer reservation',
      );
    }
  }
}
