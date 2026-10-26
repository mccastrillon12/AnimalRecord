import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { assertReservedEpoch } from '../../../domain/reservation-epoch';
import { ResourceNotFoundError } from '../../../../shared/domain/errors/ResourceNotFoundError';
import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchive,
  OwnershipArchiveStorage,
  archiveHash,
} from '../../../domain/ownership-archive';
import {
  ArchiveMediaRegistration,
  assertMediaRegistrationArchive,
  assertSameMediaRegistration,
  buildArchiveMediaRegistration,
} from '../../../domain/ownership-archive-media-registration';
import {
  ArchiveMetadataRevalidation,
  ARCHIVE_METADATA_REVALIDATION_PROTOCOL,
  OwnershipArchiveMetadataRevalidationRepository,
  assertMetadataRevalidation,
  metadataRevalidationDefinition,
} from '../../../domain/ownership-archive-metadata-revalidation';
import { buildArchiveEntryReferencePlan } from '../../../domain/ownership-archive-reference-plan';
import {
  ARCHIVE_S3_OBSERVATION_PROTOCOL,
  ArchiveS3ObservationItem,
  ArchiveS3ObservationPage,
  ArchiveS3ObservationReceipt,
  OwnershipArchiveS3ObservationRepository,
  advanceS3Observation,
  assertS3Observation,
  s3ObservationMetadataHash,
} from '../../../domain/ownership-archive-s3-observation';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from './animal-ownership.schema';
import {
  OWNERSHIP_ARCHIVE_MODEL,
  OWNERSHIP_ARCHIVE_ENTRY_MODEL,
  OWNERSHIP_ARCHIVE_FILE_MODEL,
} from './ownership-archive.schema';
import { OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL } from './ownership-archive-media-registration.schema';
import { OWNERSHIP_ARCHIVE_METADATA_REVALIDATION_MODEL } from './ownership-archive-metadata-revalidation.schema';

