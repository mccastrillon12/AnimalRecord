import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  MedicalDocumentClassificationOutcome,
  MedicalDocumentRejectionReason,
  MedicalDocumentStatus,
  MedicalDocumentType,
} from '../../../domain/medical-document';

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

  @Prop()
  temporaryStorageKey?: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  documentLocations: Array<Record<string, unknown>>;

  @Prop({
    required: true,
    enum: Object.values(MedicalDocumentStatus),
    index: true,
  })
  status: MedicalDocumentStatus;

  @Prop({ enum: Object.values(MedicalDocumentType), index: true })
  requestedCategory?: MedicalDocumentType;

  @Prop({ enum: Object.values(MedicalDocumentType), index: true })
  primaryDetectedCategory?: MedicalDocumentType;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  detectedCategories: Array<Record<string, unknown>>;

  @Prop({ enum: Object.values(MedicalDocumentClassificationOutcome) })
  classificationOutcome?: MedicalDocumentClassificationOutcome;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  extractionsByCategory: Record<string, unknown>;

  @Prop({ enum: Object.values(MedicalDocumentType), index: true })
  finalCategory?: MedicalDocumentType;

  @Prop()
  documentCode?: string;

  @Prop()
  documentSequence?: number;

  @Prop()
  documentCountryCode?: string;

  /** Legacy field retained in the schema so older records can be read. */
  @Prop({ type: MongooseSchema.Types.Mixed })
  extraction?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  validatedExtraction?: Record<string, unknown>;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  assignments: Array<Record<string, unknown>>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  providerMetadata?: Record<string, unknown>;

  @Prop()
  analysisInvocationArn?: string;

  @Prop()
  analysisOutputUri?: string;

  @Prop()
  failureReason?: string;

  @Prop({ enum: Object.values(MedicalDocumentRejectionReason) })
  rejectionReason?: MedicalDocumentRejectionReason;

  @Prop()
  rejectionComment?: string;

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
MedicalDocumentSchema.index({
  animalIds: 1,
  finalCategory: 1,
  status: 1,
  createdAt: -1,
});
MedicalDocumentSchema.index(
  { documentCode: 1 },
  {
    unique: true,
    partialFilterExpression: { documentCode: { $type: 'string' } },
  },
);
