import { Schema } from 'mongoose';
import { ItemCopyRecord } from '../../../domain/transfer-item-copy-record';
export const ITEM_COPY_RECORD_MODEL = 'TransferItemCopyRecord';
export const ITEM_COPY_RECORD_COLLECTION = 'animal_transfer_copy_records';
export const ItemCopyRecordSchema = new Schema<ItemCopyRecord>(
  {
    id: { type: String, required: true },
    protocol: { type: String, required: true, enum: ['ITEM_COPY_RECORDS_V1'] },
    row: {
      type: String,
      required: true,
      enum: [
        'GATE',
        'ATTEMPT',
        'STABLE_CUT_ACCREDITATION',
        'PUBLISHED_HISTORY_STABLE_CUT_ACCREDITATION',
        'PUBLISHED_HISTORY_CONSERVATION',
      ],
    },
    gateId: { type: String, required: true },
    state: {
      type: String,
      required: true,
      enum: ['OPEN', 'REVOKED', 'INTENDED', 'RECORDED'],
    },
    identityIds: { type: [String], required: true, default: undefined },
    binding: { type: Schema.Types.Mixed, required: false },
    definitionHash: { type: String, required: false },
    revision: { type: Number, required: false },
    revocation: { type: Schema.Types.Mixed, required: false },
    copyIntentId: { type: String, required: false },
    ordinal: { type: Number, required: false },
    definition: { type: Schema.Types.Mixed, required: false },
    sourceArtifactMetadata: { type: Schema.Types.Mixed, required: false },
    destinationProtection: { type: Schema.Types.Mixed, required: false },
    stagingDestinationAccreditation: {
      type: Schema.Types.Mixed,
      required: false,
    },
    finalDestinationAccreditation: {
      type: Schema.Types.Mixed,
      required: false,
    },
    permission: { type: Schema.Types.Mixed, required: false },
    transportObservation: { type: Schema.Types.Mixed, required: false },
    versionRecord: { type: Schema.Types.Mixed, required: false },
    delegationBound: { type: Schema.Types.Mixed, required: false },
    scope: { type: Schema.Types.Mixed, required: false },
    accreditation: { type: Schema.Types.Mixed, required: false },
    accreditationHash: { type: String, required: false },
    recordedAt: { type: String, required: false },
    historyConservation: { type: Schema.Types.Mixed, required: false },
  },
  {
    collection: ITEM_COPY_RECORD_COLLECTION,
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
    strict: 'throw',
    minimize: false,
  },
);
ItemCopyRecordSchema.index({ id: 1 }, { unique: true });
ItemCopyRecordSchema.index({ identityIds: 1 }, { unique: true });
ItemCopyRecordSchema.index(
  { copyIntentId: 1, ordinal: 1 },
  { unique: true, partialFilterExpression: { row: 'ATTEMPT' } },
);
ItemCopyRecordSchema.index({ gateId: 1, row: 1, id: 1 });
