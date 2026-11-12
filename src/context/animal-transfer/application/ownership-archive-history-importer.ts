import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { sourceHashValid } from '../domain/transfer-item-historical-observation';
import {
  appendItemManifestEntryDigest,
  ITEM_MANIFEST_ENTRIES_DIGEST_SEED,
} from '../domain/transfer-item-manifest-digest';
import { historicalPutEvidenceTime } from '../domain/transfer-item-historical-put-reconciliation';
import type {
  PublishedHistoryCopyInput,
  PublishedHistoryCopyAttemptInput,
  PublishedHistoryPutDeclarationInput,
} from '../domain/published-history-copy';
import type {
  PublishedHistoryFileVersion,
  PublishedHistoryVersionSource,
} from '../domain/published-ownership-history';

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
    @Optional()
    @Inject('PublishedHistoryVersionSource')
    private readonly published?: PublishedHistoryVersionSource,
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

  async startFromPublished(
    archiveId: string,
    sourceArchiveId: string,
    sourcePublicationHash: string,
  ): Promise<OwnershipArchive> {
    new Uuid(archiveId);
    new Uuid(sourceArchiveId);
    if (!sourceHashValid(sourcePublicationHash))
      throw new ConflictError(
        'A published predecessor requires its exact receipt hash',
      );
    const archive = await this.find(archiveId);
    await this.assertReservation(archive);
    return this.history.start(
      archiveId,
      sourceArchiveId,
      sourcePublicationHash,
    );
  }

  importBatch(archiveId: string): Promise<OwnershipArchive> {
    return this.importPage(archiveId);
  }

  preparePublishedCopy(input: PublishedHistoryCopyInput) {
    if (!this.history.preparePublishedCopy)
      throw new ConflictError(
        'Published history copy preparation is unavailable',
      );
    return this.history.preparePublishedCopy(input, (url) =>
      this.storage.keyFromUrl(url),
    );
  }

  previewPublishedCopyAttempt(input: PublishedHistoryCopyAttemptInput) {
    if (!this.history.previewPublishedCopyAttempt)
      throw new ConflictError(
        'Published history copy attempt preparation is unavailable',
      );
    return this.history.previewPublishedCopyAttempt(input, (url) =>
      this.storage.keyFromUrl(url),
    );
  }

  declarePublishedCopyAttempt(input: PublishedHistoryPutDeclarationInput) {
    if (!this.history.declarePublishedCopyAttempt)
      throw new ConflictError(
        'Published history copy attempt declaration is unavailable',
      );
    return this.history.declarePublishedCopyAttempt(input, (url) =>
      this.storage.keyFromUrl(url),
    );
  }

  importBatchFromPublished(
    archiveId: string,
    requiredThrough: string,
  ): Promise<OwnershipArchive> {
    historicalPutEvidenceTime(requiredThrough);
    if (!this.published)
      throw new ConflictError(
        'The published history version reader is unavailable',
      );
    return this.importPage(archiveId, requiredThrough);
  }

  private async importPage(
    archiveId: string,
    requiredThrough?: string,
  ): Promise<OwnershipArchive> {
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
    const publicationHash = progress.sourcePublicationHash;
    if ((publicationHash === undefined) !== (requiredThrough === undefined))
      throw new ConflictError(
        'The history import path does not match the pinned predecessor',
      );
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
    const entryCount = progress.entryCount + page.length;
    const complete = page.length < PAGE_SIZE;
    if (
      entryCount > progress.expectedEntryCount ||
      (complete && entryCount !== progress.expectedEntryCount)
    )
      throw new ConflictError(
        'The retained source count differs from its sealed cut',
      );
    let afterId = progress.afterId;
    let sourceEntriesDigest = progress.sourceEntriesDigest;
    if (publicationHash !== undefined) {
      if (
        sourceEntriesDigest === undefined &&
        progress.revision === 0 &&
        progress.entryCount === 0 &&
        afterId === undefined
      )
        sourceEntriesDigest = ITEM_MANIFEST_ENTRIES_DIGEST_SEED;
      if (!sourceHashValid(sourceEntriesDigest))
        throw new ConflictError(
          'The published history entry digest is missing',
        );
      sourceEntriesDigest = page.reduce(
        appendItemManifestEntryDigest,
        sourceEntriesDigest,
      );
      if (
        complete &&
        sourceEntriesDigest !== source.manifestDigest?.entriesDigest
      )
        throw new ConflictError(
          'The published history entries differ from the sealed manifest',
        );
    }
    const keyFromUrl = (url: string) => this.storage.keyFromUrl(url);
    for (const original of page) {
      if (!original.id || original.id <= (afterId ?? ''))
        throw new ConflictError('The retained source cursor did not advance');
      const files: ArchiveFile[] = [];
      const versions =
        publicationHash === undefined
          ? undefined
          : new Map<string, PublishedHistoryFileVersion>();
      for (const fileId of new Set(
        original.fileBindings.map((binding) => binding.fileId),
      )) {
        const file = await this.history.findFile(source.id, fileId);
        if (!file)
          throw new ConflictError('A retained file binding is missing');
        files.push(file);
        if (versions) {
          const version = await this.published!.readPublishedHistoryFileVersion(
            {
              actorId: source.ownerId,
              periodId: source.periodId,
              publicationHash: publicationHash!,
              entryId: original.id,
              fileId,
              requiredThrough: requiredThrough!,
            },
            keyFromUrl,
          );
          if (version.requiredThrough !== requiredThrough)
            throw new ConflictError(
              'The published history conservation horizon changed',
            );
          versions.set(fileId, version);
        }
      }
      const retained = buildRetainedArchiveEntry(
        archive,
        source,
        original,
        files,
        keyFromUrl,
        versions,
      );
      await this.assertReservation(archive);
      await this.archives.append(archive.id, retained.entry, retained.files);
      afterId = original.id;
    }
    await this.assertReservation(archive);
    await this.history.checkpoint(archive.id, progress, {
      ...progress,
      revision: progress.revision + 1,
      entryCount,
      phase: complete ? 'COMPLETE' : 'IMPORTING',
      ...(afterId ? { afterId } : {}),
      ...(sourceEntriesDigest === undefined ? {} : { sourceEntriesDigest }),
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
