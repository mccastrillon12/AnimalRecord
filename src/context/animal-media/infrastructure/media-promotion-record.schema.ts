import { Schema } from 'mongoose';
import {
  PromotionRow,
  MEDIA_PROMOTION_STORAGE_PROTOCOL,
} from '../domain/media-promotion-persistence';

export const MEDIA_PROMOTION_RECORD_MODEL = 'AnimalMediaPromotionRecord';
export const MediaPromotionRecordSchema = new Schema<PromotionRow>(
  {
    id: { type: String, required: true, unique: true },
    identityIds: { type: [String], required: true, default: undefined },
    operationId: { type: String, required: true },
    protocol: {
      type: String,
      required: true,
      enum: [MEDIA_PROMOTION_STORAGE_PROTOCOL],
    },
    kind: {
      type: String,
      required: true,
      enum: ['GATE', 'EFFECT', 'ATTEMPT', 'RESPONSE', 'OBSERVATION'],
    },
    gateRevision: { type: Number, required: true, min: 0 },
    effectId: String,
    uploadId: String,
    bucket: String,
    destinationKey: String,
    ordinal: { type: Number, min: 1 },
    authorizationId: String,
    attemptId: String,
    data: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: 'animal_media_promotion_records',
    minimize: false,
    strict: 'throw',
    versionKey: false,
    autoCreate: false,
    autoIndex: false,
  },
);
// Unique multikey registry prevents a grant/audit ID from aliasing ANY row ID.
MediaPromotionRecordSchema.index({ identityIds: 1 }, { unique: true });
MediaPromotionRecordSchema.index({ operationId: 1, kind: 1, id: 1 });
MediaPromotionRecordSchema.index(
  { operationId: 1, uploadId: 1 },
  { unique: true, partialFilterExpression: { kind: 'EFFECT' } },
);
MediaPromotionRecordSchema.index(
  { operationId: 1, bucket: 1, destinationKey: 1 },
  { unique: true, partialFilterExpression: { kind: 'EFFECT' } },
);
MediaPromotionRecordSchema.index(
  { effectId: 1, ordinal: 1 },
  { unique: true, partialFilterExpression: { kind: 'ATTEMPT' } },
);
