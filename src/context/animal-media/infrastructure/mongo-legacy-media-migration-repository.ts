import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Schema } from 'mongoose';
import { AnimalEntity } from '../../animal/infrastructure/persistence/mongo/animal.schema';
import { DiaryEntryEntity } from '../../diary/infrastructure/persistence/mongo/diary-entry.schema';
import { MedicalDocumentEntity } from '../../medical-document/infrastructure/persistence/mongo/medical-document.schema';
import {
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../medical-document/domain/medical-document';
import {
  AnimalOwnershipControlEntity,
  AnimalOwnershipPeriodEntity,
} from '../../animal-transfer/infrastructure/persistence/mongo/animal-ownership.schema';
import { drainedAnimalReservationFilter } from '../../animal-transfer/domain/drained-animal-reservation-filter';
import {
  nextReservationEpoch,
  reservationEpochMatch,
} from '../../animal-transfer/domain/reservation-epoch';
import {
  AnimalMediaUpload,
  AnimalMediaUploadStorage,
  sameMediaMigrationRetention,
  versionedMedia,
} from '../domain/animal-media-upload';
import { ANIMAL_MEDIA_UPLOAD_MODEL } from './mongo-animal-media-upload-repository';
import {
  LegacyMediaMigrationRepository,
  MediaMigration,
  MediaMigrationDefinition,
  MediaMigrationStop,
  MediaReferenceChange,
  MigrationPage,
  mediaMigrationLockId,
} from '../domain/legacy-media-migration';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ResourceNotFoundError } from '../../shared/domain/errors/ResourceNotFoundError';

export const LEGACY_MEDIA_MIGRATION_MODEL = 'LegacyAnimalMediaMigration';
export const LegacyMediaMigrationSchema = new Schema<MediaMigration>(
  {
    id: { type: String, unique: true, required: true },
    animalId: { type: String, required: true },
    ownerId: { type: String, required: true },
    ownershipVersion: { type: Number, min: 1, required: true },
    scope: { type: String, enum: ['MEDICAL_DOCUMENTS'] },
    retention: {
      type: new Schema(
        { expectedBucketOwner: String, retainUntil: String },
        { _id: false },
      ),
    },
    phase: {
      type: String,
      enum: ['PROFILE', 'DIARY', 'MEDICAL_DOCUMENTS', 'COMPLETED', 'STOPPED'],
      required: true,
    },
    revision: { type: Number, min: 0, required: true },
    reservationEpoch: { type: Number, required: false },
    afterId: String,
    recovery: Schema.Types.Mixed,
  },
  { collection: 'animal_media_migrations' },
);

@Injectable()
export class MongoLegacyMediaMigrationRepository implements LegacyMediaMigrationRepository {
  constructor(
    @InjectModel(LEGACY_MEDIA_MIGRATION_MODEL)
    private readonly jobs: Model<MediaMigration>,
    @InjectModel(AnimalEntity.name)
    private readonly animals: Model<AnimalEntity>,
    @InjectModel(DiaryEntryEntity.name)
    private readonly diary: Model<DiaryEntryEntity>,
    @InjectModel(AnimalOwnershipControlEntity.name)
    private readonly controls: Model<AnimalOwnershipControlEntity>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
    @InjectModel(ANIMAL_MEDIA_UPLOAD_MODEL)
    private readonly uploads: Model<AnimalMediaUpload>,
    @Inject('AnimalMediaUploadStorage')
    private readonly storage: AnimalMediaUploadStorage,
    @InjectModel(MedicalDocumentEntity.name)
    private readonly medical: Model<MedicalDocumentEntity>,
  ) {}

