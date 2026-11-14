import { validate as isUuid } from 'uuid';
import type { AttachmentPrimitiveType } from '../../diary/domain/diary-entry';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  archiveHash,
  buildArchiveEntry,
  type ArchiveDefinition,
  type ArchiveEntry,
  type ArchiveRecordInput,
  type ObjectRevision,
} from './ownership-archive';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { sourceHashValid } from './transfer-item-historical-observation';
import { ITEM_MANIFEST_PAGE_SIZE } from './transfer-item-manifest-digest';
import type { ItemHistoricalPutVersionScope } from './transfer-item-historical-put-reconciliation';

type HistoryOwner = Readonly<{ actorId: string; periodId: string }>;
export type PublishedHistoryPeriodsInput = Readonly<{
  actorId: string;
  limit: number;
  after?: Readonly<{ actorId: string; afterPeriodId: string }>;
}>;
export type PublishedHistoryPeriodSummary = Readonly<{
  periodId: string;
  animalId: string;
  ownershipVersion: number;
  startedAt?: string;
  endedAt: string;
  publicationHash: string;
  mode: 'HISTORICAL_READ_ONLY';
}>;
export type PublishedHistoryCursor = Readonly<{
  publicationHash: string;
  afterEntryId: string;
}>;
export type PublishedHistoryPageInput = HistoryOwner &
  Readonly<{
    limit: number;
    publicationHash?: string;
    after?: PublishedHistoryCursor;
  }>;

export type PublishedHistoryPeriodsPage = Readonly<{
  periods: readonly PublishedHistoryPeriodSummary[];
  nextCursor?: PublishedHistoryPeriodsInput['after'];
}>;

export type PublishedOwnershipHistoryPage = PublishedHistoryPeriodSummary &
  Readonly<{
    entries: readonly (
      | ReturnType<typeof projectPublishedHistoryEntry>
      | ReturnType<typeof projectPublishedRetainedEntry>
    )[];
    nextCursor?: PublishedHistoryCursor;
  }>;

export interface PublishedOwnershipHistorySource {
  listPublishedOwnershipPeriods(
    input: PublishedHistoryPeriodsInput,
  ): Promise<PublishedHistoryPeriodsPage>;
  readPublishedOwnershipHistory(
    input: PublishedHistoryPageInput,
    keyFromUrl: (url: string) => string | undefined,
  ): Promise<PublishedOwnershipHistoryPage>;
}
export type PublishedHistoryFileInput = HistoryOwner &
  Readonly<{
    publicationHash: string;
    entryId: string;
    fileId: string;
  }>;
export type PublishedHistoryVersionInput = PublishedHistoryFileInput &
  Readonly<{ requiredThrough: string }>;
export type PublishedHistoryFileVersion = Readonly<{
  fileDefinitionHash: string;
  target: ItemHistoricalPutVersionScope['target'];
  revision: Readonly<ObjectRevision>;
  sha256: string;
  requiredThrough: string;
}>;

export interface PublishedHistoryVersionSource {
  readPublishedHistoryFileVersion(
    input: PublishedHistoryVersionInput,
    keyFromUrl: (url: string) => string | undefined,
  ): Promise<PublishedHistoryFileVersion>;
}

const invalid = () =>
  new InvalidArgumentError('Invalid published ownership history selection');

export function publishedHistoryPeriodsInput(
  raw: PublishedHistoryPeriodsInput,
) {
  if (
    !raw ||
    !isUuid(raw.actorId) ||
    !Number.isSafeInteger(raw.limit) ||
    raw.limit < 1 ||
    raw.limit > ITEM_MANIFEST_PAGE_SIZE ||
    (raw.after !== undefined &&
      (!raw.after ||
        raw.after.actorId !== raw.actorId ||
        !isUuid(raw.after.afterPeriodId)))
  )
    throw invalid();
  const { actorId, limit, after } = raw;
  return Object.freeze({
    actorId,
    limit,
    after:
      after && Object.freeze({ actorId, afterPeriodId: after.afterPeriodId }),
  });
}

