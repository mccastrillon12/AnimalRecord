import { Schema } from 'mongoose';
import {
  TransferredMediaRegistration,
  ARCHIVE_MEDIA_REGISTRATION_PROTOCOL,
  ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_PROTOCOL,
  PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL,
} from '../../../domain/ownership-archive-media-registration';

export const OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL =
  'OwnershipArchiveMediaRegistration';
export const OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_COLLECTION =
  'animal_transferred_media';
export const OwnershipArchiveMediaRegistrationSchema =
  new Schema<TransferredMediaRegistration>(
    {
      protocol: {
        type: String,
        required: true,
        enum: [
          ARCHIVE_MEDIA_REGISTRATION_PROTOCOL,
          ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_PROTOCOL,
          PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL,
        ],
      },
      id: { type: String, required: true, unique: true },
      archiveId: { type: String, required: true },
      archiveDefinitionHash: { type: String, required: true },
      materializationDefinitionHash: {
        type: String,
        required(this: TransferredMediaRegistration) {
          return this.protocol === ARCHIVE_MEDIA_REGISTRATION_PROTOCOL;
        },
      },
      itemEvidence: {
        type: Schema.Types.Mixed,
        required(this: TransferredMediaRegistration) {
          return (
            this.protocol === ITEM_RECIPIENT_FINAL_MEDIA_REGISTRATION_PROTOCOL
          );
        },
      },
      fileId: { type: String, required: true },
      publishedHistoryEvidence: {
        type: Schema.Types.Mixed,
        required(this: TransferredMediaRegistration) {
          return (
            this.protocol ===
            PUBLISHED_HISTORY_FINAL_MEDIA_REGISTRATION_PROTOCOL
          );
        },
      },
      fileDefinitionHash: { type: String, required: true },
      intentDefinitionHash: { type: String, required: true },
      animalId: { type: String, required: true },
      fromOwnerId: { type: String, required: true },
      recipientId: { type: String, required: true },
      sourcePeriodId: { type: String, required: true },
      sourceOwnershipVersion: { type: Number, required: true, min: 1 },
      transferId: { type: String, required: true },
      key: { type: String, required: true, unique: true },
      revision: { type: Schema.Types.Mixed, required: true },
      sha256: { type: String, required: true },
      mode: {
        type: String,
        required: true,
        enum: ['LIVE_RESOURCE', 'RETAINED_READ_ONLY'],
      },
      retained: { type: Schema.Types.Mixed, required: false },
      state: { type: String, required: true, enum: ['PREPARED'] },
      definitionHash: { type: String, required: true },
    },
    {
      collection: OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_COLLECTION,
      versionKey: false,
    },
  );
OwnershipArchiveMediaRegistrationSchema.index(
  { archiveId: 1, fileId: 1 },
  { unique: true },
);