  async start(definition: MediaMigrationDefinition): Promise<MediaMigration> {
    try {
      await this.transaction(async (session) => {
        const previous = await this.jobs
          .findOne({ id: definition.id })
          .session(session)
          .lean()
          .exec();
        if (previous) {
          this.assertDefinition(previous, definition);
          return;
        }
        const animal = await this.animals
          .findOne({ id: definition.animalId, ownerId: definition.ownerId })
          .session(session)
          .select({ id: 1 })
          .lean()
          .exec();
        const period = await this.periods
          .findOne({
            animalId: definition.animalId,
            ownerId: definition.ownerId,
            ownershipVersion: definition.ownershipVersion,
            status: 'ACTIVE',
          })
          .session(session)
          .select({ id: 1 })
          .lean()
          .exec();
        if (!animal || !period)
          throw new ConflictError(
            'Migration requires the current animal owner and active period',
          );
        const before = await this.controls
          .findOne({
            animalId: definition.animalId,
            ownerId: definition.ownerId,
            ownershipVersion: definition.ownershipVersion,
          })
          .session(session)
          .lean()
          .exec();
        if (!before)
          throw new ConflictError('The migration control was not found');
        const reservationEpoch = nextReservationEpoch(before.reservationEpoch);
        const claimed = await this.controls
          .updateOne(
            {
              ...drainedAnimalReservationFilter(
                definition.animalId,
                definition.ownerId,
                definition.ownershipVersion,
              ),
              reservationEpoch: reservationEpochMatch(before.reservationEpoch),
            },
            {
              $set: {
                transferLock: {
                  transferId: mediaMigrationLockId(definition.id),
                  lockedAt: new Date().toISOString(),
                },
              },
              $inc: { mediaMigrationRevision: 1, reservationEpoch: 1 },
            },
            { session },
          )
          .exec();
        if (claimed.matchedCount !== 1)
          throw new ConflictError(
            'The animal is busy or reserved; retry migration later',
          );
        if (definition.scope === 'MEDICAL_DOCUMENTS')
          await this.assertMedicalReady(definition, session);
        await this.jobs.create(
          [
            {
              ...definition,
              phase:
                definition.scope === 'MEDICAL_DOCUMENTS'
                  ? 'MEDICAL_DOCUMENTS'
                  : 'PROFILE',
              revision: 0,
              reservationEpoch,
            },
          ],
          { session },
        );
      });
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
    }
    const job = await this.find(definition.id);
    if (!job) throw new ConflictError('The migration could not be persisted');
    this.assertDefinition(job, definition);
    return job;
  }

  async find(id: string): Promise<MediaMigration | null> {
    return this.jobs
      .findOne({ id })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
  }

