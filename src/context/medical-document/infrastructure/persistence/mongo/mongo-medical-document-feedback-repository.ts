import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MedicalDocumentFeedbackRepository,
  MedicalDocumentFeedbackSummary,
  MedicalDocumentFeedbackValue,
} from '../../../domain/medical-document-feedback';
import {
  MedicalDocumentFeedbackEntity,
  MedicalDocumentFeedbackMongoDocument,
} from './medical-document-feedback.schema';

const GLOBAL_FEEDBACK_ID = 'medical_document_ai_feedback';

@Injectable()
export class MongoMedicalDocumentFeedbackRepository implements MedicalDocumentFeedbackRepository {
  constructor(
    @InjectModel(MedicalDocumentFeedbackEntity.name)
    private readonly model: Model<MedicalDocumentFeedbackMongoDocument>,
  ) {}

  async increment(value: MedicalDocumentFeedbackValue): Promise<void> {
    const field =
      value === MedicalDocumentFeedbackValue.Like ? 'likes' : 'dislikes';

    await this.model
      .findByIdAndUpdate(
        GLOBAL_FEEDBACK_ID,
        {
          $inc: { [field]: 1 },
          $set: { updatedAt: new Date().toISOString() },
        },
        { upsert: true },
      )
      .exec();
  }

  async summary(): Promise<MedicalDocumentFeedbackSummary> {
    const totals = await this.model.findById(GLOBAL_FEEDBACK_ID).lean().exec();
    const likes = totals?.likes || 0;
    const dislikes = totals?.dislikes || 0;
    const total = likes + dislikes;

    return {
      likes,
      dislikes,
      total,
      approvalRate:
        total === 0 ? 0 : Number(((likes / total) * 100).toFixed(2)),
    };
  }
}
