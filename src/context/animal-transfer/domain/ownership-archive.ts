import { createHash } from 'crypto';
import { AnimalPrimitiveType } from '../../animal/domain/animal';
import { DiaryEntryPrimitiveType } from '../../diary/domain/diary-entry';
import {
  MedicalDocumentPrimitiveType,
  MedicalDocumentStatus,
} from '../../medical-document/domain/medical-document';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';

export type ArchiveDefinition = {
  id: string;
  animalId: string;
  ownerId: string;
  recipientId: string;
  periodId: string;
  transferId: string;
  ownershipVersion: number;
};

/** READY means prepared, never published or an effective ownership change. */
export type ArchiveState = 'COLLECTING' | 'COPYING' | 'READY';
export type OwnershipArchive = ArchiveDefinition & {
  definitionHash: string;
  state: ArchiveState;
  createdAt: string;
  expectedEntryCount?: number;
  expectedFileCount?: number;
};

export type ArchiveRecordInput =
  | { kind: 'ANIMAL'; data: AnimalPrimitiveType }
  | { kind: 'DIARY_ENTRY'; data: DiaryEntryPrimitiveType }
  | { kind: 'MEDICAL_DOCUMENT'; data: MedicalDocumentPrimitiveType };

export type ArchiveEntry = {
  id: string;
  archiveId: string;
  kind: ArchiveRecordInput['kind'];
  resourceId: string;
  payload: Record<string, unknown>;
  fileBindings: Array<{ path: string; fileId: string }>;
  contentHash: string;
};

export type ObjectRevision = { etag: string; size: number; versionId?: string };
export type VerifiedArchiveCopies = {
  sha256: string;
  historical: ObjectRevision;
  recipientStaging: ObjectRevision;
};
export type ArchiveFile = {
  id: string;
  archiveId: string;
  sourceKey: string;
  relativeKey: string;
  historicalKey: string;
  recipientStagingKey: string;
  recipientFinalKey: string;
  source: ObjectRevision;
  definitionHash: string;
  state: 'PENDING' | 'COPYING' | 'VERIFIED';
  leaseToken?: string;
  leaseUntil?: string;
  verified?: VerifiedArchiveCopies;
};

export interface OwnershipArchiveStorage {
  keyFromUrl(url: string): string | undefined;
  inspect(key: string): Promise<ObjectRevision>;
  copyAndVerify(file: ArchiveFile): Promise<VerifiedArchiveCopies>;
}

export interface OwnershipArchiveRepository {
  create(archive: OwnershipArchive): Promise<OwnershipArchive>;
  find(id: string): Promise<OwnershipArchive | null>;
  findEntry(archiveId: string, entryId: string): Promise<ArchiveEntry | null>;
  append(
    archiveId: string,
    entry: ArchiveEntry,
    files: ArchiveFile[],
  ): Promise<void>;
  seal(archiveId: string, expectedEntryCount: number): Promise<void>;
  listEntries(
    archiveId: string,
    afterId: string | undefined,
    limit: number,
  ): Promise<ArchiveEntry[]>;
  claimFile(
    archiveId: string,
    token: string,
    now: string,
    leaseUntil: string,
  ): Promise<ArchiveFile | null>;
  completeFile(
    fileId: string,
    token: string,
    verified: VerifiedArchiveCopies,
  ): Promise<boolean>;
  releaseFile(fileId: string, token: string): Promise<void>;
  markReadyIfComplete(archiveId: string): Promise<boolean>;
}

export function archiveHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function validateArchiveDefinition(definition: ArchiveDefinition): void {
  for (const id of [
    definition.id,
    definition.animalId,
    definition.ownerId,
    definition.recipientId,
    definition.periodId,
    definition.transferId,
  ])
    new Uuid(id);
  if (
    definition.ownerId === definition.recipientId ||
    !Number.isSafeInteger(definition.ownershipVersion) ||
    definition.ownershipVersion < 1
  ) {
    throw new InvalidArgumentError('Invalid ownership archive definition');
  }
}