  async stopForRecovery(input: MediaMigrationStop): Promise<MediaMigration> {
    await this.transaction(async (session) => {
      const job = await this.jobs
        .findOne({ id: input.id })
        .session(session)
        .lean()
        .exec();
      if (!job) throw new ResourceNotFoundError('Media migration not found');
      if (job.phase === 'STOPPED') {
        this.assertSameStop(job, input);
        return; // A retry must never touch a later reservation, even for this animal.
      }
      if (
        !['PROFILE', 'DIARY', 'MEDICAL_DOCUMENTS'].includes(job.phase) ||
        job.revision !== input.expectedRevision
      )
        throw new ConflictError(
          'The migration advanced or finished; refresh before recovery',
        );
      const animal = await this.animals
        .findOne({ id: job.animalId, ownerId: job.ownerId })
        .session(session)
        .select({ id: 1 })
        .lean()
        .exec();
      const period = await this.periods
        .findOne({
          animalId: job.animalId,
          ownerId: job.ownerId,
          ownershipVersion: job.ownershipVersion,
          status: 'ACTIVE',
        })
        .session(session)
        .select({ id: 1 })
        .lean()
        .exec();
      if (!animal || !period)
        throw new ConflictError('The migration owner or active period changed');
      const audit = {
        requestId: input.requestId,
        operatorId: input.operatorId,
        reason: input.reason,
        evidenceRef: input.evidenceRef,
        expectedRevision: input.expectedRevision,
      };
      const stopped = await this.jobs
        .updateOne(
          { id: job.id, phase: job.phase, revision: input.expectedRevision },
          {
            $set: {
              phase: 'STOPPED',
              recovery: { ...audit, stoppedAt: new Date().toISOString() },
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (stopped.matchedCount !== 1)
        throw new ConflictError(
          'The migration advanced; refresh before recovery',
        );
      const released = await this.controls
        .updateOne(
          this.reservation(job),
          {
            $unset: { transferLock: 1 },
            $inc: { mediaMigrationRevision: 1, reservationEpoch: 1 },
          },
          { session },
        )
        .exec();
      if (released.matchedCount !== 1)
        throw new ConflictError(
          'The migration reservation changed; recovery was not applied',
        );
    });
    const persisted = await this.find(input.id);
    if (!persisted || persisted.phase !== 'STOPPED')
      throw new ConflictError('The migration recovery could not be confirmed');
    this.assertSameStop(persisted, input);
    return persisted;
  }

  private assertSameStop(job: MediaMigration, input: MediaMigrationStop): void {
    const audit = job.recovery;
    if (
      !audit ||
      audit.requestId !== input.requestId ||
      audit.operatorId !== input.operatorId ||
      audit.reason !== input.reason ||
      audit.evidenceRef !== input.evidenceRef ||
      audit.expectedRevision !== input.expectedRevision
    )
      throw new ConflictError(
        'The migration was stopped by a different recovery request',
      );
  }

  async readPage(job: MediaMigration, limit: number): Promise<MigrationPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new ConflictError('Invalid migration page size');
    const control = await this.controls
      .findOne(this.reservation(job))
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
    const animal = await this.animals
      .findOne({ id: job.animalId, ownerId: job.ownerId })
      .select({ profilePictureUrl: 1 })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
    if (!control || !animal)
      throw new ConflictError('The migration reservation or owner changed');
    if (job.phase === 'MEDICAL_DOCUMENTS')
      return this.readMedicalPage(job, limit);
    if (job.phase === 'PROFILE')
      return {
        references: animal.profilePictureUrl
          ? [{ kind: 'PROFILE', url: animal.profilePictureUrl }]
          : [],
        next: { phase: 'DIARY' },
      };
    if (job.phase !== 'DIARY')
      throw new ConflictError('Invalid migration phase');
    const entries = await this.diary
      .find({
        animalId: job.animalId,
        ...(job.afterId ? { id: { $gt: job.afterId } } : {}),
      })
      .select({ id: 1, attachments: 1 })
      .sort({ id: 1 })
      .limit(limit)
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
    if (entries.length > limit)
      throw new ConflictError('The migration source exceeded its page limit');
    let previous = job.afterId ?? '';
    for (const entry of entries) {
      if (
        !entry.id ||
        entry.id <= previous ||
        !Array.isArray(entry.attachments) ||
        new Set(entry.attachments.map((a) => a.id)).size !==
          entry.attachments.length
      )
        throw new ConflictError(
          'Invalid diary migration cursor or duplicate attachments',
        );
      previous = entry.id;
    }
    return {
      references: entries.flatMap((entry) =>
        entry.attachments.map((a) => ({
          kind: 'DIARY' as const,
          entryId: entry.id,
          attachmentId: a.id,
          url: a.url,
          mimeType: a.mimeType,
          size: a.size,
        })),
      ),
      next:
        entries.length < limit
          ? { phase: 'COMPLETED' }
          : { phase: 'DIARY', afterId: previous },
    };
  }

  private async assertMedicalReady(
    { animalId, ownerId }: MediaMigrationDefinition,
    session?: ClientSession,
  ) {
    const blocked = this.medical.exists({
      animalIds: animalId,
      $or: [
        {
          status: {
            $nin: [
              MedicalDocumentStatus.Accepted,
              MedicalDocumentStatus.Rejected,
              MedicalDocumentStatus.Failed,
            ],
          },
        },
        {
          status: MedicalDocumentStatus.Accepted,
          $or: [
            { ownerId: { $ne: ownerId } },
            { animalIds: { $ne: [animalId] } },
            { replacementOfDocumentId: { $ne: null } },
          ],
        },
      ],
    });
    if (
      await (
        session
          ? blocked.session(session)
          : blocked.read('primary').readConcern('majority')
      ).exec()
    )
      throw new ConflictError(
        'The animal has pending medical work or documents that require normalization',
      );
  }

  private async readMedicalPage(
    job: MediaMigration,
    limit: number,
  ): Promise<MigrationPage> {
    if (job.scope !== 'MEDICAL_DOCUMENTS' || !job.retention)
      throw new ConflictError('The medical migration scope is invalid');
    await this.assertMedicalReady(job);
    const documents = await this.medical
      .find({
        animalIds: job.animalId,
        status: MedicalDocumentStatus.Accepted,
        ...(job.afterId ? { id: { $gt: job.afterId } } : {}),
      })
      .select({
        id: 1,
        ownerId: 1,
        animalIds: 1,
        version: 1,
        storageKey: 1,
        documentLocations: 1,
        finalCategory: 1,
        mimeType: 1,
        fileSize: 1,
      })
      .collation({ locale: 'simple' })
      .sort({ id: 1 })
      .limit(limit)
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
    if (documents.length > limit)
      throw new ConflictError(
        'The medical migration source exceeded its page limit',
      );
    let previous = job.afterId ?? '';
    const references = documents.map((doc) => {
      if (
        typeof doc.id !== 'string' ||
        doc.id <= previous ||
        doc.ownerId !== job.ownerId ||
        doc.animalIds?.length !== 1 ||
        doc.animalIds[0] !== job.animalId ||
        doc.documentLocations?.length !== 1 ||
        doc.documentLocations[0]?.animalId !== job.animalId ||
        doc.documentLocations[0].storageKey !== doc.storageKey ||
        typeof doc.storageKey !== 'string' ||
        !doc.finalCategory ||
        !Object.values(MedicalDocumentType).includes(doc.finalCategory)
      )
        throw new ConflictError(
          'Medical storage references must be normalized before migration',
        );
      previous = doc.id;
      const url = this.storage.urlForKey(doc.storageKey);
      if (this.storage.keyFromUrl(url) !== doc.storageKey)
        throw new ConflictError(
          'The medical source key cannot be represented safely',
        );
      return {
        kind: 'MEDICAL_DOCUMENT' as const,
        documentId: doc.id,
        documentVersion: doc.version,
        url,
        mimeType: doc.mimeType,
        size: doc.fileSize,
        finalCategory: doc.finalCategory,
      };
    });
    return {
      references,
      next:
        documents.length < limit
          ? { phase: 'COMPLETED' }
          : { phase: 'MEDICAL_DOCUMENTS', afterId: previous },
    };
  }

  async commitPage(
    job: MediaMigration,
    page: MigrationPage,
    changes: MediaReferenceChange[],
  ): Promise<void> {
    const validNext =
      job.phase === 'PROFILE'
        ? page.next.phase === 'DIARY' && !page.next.afterId
        : (job.phase === 'DIARY' ||
            (job.phase === 'MEDICAL_DOCUMENTS' &&
              job.scope === 'MEDICAL_DOCUMENTS' &&
              !!job.retention)) &&
          ((page.next.phase === 'COMPLETED' && !page.next.afterId) ||
            (page.next.phase === job.phase &&
              !!page.next.afterId &&
              page.next.afterId > (job.afterId ?? '')));
    if (
      !validNext ||
      !Number.isSafeInteger(job.revision) ||
      job.revision < 0 ||
      page.references.some(
        (ref) =>
          (ref.kind === 'MEDICAL_DOCUMENT') !==
          (job.phase === 'MEDICAL_DOCUMENTS'),
      ) ||
      changes.some(
        (change) =>
          !page.references.some(
            (ref) =>
              ref.kind === change.before.kind &&
              ref.url === change.before.url &&
              ref.entryId === change.before.entryId &&
              ref.attachmentId === change.before.attachmentId &&
              ref.documentId === change.before.documentId &&
              ref.documentVersion === change.before.documentVersion &&
              ref.finalCategory === change.before.finalCategory &&
              ref.mimeType === change.before.mimeType &&
              ref.size === change.before.size,
          ),
      )
    )
      throw new ConflictError(
        'Invalid migration page transition or references',
      );
    await this.transaction(async (session) => {
      // Job revision serializes concurrent pages and completion. Every control
      // check also WRITES a fence, conflicting with reservation release/replacement.
      const checkpoint = await this.jobs
        .updateOne(
          {
            id: job.id,
            phase: job.phase,
            revision: job.revision,
            reservationEpoch: reservationEpochMatch(job.reservationEpoch),
            ...(job.scope && { scope: job.scope }),
            ...(job.retention && {
              'retention.expectedBucketOwner':
                job.retention.expectedBucketOwner,
              'retention.retainUntil': job.retention.retainUntil,
            }),
          },
          {
            $set: {
              phase: page.next.phase,
              ...(page.next.afterId ? { afterId: page.next.afterId } : {}),
            },
            ...(page.next.afterId ? {} : { $unset: { afterId: 1 } }),
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (checkpoint.matchedCount !== 1) return; // A concurrent worker already advanced.
      const reserved = await this.controls
        .updateOne(
          this.reservation(job),
          { $inc: { mediaMigrationRevision: 1 } },
          { session },
        )
        .exec();
      const animal = await this.animals
        .findOne({ id: job.animalId, ownerId: job.ownerId })
        .session(session)
        .select({ id: 1 })
        .lean()
        .exec();
      if (reserved.matchedCount !== 1 || !animal)
        throw new ConflictError('The migration reservation or owner changed');
      if (job.phase === 'MEDICAL_DOCUMENTS')
        await this.assertMedicalReady(job, session);
      for (const change of changes) {
        const finalKey = this.storage.keyFromUrl(change.afterUrl);
        const ticket = await this.uploads
          .findOne({
            finalKey,
            ownerId: job.ownerId,
            animalId: job.animalId,
            'legacy.migrationId': job.id,
            'legacy.sourceUrl': change.before.url,
            'legacy.kind': change.before.kind,
            pinned: { $exists: true },
            sealed: { $exists: true },
          })
          .session(session)
          .lean()
          .exec();
        if (
          !ticket?.pinned ||
          !ticket.sealed ||
          !sameMediaMigrationRetention(
            ticket.legacy?.retention,
            job.retention,
          ) ||
          (job.retention && !versionedMedia(ticket.sealed.versionId)) ||
          ticket.legacy?.entryId !== change.before.entryId ||
          ticket.legacy?.attachmentId !== change.before.attachmentId ||
          ticket.legacy?.documentId !== change.before.documentId ||
          ticket.legacy?.documentVersion !== change.before.documentVersion
        )
          throw new ConflictError(
            'Migration references require their verified sealed ticket',
          );
        const updated =
          change.before.kind === 'PROFILE'
            ? await this.animals
                .updateOne(
                  {
                    id: job.animalId,
                    ownerId: job.ownerId,
                    profilePictureUrl: change.before.url,
                  },
                  { $set: { profilePictureUrl: change.afterUrl } },
                  { session },
                )
                .exec()
            : change.before.kind === 'MEDICAL_DOCUMENT'
              ? await this.activateMedicalReference(
                  job,
                  change,
                  finalKey!,
                  session,
                )
              : await this.diary
                  .updateOne(
                    {
                      id: change.before.entryId,
                      animalId: job.animalId,
                      attachments: {
                        $elemMatch: {
                          id: change.before.attachmentId,
                          url: change.before.url,
                          mimeType: change.before.mimeType,
                          size: change.before.size,
                        },
                      },
                    },
                    { $set: { 'attachments.$.url': change.afterUrl } },
                    { session },
                  )
                  .exec();
        if (updated.matchedCount !== 1)
          throw new ConflictError(
            'The media reference changed; migration page was not applied',
          );
      }
      if (page.next.phase === 'COMPLETED') {
        const released = await this.controls
          .updateOne(
            this.reservation(job),
            { $unset: { transferLock: 1 }, $inc: { reservationEpoch: 1 } },
            { session },
          )
          .exec();
        if (released.matchedCount !== 1)
          throw new ConflictError(
            'The migration reservation could not be released',
          );
      }
    });
  }

  private async activateMedicalReference(
    job: MediaMigration,
    { before }: MediaReferenceChange,
    finalKey: string,
    session: ClientSession,
  ) {
    const sourceKey = this.storage.keyFromUrl(before.url);
    if (!sourceKey || !finalKey || !before.documentId)
      throw new ConflictError('The medical migration references are invalid');
    return this.medical
      .updateOne(
        {
          id: before.documentId,
          ownerId: job.ownerId,
          animalIds: [job.animalId],
          status: MedicalDocumentStatus.Accepted,
          version: before.documentVersion,
          finalCategory: before.finalCategory,
          mimeType: before.mimeType,
          fileSize: before.size,
          storageKey: sourceKey,
          documentLocations: { $size: 1 },
          'documentLocations.0.animalId': job.animalId,
          'documentLocations.0.storageKey': sourceKey,
        },
        {
          $set: {
            storageKey: finalKey,
            'documentLocations.0.storageKey': finalKey,
          },
        },
        { session },
      )
      .exec();
  }

  private reservation(job: MediaMigration) {
    nextReservationEpoch(job.reservationEpoch);
    return {
      animalId: job.animalId,
      ownerId: job.ownerId,
      ownershipVersion: job.ownershipVersion,
      'transferLock.transferId': mediaMigrationLockId(job.id),
      reservationEpoch: reservationEpochMatch(job.reservationEpoch),
      'activeWrites.0': { $exists: false },
    };
  }
  private assertDefinition(
    job: MediaMigration,
    definition: MediaMigrationDefinition,
  ): void {
    if (
      job.animalId !== definition.animalId ||
      job.ownerId !== definition.ownerId ||
      job.ownershipVersion !== definition.ownershipVersion ||
      job.scope !== definition.scope ||
      !sameMediaMigrationRetention(job.retention, definition.retention)
    )
      throw new ConflictError(
        'The migration ID already has a different definition',
      );
  }
  private async transaction(
    operation: (session: ClientSession) => Promise<void>,
  ): Promise<void> {
    const session = await this.jobs.db.startSession();
    try {
      await session.withTransaction(() => operation(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });
    } finally {
      await session.endSession();
    }
  }
}
