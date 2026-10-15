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

  async findActiveReplacementFor(
    documentId: string,
  ): Promise<MedicalDocument | null> {
    const document = await this.medicalDocumentModel
      .findOne({
        replacementOfDocumentId: documentId,
        status: {
          $in: [
            MedicalDocumentStatus.PendingUpload,
            MedicalDocumentStatus.Analyzing,
            MedicalDocumentStatus.ReviewPending,
          ],
        },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return document
      ? this.toDomain(document as unknown as MedicalDocumentPrimitiveType)
      : null;
  }

  async findAcceptedByGroupId(
    documentGroupId: string,
  ): Promise<MedicalDocument[]> {
    const documents = await this.medicalDocumentModel
      .find({
        $or: [
          { documentGroupId },
          { id: documentGroupId, documentGroupId: { $exists: false } },
        ],
        status: MedicalDocumentStatus.Accepted,
      })
      .sort({ createdAt: 1, id: 1 })
      .lean()
      .exec();
    return documents.map((document) =>
      this.toDomain(document as unknown as MedicalDocumentPrimitiveType),
    );
  }

  async findActiveReplacementForGroup(
    documentGroupId: string,
  ): Promise<MedicalDocument | null> {
    const document = await this.medicalDocumentModel
      .findOne({
        documentGroupId,
        replacementOfDocumentId: { $exists: true },
        status: {
          $in: [
            MedicalDocumentStatus.PendingUpload,
            MedicalDocumentStatus.Analyzing,
            MedicalDocumentStatus.ReviewPending,
          ],
        },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return document
      ? this.toDomain(document as unknown as MedicalDocumentPrimitiveType)
      : null;
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

  async updateManyAtomically(
    documents: Array<{
      document: MedicalDocument;
      expectedVersion: number;
    }>,
  ): Promise<boolean> {
    const session = await this.medicalDocumentModel.db.startSession();
    let allMatched = true;
    try {
      await session.withTransaction(async () => {
        for (const target of documents) {
          const result = await this.medicalDocumentModel
            .updateOne(
              { id: target.document.id, version: target.expectedVersion },
              { $set: target.document.toPrimitives() },
            )
            .session(session)
            .exec();
          if (result.matchedCount === 0) {
            allMatched = false;
            throw new Error('MEDICAL_DOCUMENT_VERSION_CONFLICT');
          }
        }
      });
      return allMatched;
    } catch (error) {
      if (
        !allMatched &&
        error instanceof Error &&
        error.message === 'MEDICAL_DOCUMENT_VERSION_CONFLICT'
      ) {
        return false;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async delete(documentId: string, expectedVersion?: number): Promise<boolean> {
    const query: Record<string, unknown> = { id: documentId };
    if (expectedVersion !== undefined) query.version = expectedVersion;
    const result = await this.medicalDocumentModel.deleteOne(query).exec();
    return result.deletedCount > 0;
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
