import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MedicalDocument,
  MedicalDocumentPrimitiveType,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../domain/medical-document';
import { MedicalDocumentRepository } from '../../../domain/medical-document-repository';
import {
  MedicalDocumentEntity,
  MedicalDocumentMongoDocument,
} from './medical-document.schema';

@Injectable()
export class MongoMedicalDocumentRepository implements MedicalDocumentRepository {
  constructor(
    @InjectModel(MedicalDocumentEntity.name)
    private readonly medicalDocumentModel: Model<MedicalDocumentMongoDocument>,
  ) {}

  async save(document: MedicalDocument): Promise<MedicalDocument> {
    await new this.medicalDocumentModel(document.toPrimitives()).save();
    return document;
  }

  async findById(documentId: string): Promise<MedicalDocument | null> {
    const document = await this.medicalDocumentModel
      .findOne({ id: documentId })
      .lean()
      .exec();
    return document
      ? this.toDomain(document as unknown as MedicalDocumentPrimitiveType)
      : null;
  }

  async findAcceptedByAnimalId(
    animalId: string,
    category?: MedicalDocumentType,
  ): Promise<MedicalDocument[]> {
    const query: Record<string, unknown> = {
      animalIds: animalId,
      status: MedicalDocumentStatus.Accepted,
    };
    if (category) {
      query.finalCategory = category;
    }

    const documents = await this.medicalDocumentModel
      .find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return documents.map((document) =>
      this.toDomain(document as unknown as MedicalDocumentPrimitiveType),
    );
  }

  async update(
    document: MedicalDocument,
    expectedVersion?: number,
  ): Promise<boolean> {
    const query: Record<string, unknown> = { id: document.id };
    if (expectedVersion !== undefined) {
      query.version = expectedVersion;
    }

    const result = await this.medicalDocumentModel
      .updateOne(query, { $set: document.toPrimitives() })
      .exec();

    return result.matchedCount > 0;
  }

  private toDomain(data: MedicalDocumentPrimitiveType): MedicalDocument {
    return MedicalDocument.fromPrimitives({
      ...data,
      detectedCategories: data.detectedCategories || [],
      extractionsByCategory: data.extractionsByCategory || {},
      documentLocations: data.documentLocations || [],
      assignments: data.assignments || [],
    });
  }
}
