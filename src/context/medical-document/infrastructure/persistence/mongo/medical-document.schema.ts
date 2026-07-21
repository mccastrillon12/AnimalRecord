import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { MedicalDocumentStatus } from '../../../domain/medical-document';

export type MedicalDocumentMongoDocument =
  HydratedDocument<MedicalDocumentEntity>;

@Schema({ collection: 'medical_documents' })
export class MedicalDocumentEntity {
  @Prop({ unique: true, required: true })
  id: string;

  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ type: [String], required: true, index: true })
  animalIds: string[];

  @Prop({ required: true })
  originalFileName: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop({ required: true })
  storageKey: string;

  @Prop({
    required: true,
    enum: Object.values(MedicalDocumentStatus),
    index: true,
  })
  status: MedicalDocumentStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  extraction?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  validatedExtraction?: Record<string, unknown>;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  assignments: Array<Record<string, unknown>>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  providerMetadata?: Record<string, unknown>;

  @Prop()
  failureReason?: string;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  createdAt: string;

  @Prop({ required: true })
  updatedAt: string;

  @Prop()
  reviewedAt?: string;
}

export const MedicalDocumentSchema = SchemaFactory.createForClass(
  MedicalDocumentEntity,
);
MedicalDocumentSchema.index({ animalIds: 1, status: 1, createdAt: -1 });