@Injectable()
export class MongoOwnershipArchiveMetadataRevalidation
  implements
    OwnershipArchiveMetadataRevalidationRepository,
    OwnershipArchiveS3ObservationRepository
{
  constructor(
    @InjectModel(OWNERSHIP_ARCHIVE_METADATA_REVALIDATION_MODEL)
    private readonly runs: Model<ArchiveMetadataRevalidation>,
    @InjectModel(OWNERSHIP_ARCHIVE_MODEL)
    private readonly archives: Model<OwnershipArchive>,
    @InjectModel(OWNERSHIP_ARCHIVE_ENTRY_MODEL)
    private readonly entries: Model<ArchiveEntry>,
    @InjectModel(OWNERSHIP_ARCHIVE_FILE_MODEL)
    private readonly files: Model<ArchiveFile>,
    @InjectModel(OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL)
    private readonly registrations: Model<ArchiveMediaRegistration>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
    @Inject('OwnershipArchiveStorage')
    private readonly storage: Pick<OwnershipArchiveStorage, 'keyFromUrl'>,
  ) {}

  async start(
    id: string,
    archiveId: string,
  ): Promise<ArchiveMetadataRevalidation> {
    return this.transaction(async (session) => {
      const archive = await this.archive(archiveId, session);
      const existing = await this.runs
        .findOne({ id })
        .session(session)
        .lean()
        .exec();
      const control = await this.control(archive, session);
      if (existing) {
        assertMetadataRevalidation(existing, archive);
        this.assertFence(existing, control);
        return existing;
      }
      const controlRevision = await this.advanceFence(
        archive,
        control,
        session,
      );
      const run: ArchiveMetadataRevalidation = {
        protocol: ARCHIVE_METADATA_REVALIDATION_PROTOCOL,
        id,
        archiveId,
        definitionHash: metadataRevalidationDefinition(id, archive),
        phase: 'ENTRIES',
        revision: 0,
        controlRevision,
        reservationHash: this.reservationHash(control),
        reservationEpoch: assertReservedEpoch(control.reservationEpoch),
        entryCount: 0,
        fileCount: 0,
        entryDigest: archiveHash([]),
        fileDigest: archiveHash([]),
        startedAt: new Date().toISOString(),
      };
      await this.runs.create([run], { session });
      return run;
    });
  }

  async nextPage(
    id: string,
    limit: number,
  ): Promise<ArchiveMetadataRevalidation> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ConflictError('Invalid metadata revalidation page size');
    return this.transaction(async (session) => {
      const run = await this.runs
        .findOne({ id })
        .session(session)
        .lean()
        .exec();
      if (!run)
        throw new ResourceNotFoundError(
          'Archive metadata revalidation not found',
        );
      const archive = await this.archive(run.archiveId, session);
      assertMetadataRevalidation(run, archive);
      const control = await this.control(archive, session);
      this.assertFence(run, control);
      if (run.phase === 'METADATA_OBSERVED') return run;
      const next = {
        ...run,
        revision: run.revision + 1,
        controlRevision: await this.advanceFence(archive, control, session),
      };
      if (run.phase === 'ENTRIES')
        await this.entryPage(archive, next, limit, session);
      else await this.filePage(archive, next, limit, session);
      assertMetadataRevalidation(next, archive);
      const saved = await this.runs
        .updateOne(
          {
            id,
            definitionHash: run.definitionHash,
            revision: run.revision,
            phase: run.phase,
            controlRevision: run.controlRevision,
          },
          {
            $set: {
              phase: next.phase,
              revision: next.revision,
              controlRevision: next.controlRevision,
              entryCount: next.entryCount,
              fileCount: next.fileCount,
              entryDigest: next.entryDigest,
              fileDigest: next.fileDigest,
              ...(next.entryAfterId ? { entryAfterId: next.entryAfterId } : {}),
              ...(next.fileAfterId ? { fileAfterId: next.fileAfterId } : {}),
              ...(next.observedAt ? { observedAt: next.observedAt } : {}),
            },
          },
          { session },
        )
        .exec();
      if (saved.modifiedCount !== 1)
        throw new ConflictError(
          'Metadata revalidation page changed; refresh before retrying',
        );
      return next;
    });
  }

  async startS3(id: string): Promise<ArchiveMetadataRevalidation> {
    return this.transaction(async (session) => {
      const { run, archive, control } = await this.s3Run(id, session);
      if (run.s3Observation) {
        assertS3Observation(run);
        return run;
      }
      const next: ArchiveMetadataRevalidation = {
        ...run,
        revision: run.revision + 1,
        controlRevision: await this.advanceFence(archive, control, session),
        s3Observation: {
          protocol: ARCHIVE_S3_OBSERVATION_PROTOCOL,
          metadataHash: s3ObservationMetadataHash(run),
          phase: 'OBSERVING',
          revision: 0,
          count: 0,
          manifestDigest: archiveHash([]),
          observationDigest: archiveHash([]),
          startedAt: new Date().toISOString(),
        },
      };
      assertMetadataRevalidation(next, archive);
      assertS3Observation(next);
      await this.saveS3(run, next, session);
      return next;
    });
  }

  async s3Page(id: string, limit: number): Promise<ArchiveS3ObservationPage> {
    this.assertS3Limit(limit);
    return this.transaction(async (session) => {
      const { run, archive } = await this.s3Run(id, session);
      assertS3Observation(run);
      const items =
        run.s3Observation!.phase === 'S3_OBSERVED'
          ? []
          : await this.s3Items(archive, run, limit, session);
      return { run, limit, items };
    });
  }

  async confirmS3(
    page: ArchiveS3ObservationPage,
    receipts: ArchiveS3ObservationReceipt[],
  ): Promise<ArchiveMetadataRevalidation> {
    this.assertS3Limit(page.limit);
    return this.transaction(async (session) => {
      const { run, archive, control } = await this.s3Run(page.run.id, session);
      assertS3Observation(run);
      if (
        run.revision !== page.run.revision ||
        run.controlRevision !== page.run.controlRevision ||
        run.definitionHash !== page.run.definitionHash ||
        archiveHash(run.s3Observation) !== archiveHash(page.run.s3Observation)
      )
        throw new ConflictError(
          'The S3 observation page changed before checkpoint',
        );
      const items = await this.s3Items(archive, run, page.limit, session);
      if (archiveHash(items) !== archiveHash(page.items))
        throw new ConflictError(
          'The S3 observation manifest or registration changed',
        );
      const s3Observation = advanceS3Observation(
        run,
        items,
        receipts,
        page.limit,
      );
      if (s3Observation.phase === 'S3_OBSERVED')
        await this.assertCounts(archive, run, session);
      const next = {
        ...run,
        revision: run.revision + 1,
        controlRevision: await this.advanceFence(archive, control, session),
        s3Observation,
      };
      assertMetadataRevalidation(next, archive);
      await this.saveS3(run, next, session);
      return next;
    });
  }

  private assertS3Limit(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new ConflictError('Invalid S3 observation page size');
  }
  private async s3Run(id: string, session: ClientSession) {
    const run = await this.runs.findOne({ id }).session(session).lean().exec();
    if (!run)
      throw new ResourceNotFoundError(
        'Archive metadata revalidation not found',
      );
    const archive = await this.archive(run.archiveId, session);
    assertMetadataRevalidation(run, archive);
    const control = await this.control(archive, session);
    this.assertFence(run, control);
    if (run.phase !== 'METADATA_OBSERVED')
      throw new ConflictError(
        'Complete metadata observation before reading final S3 objects',
      );
    return { run, archive, control };
  }
  private async s3Items(
    archive: OwnershipArchive,
    run: ArchiveMetadataRevalidation,
    limit: number,
    session: ClientSession,
  ): Promise<ArchiveS3ObservationItem[]> {
    const files = await this.files
      .find({
        archiveId: archive.id,
        ...(run.s3Observation!.afterId
          ? { id: { $gt: run.s3Observation!.afterId } }
          : {}),
      })
      .sort({ id: 1 })
      .limit(limit)
      .session(session)
      .lean()
      .exec();
    if (files.length > limit)
      throw new ConflictError('S3 observation page exceeded its limit');
    let afterId = run.s3Observation!.afterId;
    const items: ArchiveS3ObservationItem[] = [];
    for (const file of files) {
      this.assertCursor(file.id, afterId);
      const entry = await this.entries
        .findOne({
          archiveId: archive.id,
          'fileBindings.fileId': file.id,
          'referencePlan.bindings.fileId': file.id,
          $expr: { $eq: ['$referencePlan.sourceContentHash', '$contentHash'] },
        })
        .select({ id: 1, referencePlan: 1 })
        .session(session)
        .lean()
        .exec();
      if (!entry?.referencePlan || entry.referencePlan.entryId !== entry.id)
        throw new ConflictError(
          'The S3 observation file has no matching reference plan',
        );
      const expected = buildArchiveMediaRegistration(
        archive,
        file,
        entry.referencePlan,
      );
      const rows = await this.registrations
        .find({ archiveId: archive.id, fileId: file.id })
        .limit(2)
        .session(session)
        .lean()
        .exec();
      if (rows.length !== 1)
        throw new ConflictError(
          'S3 observation requires one prepared registration per file',
        );
      assertSameMediaRegistration(rows[0], expected);
      items.push({
        fileId: file.id,
        fileDefinitionHash: file.definitionHash,
        registrationDefinitionHash: expected.definitionHash,
        intent: file.materialization!.intent,
        revision: expected.revision,
      });
      afterId = file.id;
    }
    return items;
  }
  private async saveS3(
    run: ArchiveMetadataRevalidation,
    next: ArchiveMetadataRevalidation,
    session: ClientSession,
  ) {
    const saved = await this.runs
      .updateOne(
        {
          id: run.id,
          definitionHash: run.definitionHash,
          phase: 'METADATA_OBSERVED',
          revision: run.revision,
          controlRevision: run.controlRevision,
        },
        {
          $set: {
            s3Observation: next.s3Observation,
            revision: next.revision,
            controlRevision: next.controlRevision,
          },
        },
        { session },
      )
      .exec();
    if (saved.modifiedCount !== 1)
      throw new ConflictError('The S3 observation checkpoint changed');
  }

  private async entryPage(
    archive: OwnershipArchive,
    next: ArchiveMetadataRevalidation,
    limit: number,
    session: ClientSession,
  ) {
    const page = await this.entries
      .find({
        archiveId: archive.id,
        ...(next.entryAfterId ? { id: { $gt: next.entryAfterId } } : {}),
      })
      .sort({ id: 1 })
      .limit(limit)
      .session(session)
      .lean()
      .exec();
    if (page.length > limit)
      throw new ConflictError('Metadata entry page exceeded its limit');
    for (const entry of page) {
      this.assertCursor(entry.id, next.entryAfterId);
      const files: ArchiveFile[] = [];
      for (const fileId of new Set(
        entry.fileBindings.map((binding) => binding.fileId),
      )) {
        const file = await this.files
          .findOne({ archiveId: archive.id, id: fileId })
          .session(session)
          .lean()
          .exec();
        if (!file)
          throw new ConflictError('A referenced archive file is missing');
        files.push(file);
      }
      const rebuilt = buildArchiveEntryReferencePlan(
        archive,
        entry,
        files,
        (url) => this.storage.keyFromUrl(url),
      );
      if (archiveHash(entry.referencePlan) !== archiveHash(rebuilt))
        throw new ConflictError(
          'An archived payload or reference plan changed',
        );
      // Also validates every use of a shared file, not only one matching binding.
      for (const file of files)
        buildArchiveMediaRegistration(archive, file, rebuilt);
      next.entryDigest = archiveHash([
        next.entryDigest,
        entry.id,
        entry.contentHash,
        rebuilt.planHash,
      ]);
      next.entryAfterId = entry.id;
      next.entryCount++;
    }
    if (page.length < limit) {
      if (next.entryCount !== archive.expectedEntryCount)
        throw new ConflictError(
          'Metadata entry count differs from the sealed cut',
        );
      next.phase = 'FILES';
    }
  }

  private async filePage(
    archive: OwnershipArchive,
    next: ArchiveMetadataRevalidation,
    limit: number,
    session: ClientSession,
  ) {
    const page = await this.files
      .find({
        archiveId: archive.id,
        ...(next.fileAfterId ? { id: { $gt: next.fileAfterId } } : {}),
      })
      .sort({ id: 1 })
      .limit(limit)
      .session(session)
      .lean()
      .exec();
    if (page.length > limit)
      throw new ConflictError('Metadata file page exceeded its limit');
    for (const file of page) {
      this.assertCursor(file.id, next.fileAfterId);
      const entry = await this.entries
        .findOne({
          archiveId: archive.id,
          'fileBindings.fileId': file.id,
          'referencePlan.bindings.fileId': file.id,
          $expr: { $eq: ['$referencePlan.sourceContentHash', '$contentHash'] },
        })
        .select({ id: 1, referencePlan: 1 })
        .session(session)
        .lean()
        .exec();
      if (!entry?.referencePlan || entry.referencePlan.entryId !== entry.id)
        throw new ConflictError(
          'An archive manifest file is unreferenced or its plan changed',
        );
      const expected = buildArchiveMediaRegistration(
        archive,
        file,
        entry.referencePlan,
      );
      const rows = await this.registrations
        .find({ archiveId: archive.id, fileId: file.id })
        .limit(2)
        .session(session)
        .lean()
        .exec();
      if (rows.length !== 1)
        throw new ConflictError(
          'An archive file needs exactly one prepared registration',
        );
      assertSameMediaRegistration(rows[0], expected);
      next.fileDigest = archiveHash([
        next.fileDigest,
        file.id,
        file.definitionHash,
        expected.definitionHash,
      ]);
      next.fileAfterId = file.id;
      next.fileCount++;
    }
    if (page.length < limit) {
      await this.assertCounts(archive, next, session);
      next.phase = 'METADATA_OBSERVED';
      next.observedAt = new Date().toISOString();
    }
  }

  private async assertCounts(
    archive: OwnershipArchive,
    next: ArchiveMetadataRevalidation,
    session: ClientSession,
  ) {
    const count = async (
      model: Model<unknown>,
      filter: Record<string, unknown>,
    ) =>
      model
        .countDocuments({ archiveId: archive.id, ...filter })
        .session(session)
        .exec();
    if (
      next.entryCount !== archive.expectedEntryCount ||
      next.fileCount !== archive.expectedFileCount ||
      (await count(this.entries as Model<unknown>, {})) !== next.entryCount ||
      (await count(this.entries as Model<unknown>, { kind: 'ANIMAL' })) !== 1 ||
      (await count(this.files as Model<unknown>, {})) !== next.fileCount ||
      (await count(this.registrations as Model<unknown>, {})) !==
        next.fileCount ||
      (archive.history &&
        ((await count(this.entries as Model<unknown>, {
          kind: 'RETAINED_RECORD',
        })) !== archive.history.expectedEntryCount ||
          (await count(this.files as Model<unknown>, {
            'retained.sourceArchiveId': archive.history.sourceArchiveId,
          })) !== archive.history.expectedFileCount))
    )
      throw new ConflictError(
        'Metadata revalidation does not cover the complete archive manifest',
      );
  }

  private assertCursor(id: string, after?: string) {
    if (
      typeof id !== 'string' ||
      id.length !== 64 ||
      !/^[a-f0-9]+$/.test(id) ||
      id <= (after ?? '')
    )
      throw new ConflictError('Metadata revalidation cursor did not advance');
  }
  private async archive(
    id: string,
    session: ClientSession,
  ): Promise<OwnershipArchive> {
    const archive = await this.archives
      .findOne({ id })
      .session(session)
      .lean()
      .exec();
    if (!archive)
      throw new ResourceNotFoundError('Ownership archive not found');
    assertMediaRegistrationArchive(archive);
    return archive;
  }
  private async control(
    archive: OwnershipArchive,
    session: ClientSession,
  ): Promise<AnimalOwnershipControlEntity> {
    const active = await this.periods
      .exists({
        id: archive.periodId,
        animalId: archive.animalId,
        ownerId: archive.ownerId,
        ownershipVersion: archive.ownershipVersion,
        status: 'ACTIVE',
      })
      .session(session)
      .exec();
    if (!active)
      throw new ConflictError(
        'Metadata revalidation requires the matching active period',
      );
    const control = await this.controls
      .findOne({
        animalId: archive.animalId,
        ownerId: archive.ownerId,
        ownershipVersion: archive.ownershipVersion,
        'transferLock.transferId': archive.transferId,
        $expr: { $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0] },
      })
      .session(session)
      .lean()
      .exec();
    const revision = control?.archiveMaterializationRevision;
    if (
      !control?.transferLock?.lockedAt ||
      (revision !== undefined &&
        (!Number.isSafeInteger(revision) ||
          revision < 0 ||
          revision >= Number.MAX_SAFE_INTEGER))
    )
      throw new ConflictError(
        'Metadata revalidation requires a valid drained reservation and revision',
      );
    assertReservedEpoch(control.reservationEpoch);
    return control;
  }
  private reservationHash(control: AnimalOwnershipControlEntity): string {
    return archiveHash({
      transferId: control.transferLock!.transferId,
      lockedAt: control.transferLock!.lockedAt,
      reservationEpoch: assertReservedEpoch(control.reservationEpoch),
    });
  }
  private assertFence(
    run: ArchiveMetadataRevalidation,
    control: AnimalOwnershipControlEntity,
  ) {
    if (
      run.reservationEpoch === undefined ||
      run.reservationEpoch !== control.reservationEpoch ||
      control.archiveMaterializationRevision !== run.controlRevision ||
      this.reservationHash(control) !== run.reservationHash
    )
      throw new ConflictError(
        'Metadata revalidation is stale; start a new explicit run',
      );
  }
  private async advanceFence(
    archive: OwnershipArchive,
    control: AnimalOwnershipControlEntity,
    session: ClientSession,
  ): Promise<number> {
    const saved = await this.controls
      .updateOne(
        {
          animalId: archive.animalId,
          ownerId: archive.ownerId,
          ownershipVersion: archive.ownershipVersion,
          'transferLock.transferId': archive.transferId,
          'transferLock.lockedAt': control.transferLock!.lockedAt,
          reservationEpoch: assertReservedEpoch(control.reservationEpoch),
          archiveMaterializationRevision:
            control.archiveMaterializationRevision ?? { $exists: false },
          $expr: { $eq: [{ $size: { $ifNull: ['$activeWrites', []] } }, 0] },
        },
        { $inc: { archiveMaterializationRevision: 1 } },
        { session },
      )
      .exec();
    if (saved.modifiedCount !== 1)
      throw new ConflictError('Metadata revalidation fence changed');
    return (control.archiveMaterializationRevision ?? 0) + 1;
  }
  private async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.runs.db.startSession();
    try {
      return await session.withTransaction(() => work(session), {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      });
    } finally {
      await session.endSession();
    }
  }
}
