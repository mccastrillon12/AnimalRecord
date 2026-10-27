import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AnimalOwnershipRepository } from '../domain/animal-ownership';
import {
  archiveDefinitionOnly,
  buildArchiveReservation,
  assertArchiveReservationControl,
} from '../domain/ownership-archive-reservation';
import {
  ArchiveDefinition,
  ArchiveFile,
  ArchiveRecordInput,
  OwnershipArchive,
  OwnershipArchiveRepository,
  OwnershipArchiveStorage,
  archiveHash,
  buildArchiveEntry,
  validateArchiveDefinition,
} from '../domain/ownership-archive';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';

/** Internal preparation only. The caller must first establish a drained, stable cut. */
@Injectable()
export class OwnershipArchivePreparer {
  constructor(
    @Inject('AnimalOwnershipRepository')
    private readonly ownership: AnimalOwnershipRepository,
    @Inject('OwnershipArchiveRepository')
    private readonly repository: OwnershipArchiveRepository,
    @Inject('OwnershipArchiveStorage')
    private readonly storage: OwnershipArchiveStorage,
  ) {}

  async begin(
    definition: ArchiveDefinition,
    captureLiveDossier = false,
    reservationEpoch?: number,
  ): Promise<OwnershipArchive> {
    validateArchiveDefinition(definition);
    const archive: OwnershipArchive = {
      ...archiveDefinitionOnly(definition),
      definitionHash: archiveHash(archiveDefinitionOnly(definition)),
      reservation: buildArchiveReservation(definition, reservationEpoch!),
      state: 'COLLECTING',
      createdAt: new Date().toISOString(),
      ...(captureLiveDossier
        ? { capture: { revision: 0, phase: 'ANIMAL' as const, entryCount: 0 } }
        : {}),
    };
    await this.assertReservation(archive);
    return this.repository.create(archive);
  }

  async append(archiveId: string, input: ArchiveRecordInput): Promise<void> {
    const archive = await this.find(archiveId);
    await this.assertReservation(archive);
    const { entry, files } = buildArchiveEntry(archive, input, (url) =>
      this.storage.keyFromUrl(url),
    );
    const previous = await this.repository.findEntry(archiveId, entry.id);
    if (previous) {
      if (previous.contentHash !== entry.contentHash)
        throw new ConflictError('An archived record cannot be overwritten');
      return;
    }
    if (archive.state !== 'COLLECTING')
      throw new ConflictError('The archive no longer accepts records');
    const manifest: ArchiveFile[] = [];
    for (const file of files) {
      await this.storage.assertTransferSafe(file.sourceKey);
      const source = await this.storage.inspect(file.sourceKey);
      if (!source.etag || !Number.isSafeInteger(source.size) || source.size < 1)
        throw new ConflictError(
          'An archive source object is missing or invalid',
        );
      manifest.push({
        ...file,
        source,
        definitionHash: archiveHash({ ...file, source }),
        state: 'PENDING',
      });
    }
    await this.assertReservation(archive);
    await this.repository.append(archiveId, entry, manifest);
  }

  async seal(archiveId: string, expectedEntryCount: number): Promise<void> {
    if (!Number.isSafeInteger(expectedEntryCount) || expectedEntryCount < 1)
      throw new InvalidArgumentError(
        'The archive must include at least its animal snapshot',
      );
    const archive = await this.find(archiveId);
    await this.assertReservation(archive);
    await this.repository.seal(archiveId, expectedEntryCount);
  }

  /** Bounded, resumable work. No transaction remains open during S3 operations. */
  async copyBatch(
    archiveId: string,
    limit = 10,
  ): Promise<{ processed: number; ready: boolean }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new InvalidArgumentError(
        'Copy batch size must be between 1 and 50',
      );
    const archive = await this.find(archiveId);
    await this.assertReservation(archive);
    if (archive.state === 'READY') return { processed: 0, ready: true };
    if (archive.state !== 'COPYING')
      throw new ConflictError('Seal the archive before copying files');
    let processed = 0;
    for (; processed < limit; processed++) {
      await this.assertReservation(archive);
      const now = new Date();
      const token = uuidv4();
      // Technical worker lease, unrelated to transfer response/expiry rules.
      const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      const file = await this.repository.claimFile(
        archiveId,
        token,
        now.toISOString(),
        leaseUntil,
      );
      if (!file) break;
      try {
        await this.storage.assertTransferSafe(file.sourceKey);
        const verified = await this.storage.copyAndVerify(file);
        await this.assertReservation(archive);
        if (!(await this.repository.completeFile(file.id, token, verified)))
          throw new ConflictError(
            'The copy worker no longer owns this file lease',
          );
      } catch (error) {
        // If persistence is also unavailable, the recorded lease remains
        // reclaimable after its deadline; preserve the original copy failure.
        await this.repository
          .releaseFile(file.id, token)
          .catch(() => undefined);
        throw error;
      }
    }
    await this.assertReservation(archive);
    return {
      processed,
      ready: await this.repository.markReadyIfComplete(archiveId),
    };
  }

  private async find(id: string): Promise<OwnershipArchive> {
    const archive = await this.repository.find(id);
    if (!archive)
      throw new ResourceNotFoundError('Ownership archive not found');
    return archive;
  }

  private async assertReservation(definition: OwnershipArchive): Promise<void> {
    const control = await this.ownership.findControl(definition.animalId);
    assertArchiveReservationControl(definition, control);
  }
}
