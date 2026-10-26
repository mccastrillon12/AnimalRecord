import { Schema } from 'mongoose';
import {
  ArchiveMediaRegistration,
  ARCHIVE_MEDIA_REGISTRATION_PROTOCOL,
} from '../../../domain/ownership-archive-media-registration';

export const OWNERSHIP_ARCHIVE_MEDIA_REGISTRATION_MODEL =
  'OwnershipArchiveMediaRegistration';
export const OwnershipArchiveMediaRegistrationSchema =
  new Schema<ArchiveMediaRegistration>(
    {
      protocol: {
        type: String,
        required: true,
        enum: [ARCHIVE_MEDIA_REGISTRATION_PROTOCOL],
      },
      id: { type: String, required: true, unique: true },
      archiveId: { type: String, required: true },
      archiveDefinitionHash: { type: String, required: true },
      materializationDefinitionHash: { type: String, required: true },
      fileId: { type: String, required: true },
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
    { collection: 'animal_transferred_media', versionKey: false },
  );
OwnershipArchiveMediaRegistrationSchema.index(
  { archiveId: 1, fileId: 1 },
  { unique: true },
);
