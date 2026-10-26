import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import {
  ArchiveFile,
  ObjectRevision,
  OwnershipArchive,
  archiveHash,
} from './ownership-archive';
import {
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  assertArchiveMaterialization,
  assertMaterializationIntent,
  verifiedArchiveMaterializationDestination,
} from './ownership-archive-materialization';
import { ArchiveEntryReferencePlan } from './ownership-archive-reference-plan';

export const ARCHIVE_MEDIA_REGISTRATION_PROTOCOL =
  'ARCHIVE_MEDIA_REGISTRATION_V1' as const;

/** Evidence only, deliberately NOT an ordinary upload ticket or an access grant. */
export type ArchiveMediaRegistration = {
  protocol: typeof ARCHIVE_MEDIA_REGISTRATION_PROTOCOL;
  id: string;
  archiveId: string;
  archiveDefinitionHash: string;
  materializationDefinitionHash: string;
  fileId: string;
  fileDefinitionHash: string;
  intentDefinitionHash: string;
  animalId: string;
  fromOwnerId: string;
  recipientId: string;
  sourcePeriodId: string;
  sourceOwnershipVersion: number;
  transferId: string;
  key: string;
  revision: ObjectRevision;
  sha256: string;
  mode: 'LIVE_RESOURCE' | 'RETAINED_READ_ONLY';
  retained?: ArchiveFile['retained'];
  state: 'PREPARED';
  definitionHash: string;
};

export interface OwnershipArchiveMediaRegistrationRepository {
  registerFile(
    archiveId: string,
    fileId: string,
  ): Promise<ArchiveMediaRegistration>;
}

export function assertMediaRegistrationArchive(
  archive: OwnershipArchive,
): void {
  assertArchiveMaterialization(archive);
  if (
    archive.materialization!.protocol !==
      ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL ||
    archive.materialization!.phase !== 'MATERIALIZED'
  )
    throw new ConflictError(
      'Media registration requires generational MATERIALIZED evidence',
    );
}

/** Derives identity from persisted verified evidence, never caller-supplied keys/revisions. */
export function buildArchiveMediaRegistration(
  archive: OwnershipArchive,
  file: ArchiveFile,
  plan: ArchiveEntryReferencePlan,
): ArchiveMediaRegistration {
  assertMediaRegistrationArchive(archive);
  const destination = verifiedArchiveMaterializationDestination(
    archive,
    file,
    plan,
  );
  const intent = file.materialization!.intent;
  assertMaterializationIntent(intent);
  const revision = destination.revision;
  if (
    plan.mode !== (file.retained ? 'RETAINED_READ_ONLY' : 'LIVE_RESOURCE') ||
    file.materialization!.leaseToken !== undefined ||
    file.materialization!.leaseUntil !== undefined ||
    typeof revision.etag !== 'string' ||
    !revision.etag ||
    (revision.versionId !== undefined &&
      (typeof revision.versionId !== 'string' || !revision.versionId))
  )
    throw new ConflictError('Media registration provenance is inconsistent');
  if (file.retained) {
    new Uuid(file.retained.rootArchiveId);
    new Uuid(file.retained.sourceArchiveId);
    if (
      file.retained.sourceArchiveId !== archive.history?.sourceArchiveId ||
      file.retained.sha256 !== destination.sha256 ||
      ![
        file.retained.rootFileId,
        file.retained.sourceFileId,
        file.retained.sourceDefinitionHash,
      ].every(
        (value) =>
          typeof value === 'string' &&
          value.length === 64 &&
          /^[a-f0-9]+$/.test(value),
      )
    )
      throw new ConflictError(
        'Retained media registration provenance is inconsistent',
      );
  }
  const definition: Omit<ArchiveMediaRegistration, 'definitionHash'> = {
    protocol: ARCHIVE_MEDIA_REGISTRATION_PROTOCOL,
    id: archiveHash([ARCHIVE_MEDIA_REGISTRATION_PROTOCOL, archive.id, file.id]),
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    materializationDefinitionHash: archive.materialization!.definitionHash,
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    intentDefinitionHash: intent.definitionHash,
    animalId: archive.animalId,
    fromOwnerId: archive.ownerId,
    recipientId: archive.recipientId,
    sourcePeriodId: archive.periodId,
    sourceOwnershipVersion: archive.ownershipVersion,
    transferId: archive.transferId,
    key: destination.key,
    revision: {
      etag: revision.etag,
      size: revision.size,
      ...(revision.versionId !== undefined
        ? { versionId: revision.versionId }
        : {}),
    },
    sha256: destination.sha256,
    mode: plan.mode,
    ...(file.retained
      ? {
          retained: {
            rootArchiveId: file.retained.rootArchiveId,
            rootFileId: file.retained.rootFileId,
            relativeKey: file.retained.relativeKey,
            sourceArchiveId: file.retained.sourceArchiveId,
            sourceFileId: file.retained.sourceFileId,
            sourceDefinitionHash: file.retained.sourceDefinitionHash,
            sha256: file.retained.sha256,
          },
        }
      : {}),
    state: 'PREPARED',
  };
  return { ...definition, definitionHash: archiveHash(definition) };
}

export function assertSameMediaRegistration(
  stored: ArchiveMediaRegistration,
  expected: ArchiveMediaRegistration,
): void {
  // Ignore only persistence-owned Mongo fields; all registry data is immutable.
  const record = { ...stored } as ArchiveMediaRegistration & {
    _id?: unknown;
    __v?: unknown;
  };
  delete record._id;
  delete record.__v;
  if (archiveHash(record) !== archiveHash(expected))
    throw new ConflictError(
      'The archive media registration already has different evidence',
    );
}
