import { Schema } from 'mongoose';
import {
  ArchiveEntry,
  ArchiveFile,
  OwnershipArchive,
} from '../../../domain/ownership-archive';

export const OWNERSHIP_ARCHIVE_MODEL = 'OwnershipArchive';
export const OWNERSHIP_ARCHIVE_ENTRY_MODEL = 'OwnershipArchiveEntry';
export const OWNERSHIP_ARCHIVE_FILE_MODEL = 'OwnershipArchiveFile';

export const OwnershipArchiveSchema = new Schema<OwnershipArchive>(
  {
    id: { type: String, required: true, unique: true },
    animalId: { type: String, required: true },
    ownerId: { type: String, required: true },
    recipientId: { type: String, required: true },
    periodId: { type: String, required: true },
    transferId: { type: String, required: true },
    ownershipVersion: { type: Number, required: true, min: 1 },
    definitionHash: { type: String, required: true },
    state: {
      type: String,
      required: true,
      enum: ['COLLECTING', 'COPYING', 'READY'],
    },
    createdAt: { type: String, required: true },
    expectedEntryCount: Number,
    expectedFileCount: Number,
    capture: {
      type: new Schema(
        {
          revision: { type: Number, required: true, min: 0 },
          phase: {
            type: String,
            required: true,
            enum: ['ANIMAL', 'DIARY', 'MEDICAL', 'COMPLETE'],
          },
          afterId: String,
          entryCount: { type: Number, required: true, min: 0 },
        },
        { _id: false },
      ),
      required: false,
    },
  },
  { collection: 'animal_ownership_archives' },
);
OwnershipArchiveSchema.index({ periodId: 1, transferId: 1 }, { unique: true });
OwnershipArchiveSchema.index({ ownerId: 1, animalId: 1, createdAt: -1 });

export const OwnershipArchiveEntrySchema = new Schema<ArchiveEntry>(
  {
    id: { type: String, required: true, unique: true },
    archiveId: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['ANIMAL', 'DIARY_ENTRY', 'MEDICAL_DOCUMENT'],
    },
    resourceId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    fileBindings: {
      type: [{ _id: false, path: String, fileId: String }],
      required: true,
      default: [],
    },
    contentHash: { type: String, required: true },
  },
  { collection: 'animal_ownership_archive_entries' },
);
OwnershipArchiveEntrySchema.index({ archiveId: 1, id: 1 });
OwnershipArchiveEntrySchema.index(
  { archiveId: 1, kind: 1, resourceId: 1 },
  { unique: true },
);

export const OwnershipArchiveFileSchema = new Schema<ArchiveFile>(
  {
    id: { type: String, required: true, unique: true },
    archiveId: { type: String, required: true },
    sourceKey: { type: String, required: true },
    relativeKey: { type: String, required: true },
    historicalKey: { type: String, required: true },
    recipientStagingKey: { type: String, required: true },
    recipientFinalKey: { type: String, required: true },
    source: { type: Schema.Types.Mixed, required: true },
    definitionHash: { type: String, required: true },
    state: {
      type: String,
      required: true,
      enum: ['PENDING', 'COPYING', 'VERIFIED'],
    },
    leaseToken: String,
    leaseUntil: String,
    verified: Schema.Types.Mixed,
  },
  { collection: 'animal_ownership_archive_files' },
);
OwnershipArchiveFileSchema.index({
  archiveId: 1,
  state: 1,
  leaseUntil: 1,
  id: 1,
});
OwnershipArchiveFileSchema.index(
  { archiveId: 1, sourceKey: 1 },
  { unique: true },
);