/** Build from a frozen cut. Does not authorize or read the live dossier. */
export function buildArchiveEntry(
  definition: ArchiveDefinition,
  input: ArchiveRecordInput,
  keyFromUrl: (url: string) => string | undefined,
): {
  entry: ArchiveEntry;
  files: Array<Omit<ArchiveFile, 'source' | 'definitionHash' | 'state'>>;
} {
  const prefix = `users/${definition.ownerId}/animals/${definition.animalId}/`;
  const fileBindings: ArchiveEntry['fileBindings'] = [];
  const files = new Map<
    string,
    Omit<ArchiveFile, 'source' | 'definitionHash' | 'state'>
  >();
  const addFile = (key: string | undefined, path: string) => {
    if (
      !key ||
      !key.startsWith(prefix) ||
      key.includes('\\') ||
      key
        .split('/')
        .some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new ConflictError(
        'Archive files must belong to the animal and current owner',
      );
    }
    const relativeKey = key.slice(prefix.length);
    // Staging/history are not live sources; explicit inheritance comes later.
    if (/^(ownership-archives|transfer-preparations)\//.test(relativeKey)) {
      throw new ConflictError('Retained history must be imported explicitly');
    }
    const id = archiveHash([definition.id, key]);
    files.set(id, {
      id,
      archiveId: definition.id,
      sourceKey: key,
      relativeKey,
      historicalKey: `${prefix}ownership-archives/${definition.id}/${relativeKey}`,
      recipientStagingKey: `users/${definition.recipientId}/animals/${definition.animalId}/transfer-preparations/${definition.id}/${relativeKey}`,
      recipientFinalKey: `users/${definition.recipientId}/animals/${definition.animalId}/${relativeKey}`,
    });
    fileBindings.push({ path, fileId: id });
  };

  switch (input.kind) {
    case 'ANIMAL':
      if (
        input.data.id !== definition.animalId ||
        input.data.ownerId !== definition.ownerId
      ) {
        throw new ConflictError(
          'The animal snapshot belongs to another owner or animal',
        );
      }
      if (input.data.isActive === false)
        throw new ConflictError('Only active animals can be transferred');
      if (input.data.profilePictureUrl)
        addFile(keyFromUrl(input.data.profilePictureUrl), '/profilePictureUrl');
      break;
    case 'DIARY_ENTRY':
      if (input.data.animalId !== definition.animalId)
        throw new ConflictError('The diary snapshot belongs to another animal');
      input.data.attachments.forEach((attachment, index) =>
        addFile(keyFromUrl(attachment.url), `/attachments/${index}/url`),
      );
      break;
    case 'MEDICAL_DOCUMENT': {
      const document = input.data;
      if (
        document.ownerId !== definition.ownerId ||
        document.animalIds.length !== 1 ||
        document.animalIds[0] !== definition.animalId ||
        document.status !== MedicalDocumentStatus.Accepted ||
        document.replacementOfDocumentId ||
        !document.validatedExtraction ||
        !document.finalCategory ||
        document.documentLocations?.length !== 1 ||
        document.documentLocations[0].animalId !== definition.animalId ||
        document.assignments.some(
          (assignment) => assignment.animalId !== definition.animalId,
        )
      ) {
        throw new ConflictError(
          'Medical archives require an accepted independent document for this animal',
        );
      }
      if (document.storageKey !== document.documentLocations[0].storageKey) {
        throw new ConflictError(
          'Medical storage references must be normalized before archiving',
        );
      }
      addFile(document.storageKey, '/storageKey');
      addFile(
        document.documentLocations[0].storageKey,
        '/documentLocations/0/storageKey',
      );
      break;
    }
  }

  const payload = JSON.parse(JSON.stringify(input.data)) as Record<
    string,
    unknown
  >;
  const entry: ArchiveEntry = {
    id: archiveHash([definition.id, input.kind, input.data.id]),
    archiveId: definition.id,
    kind: input.kind,
    resourceId: input.data.id,
    payload,
    fileBindings,
    contentHash: archiveHash({ kind: input.kind, payload, fileBindings }),
  };
  return { entry, files: [...files.values()] };
}
