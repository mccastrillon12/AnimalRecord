import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MedicalDocumentFeedbackMongoDocument =
  HydratedDocument<MedicalDocumentFeedbackEntity>;

@Schema({ collection: 'medical_document_feedback_totals' })
export class MedicalDocumentFeedbackEntity {
  @Prop({ required: true })
  _id: string;

  @Prop({ required: true, default: 0, min: 0 })
  likes: number;

  @Prop({ required: true, default: 0, min: 0 })
  dislikes: number;

  @Prop({ required: true })
  updatedAt: string;
}

export const MedicalDocumentFeedbackSchema = SchemaFactory.createForClass(
  MedicalDocumentFeedbackEntity,
);
