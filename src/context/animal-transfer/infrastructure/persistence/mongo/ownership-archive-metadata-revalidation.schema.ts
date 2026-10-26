import { Schema } from 'mongoose';
import {
  ArchiveMetadataRevalidation,
  ARCHIVE_METADATA_REVALIDATION_PROTOCOL,
} from '../../../domain/ownership-archive-metadata-revalidation';

export const OWNERSHIP_ARCHIVE_METADATA_REVALIDATION_MODEL =
  'OwnershipArchiveMetadataRevalidation';
export const OwnershipArchiveMetadataRevalidationSchema =
  new Schema<ArchiveMetadataRevalidation>(
    {
      id: { type: String, required: true, unique: true },
      archiveId: { type: String, required: true },
      protocol: {
        type: String,
        required: true,
        enum: [ARCHIVE_METADATA_REVALIDATION_PROTOCOL],
      },
      definitionHash: { type: String, required: true },
      phase: {
        type: String,
        required: true,
        enum: ['ENTRIES', 'FILES', 'METADATA_OBSERVED'],
      },
      revision: { type: Number, required: true, min: 0 },
      controlRevision: { type: Number, required: true, min: 1 },
      reservationHash: { type: String, required: true },
      reservationEpoch: { type: Number, required: false },
      entryCount: { type: Number, required: true, min: 0 },
      fileCount: { type: Number, required: true, min: 0 },
      entryAfterId: String,
      fileAfterId: String,
      entryDigest: { type: String, required: true },
      fileDigest: { type: String, required: true },
      startedAt: { type: String, required: true },
      observedAt: String,
      s3Observation: { type: Schema.Types.Mixed, required: false },
    },
    { collection: 'animal_archive_metadata_revalidations', versionKey: false },
  );
OwnershipArchiveMetadataRevalidationSchema.index({ archiveId: 1, id: 1 });