export function publishedHistoryPageInput(raw: PublishedHistoryPageInput) {
  if (
    !raw ||
    ![raw.actorId, raw.periodId].every(isUuid) ||
    !Number.isSafeInteger(raw.limit) ||
    raw.limit < 1 ||
    raw.limit > ITEM_MANIFEST_PAGE_SIZE ||
    (raw.publicationHash !== undefined &&
      !sourceHashValid(raw.publicationHash)) ||
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
    ...(raw.publicationHash === undefined
      ? {}
      : { publicationHash: raw.publicationHash }),
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
    typeof raw?.requiredThrough !== 'string' ||
    !Number.isFinite(horizon) ||
    new Date(horizon).toISOString() !== raw.requiredThrough
  )
    throw invalid();
  return Object.freeze({
    ...publishedHistoryFileInput(raw),
    requiredThrough: raw.requiredThrough,
  });
}

export function publishedHistoryFileInput(raw: PublishedHistoryFileInput) {
  if (
    !raw ||
    ![raw.actorId, raw.periodId].every(isUuid) ||
    ![raw.publicationHash, raw.entryId, raw.fileId].every(sourceHashValid)
  )
    throw invalid();
  return Object.freeze({
    actorId: raw.actorId,
    periodId: raw.periodId,
    publicationHash: raw.publicationHash,
    entryId: raw.entryId,
    fileId: raw.fileId,
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

/** Reuses the original entry codec and exposes only the references of this closed period. */
export function projectPublishedRetainedEntry(
  archive: ArchiveDefinition,
  predecessor: ArchiveDefinition,
  entry: ArchiveEntry,
  publicationHash: string,
  consumptionHash: string,
  keyFromUrl: (url: string) => string | undefined,
) {
  const invalid = () =>
    new ConflictError('The published retained entry is inconsistent');
  const { retained, retainedReferences: links, fileBindings } = entry;
  if (
    entry.kind !== 'RETAINED_RECORD' ||
    entry.archiveId !== archive.id ||
    !retained ||
    !links ||
    retained.rootArchiveId !== predecessor.id ||
    retained.sourceArchiveId !== predecessor.id ||
    retained.sourcePublicationHash !== publicationHash ||
    retained.periodId !== predecessor.periodId ||
    retained.ownerId !== predecessor.ownerId ||
    retained.ownershipVersion !== predecessor.ownershipVersion ||
    retained.rootEntryId !== retained.sourceEntryId ||
    !Array.isArray(fileBindings) ||
    !Array.isArray(links.references) ||
    links.references.length !== fileBindings.length
  )
    throw invalid();
  const { definitionHash, ...referenceFacts } = links;
  const resourceId = archiveHash([predecessor.id, retained.sourceEntryId]);
  if (
    entry.resourceId !== resourceId ||
    entry.id !== archiveHash([archive.id, 'RETAINED_RECORD', resourceId]) ||
    entry.contentHash !==
      archiveHash({
        kind: entry.kind,
        payload: entry.payload,
        fileBindings,
        retained,
      }) ||
    links.protocol !== 'PUBLISHED_HISTORY_RETAINED_REFERENCES_V1' ||
    links.mode !== 'RETAINED_READ_ONLY' ||
    links.archiveId !== archive.id ||
    links.entryId !== entry.id ||
    links.sourceContentHash !== entry.contentHash ||
    links.consumptionHash !== consumptionHash ||
    archiveHash(referenceFacts) !== definitionHash
  )
    throw invalid();
  if (!['ANIMAL', 'DIARY_ENTRY', 'MEDICAL_DOCUMENT'].includes(retained.kind))
    throw invalid();
  const { entry: original } = buildArchiveEntry(
    predecessor,
    {
      kind: retained.kind,
      data: entry.payload,
    } as ArchiveRecordInput,
    keyFromUrl,
  );
  if (
    original.id !== retained.sourceEntryId ||
    original.resourceId !== retained.resourceId ||
    original.contentHash !== retained.sourceContentHash ||
    original.fileBindings.length !== fileBindings.length ||
    fileBindings.some(
      ({ path, fileId }, index) =>
        path !== original.fileBindings[index].path ||
        !sourceHashValid(fileId) ||
        links.references[index]?.fileId !== fileId ||
        links.references[index]?.path !== path ||
        links.references[index]?.format !==
          (retained.kind === 'MEDICAL_DOCUMENT' ? 'KEY' : 'URL') ||
        !sourceHashValid(links.references[index]?.registrationId) ||
        !sourceHashValid(links.references[index]?.registrationDefinitionHash),
    )
  )
    throw invalid();
  const view = projectPublishedHistoryEntry({ ...entry, kind: retained.kind });
  return Object.freeze({
    ...view,
    kind: 'RETAINED_RECORD' as const,
    sourceKind: retained.kind,
    sourcePeriodId: retained.periodId,
    sourceResourceId: retained.resourceId,
  });
}
