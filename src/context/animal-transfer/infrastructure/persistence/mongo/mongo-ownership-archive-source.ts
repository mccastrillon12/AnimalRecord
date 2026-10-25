import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
import { ArchiveDefinition } from '../../../domain/ownership-archive';
import { OwnershipArchiveSource } from '../../../domain/ownership-archive-source';
import {
  AnimalOwnershipPeriodEntity,
  AnimalOwnershipPeriodStatus,
} from './animal-ownership.schema';

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

  async findAnimal(animalId: string): Promise<AnimalPrimitiveType | null> {
    const data = await this.animals
      .findOne({ id: animalId })
      .read('primary')
      .readConcern('majority')
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

  async hasPendingMedicalWork(animalId: string): Promise<boolean> {
    // Includes original analyses, replacement candidates and unknown/missing states.
    // Do not filter owner: inconsistent associations must not bypass preflight.
    return Boolean(
      await this.medical
        .exists({
          animalIds: animalId,
          status: {
            $nin: [
              MedicalDocumentStatus.Accepted,
              MedicalDocumentStatus.Rejected,
              MedicalDocumentStatus.Failed,
            ],
          },
        })
        .read('primary')
        .readConcern('majority')
        .exec(),
    );
  }

  async listDiary(
    animalId: string,
    afterId: string | undefined,
    limit: number,
  ): Promise<DiaryEntryPrimitiveType[]> {
    this.validateLimit(limit);
    const records = await this.diary
      .find({ animalId, ...(afterId ? { id: { $gt: afterId } } : {}) })
      .sort({ id: 1 })
      .limit(limit)
      .read('primary')
      .readConcern('majority')
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
  ): Promise<MedicalDocumentPrimitiveType[]> {
    this.validateLimit(limit);
    const records = await this.medical
      .find({
        animalIds: animalId,
        status: MedicalDocumentStatus.Accepted,
        ...(afterId ? { id: { $gt: afterId } } : {}),
      })
      .sort({ id: 1 })
      .limit(limit)
      .read('primary')
      .readConcern('majority')
      .lean()
      .exec();
    return records.map((record) =>
      MedicalDocument.fromPrimitives(record).toPrimitives(),
    );
  }

  private validateLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new InvalidArgumentError(
        'Capture page size must be between 1 and 100',
      );
  }
}
