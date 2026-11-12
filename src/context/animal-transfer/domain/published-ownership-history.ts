import { validate as isUuid } from 'uuid';
import type { AttachmentPrimitiveType } from '../../diary/domain/diary-entry';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import type { ArchiveEntry } from './ownership-archive';
import { sourceHashValid } from './transfer-item-historical-observation';
import { ITEM_MANIFEST_PAGE_SIZE } from './transfer-item-manifest-digest';

type HistoryOwner = Readonly<{ actorId: string; periodId: string }>;
export type PublishedHistoryCursor = Readonly<{
  publicationHash: string;
  afterEntryId: string;
}>;
export type PublishedHistoryPageInput = HistoryOwner &
  Readonly<{ limit: number; after?: PublishedHistoryCursor }>;
export type PublishedHistoryVersionInput = HistoryOwner &
  Readonly<{
    publicationHash: string;
    entryId: string;
    fileId: string;
    requiredThrough: string;
  }>;

const invalid = () =>
  new InvalidArgumentError('Invalid published ownership history selection');

export function publishedHistoryPageInput(raw: PublishedHistoryPageInput) {
  if (
    !raw ||
    ![raw.actorId, raw.periodId].every(isUuid) ||
    !Number.isSafeInteger(raw.limit) ||
    raw.limit < 1 ||
    raw.limit > ITEM_MANIFEST_PAGE_SIZE ||
    (raw.after !== undefined &&
      (!raw.after ||
        ![raw.after.publicationHash, raw.after.afterEntryId].every(
          sourceHashValid,
        )))
  )
    throw invalid();
  return Object.freeze({
    actorId: raw.actorId,
    periodId: raw.periodId,
    limit: raw.limit,
    after:
      raw.after &&
      Object.freeze({
        publicationHash: raw.after.publicationHash,
        afterEntryId: raw.after.afterEntryId,
      }),
  });
}

export function publishedHistoryVersionInput(
  raw: PublishedHistoryVersionInput,
) {
  const horizon = Date.parse(raw?.requiredThrough);
  if (
    !raw ||
    ![raw.actorId, raw.periodId].every(isUuid) ||
    ![raw.publicationHash, raw.entryId, raw.fileId].every(sourceHashValid) ||
    typeof raw.requiredThrough !== 'string' ||
    !Number.isFinite(horizon) ||
    new Date(horizon).toISOString() !== raw.requiredThrough
  )
    throw invalid();
  return Object.freeze({
    actorId: raw.actorId,
    periodId: raw.periodId,
    publicationHash: raw.publicationHash,
    entryId: raw.entryId,
    fileId: raw.fileId,
    requiredThrough: raw.requiredThrough,
  });
}

const medicalFields = [
  'id',
  'ownerId',
  'documentGroupId',
  'animalIds',
  'originalFileName',
  'description',
  'mimeType',
  'fileSize',
  'status',
  'requestedCategory',
  'primaryDetectedCategory',
  'detectedCategories',
  'classificationOutcome',
  'extractionsByCategory',
  'finalCategory',
  'documentCode',
  'documentSequence',
  'documentCountryCode',
  'validatedExtraction',
  'assignments',
  'version',
  'createdAt',
  'updatedAt',
  'reviewedAt',
  'acceptedAt',
] as const;

/** Renders a rebuilt entry with references scoped to the historical record. */
export function projectPublishedHistoryEntry(entry: ArchiveEntry) {
  const payload = structuredClone(entry.payload);
  let data = payload;
  switch (entry.kind) {
    case 'ANIMAL':
      delete data.profilePictureUrl;
      break;
    case 'DIARY_ENTRY':
      data.attachments = (payload.attachments as AttachmentPrimitiveType[]).map(
        ({ id, fileName, fileType, mimeType, size, createdAt }) => ({
          id,
          fileName,
          fileType,
          mimeType,
          size,
          createdAt,
        }),
      );
      break;
    case 'MEDICAL_DOCUMENT':
      data = Object.fromEntries(
        medicalFields
          .filter((field) =>
            Object.prototype.hasOwnProperty.call(payload, field),
          )
          .map((field) => [field, payload[field]]),
      );
      break;
    default:
      throw invalid();
  }
  const media =
    entry.kind === 'MEDICAL_DOCUMENT'
      ? [...new Set(entry.fileBindings.map(({ fileId }) => fileId))].map(
          (fileId) => ({ fileId }),
        )
      : entry.fileBindings.map(({ path, fileId }) => ({ path, fileId }));
  return Object.freeze({
    entryId: entry.id,
    resourceId: entry.resourceId,
    kind: entry.kind,
    data,
    media: Object.freeze(media.map((reference) => Object.freeze(reference))),
  });
}
