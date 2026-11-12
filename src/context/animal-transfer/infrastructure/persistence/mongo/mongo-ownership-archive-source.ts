import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { Animal, AnimalPrimitiveType } from '../../../../animal/domain/animal';
import { AnimalEntity } from '../../../../animal/infrastructure/persistence/mongo/animal.schema';
import {
  DiaryEntry,
  DiaryEntryPrimitiveType,
} from '../../../../diary/domain/diary-entry';
import { DiaryEntryEntity } from '../../../../diary/infrastructure/persistence/mongo/diary-entry.schema';
import {
  MedicalDocument,
  MedicalDocumentPrimitiveType,
  MedicalDocumentStatus,
} from '../../../../medical-document/domain/medical-document';
import { MedicalDocumentEntity } from '../../../../medical-document/infrastructure/persistence/mongo/medical-document.schema';
import { ConflictError } from '../../../../shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../../../shared/domain/errors/InvalidArgumentError';
import type { ItemRecipientProjectionReader } from '../../../application/item-recipient-projection-reader';
import {
  ArchiveDefinition,
  ArchiveRecordInput,
  archiveHash,
} from '../../../domain/ownership-archive';
import type { ArchiveProjectionUrls } from '../../../domain/ownership-archive-recipient-projection';
import { OwnershipArchiveSource } from '../../../domain/ownership-archive-source';
import {
  ItemOwnershipResourceChange,
  itemOwnershipResourceChange,
} from '../../../domain/transfer-item-ownership-resources';
import {
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';
import { assertArchiveCallerTransaction } from './archive-reservation-fence';

type RecipientProjection = Awaited<
  ReturnType<ItemRecipientProjectionReader['read']>
>;

const PAGE_SIZE = 100;

@Injectable()
export class MongoOwnershipArchiveSource implements OwnershipArchiveSource {
  constructor(
    @InjectModel(AnimalEntity.name)
    private readonly animals: Model<AnimalPrimitiveType>,
    @InjectModel(DiaryEntryEntity.name)
    private readonly diary: Model<DiaryEntryPrimitiveType>,
    @InjectModel(MedicalDocumentEntity.name)
    private readonly medical: Model<MedicalDocumentPrimitiveType>,
    @InjectModel(AnimalOwnershipPeriodEntity.name)
    private readonly periods: Model<AnimalOwnershipPeriodEntity>,
  ) {}

  async findAnimal(
    animalId: string,
    session?: ClientSession,
  ): Promise<AnimalPrimitiveType | null> {
    const query = this.animals.findOne({ id: animalId });
    const data = await (
      session
        ? query.session(session)
        : query.read('primary').readConcern('majority')
    )
      .lean()
      .exec();
    return data ? Animal.fromPrimitives(data).toPrimitives() : null;
  }

  async assertInitialPeriod(definition: ArchiveDefinition): Promise<void> {
    // Until retained history is imported, fail closed rather than silently omit it.
    if (definition.ownershipVersion !== 1)
      throw new ConflictError(
        'Retained ownership history capture is not implemented',
      );
    const period = await this.periods
      .findOne({
        id: definition.periodId,
        animalId: definition.animalId,
        ownerId: definition.ownerId,
        ownershipVersion: definition.ownershipVersion,
        status: AnimalOwnershipPeriodStatus.Active,
      })
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
    if (!period)
      throw new ConflictError(
        'The capture requires the active ownership period',
      );
    const previous = await this.periods
      .exists({
        animalId: definition.animalId,
        status: AnimalOwnershipPeriodStatus.Closed,
      })
      .read('primary')
      .readConcern('majority')
      .exec();
    if (previous)
      throw new ConflictError(
        'Retained ownership history capture is not implemented',
      );
  }

  async hasPendingMedicalWork(
    animalId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    // Includes original analyses, replacement candidates and unknown/missing states.
    // Do not filter owner: inconsistent associations must not bypass preflight.
    const query = this.medical.exists({
      animalIds: animalId,
      status: {
        $nin: [
          MedicalDocumentStatus.Accepted,
          MedicalDocumentStatus.Rejected,
          MedicalDocumentStatus.Failed,
        ],
      },
    });
    return Boolean(
      await (
        session
          ? query.session(session)
          : query.read('primary').readConcern('majority')
      ).exec(),
    );
  }

  async listDiary(
    animalId: string,
    afterId: string | undefined,
    limit: number,
    session?: ClientSession,
  ): Promise<DiaryEntryPrimitiveType[]> {
    this.validateLimit(limit);
    const query = this.diary
      .find({ animalId, ...(afterId ? { id: { $gt: afterId } } : {}) })
      .sort({ id: 1 })
      .limit(limit);
    const records = await (
      session
        ? query.session(session)
        : query.read('primary').readConcern('majority')
    )
      .lean()
      .exec();
    return records.map((record) =>
      DiaryEntry.fromPrimitives(record).toPrimitives(),
    );
  }

  async listAcceptedDocuments(
    animalId: string,
    afterId: string | undefined,
    limit: number,
    session?: ClientSession,
  ): Promise<MedicalDocumentPrimitiveType[]> {
    this.validateLimit(limit);
    const query = this.medical
      .find({
        animalIds: animalId,
        status: MedicalDocumentStatus.Accepted,
        ...(afterId ? { id: { $gt: afterId } } : {}),
      })
      .sort({ id: 1 })
      .limit(limit);
    const records = await (
      session
        ? query.session(session)
        : query.read('primary').readConcern('majority')
    )
      .lean()
      .exec();
    return records.map((record) =>
      MedicalDocument.fromPrimitives(record).toPrimitives(),
    );
  }

  /** Rechecks the entire live dossier after the caller has fenced the reservation. */
  async readItemOwnershipResourceChanges(
    projection: RecipientProjection,
    urls: ArchiveProjectionUrls,
    session: ClientSession,
    connection: Connection,
  ): Promise<readonly ItemOwnershipResourceChange[]> {
    const models = [this.animals, this.diary, this.medical];
    if (models.some((model) => model.db !== connection))
      throw new ConflictError(
        'The live transfer resources must share the capture connection',
      );
    assertArchiveCallerTransaction(session, this.animals, models);

    const { definition, entries, media } = projection;
    const { animalId } = definition;
    const pending = new Map(entries.map((entry) => [entry.entryId, entry]));
    const mediaByFile = new Map(media.map((record) => [record.fileId, record]));
    if (pending.size !== entries.length)
      throw new ConflictError('The selected transfer resources are duplicated');
    const changes: ItemOwnershipResourceChange[] = [];
    const match = (live: ArchiveRecordInput) => {
      const entryId = archiveHash([definition.id, live.kind, live.data.id]);
      changes.push(
        itemOwnershipResourceChange(
          definition,
          live,
          pending.get(entryId),
          mediaByFile,
          urls,
        ),
      );
      pending.delete(entryId);
    };

    const animal = await this.findAnimal(animalId, session);
    if (!animal)
      throw new ConflictError('The sealed transfer animal no longer exists');
    match({ kind: 'ANIMAL', data: animal });

    if (await this.hasPendingMedicalWork(animalId, session))
      throw new ConflictError('The animal has pending medical work');
    let afterId: string | undefined;
    for (;;) {
      const page = await this.listDiary(animalId, afterId, PAGE_SIZE, session);
      for (const data of page) match({ kind: 'DIARY_ENTRY', data });
      if (page.length < PAGE_SIZE) break;
      afterId = page[page.length - 1].id;
    }
    afterId = undefined;
    for (;;) {
      const page = await this.listAcceptedDocuments(
        animalId,
        afterId,
        PAGE_SIZE,
        session,
      );
      for (const data of page) match({ kind: 'MEDICAL_DOCUMENT', data });
      if (page.length < PAGE_SIZE) break;
      afterId = page[page.length - 1].id;
    }
    if (pending.size)
      throw new ConflictError('The sealed transfer resources are incomplete');
    return Object.freeze(changes);
  }

  private validateLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new InvalidArgumentError(
        'Capture page size must be between 1 and 100',
      );
  }
}
