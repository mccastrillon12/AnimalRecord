import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { OwnershipArchive, archiveHash } from './ownership-archive';
import { assertMediaRegistrationArchive } from './ownership-archive-media-registration';
import type { ArchiveS3Observation } from './ownership-archive-s3-observation';

export const ARCHIVE_METADATA_REVALIDATION_PROTOCOL =
  'ARCHIVE_METADATA_REVALIDATION_V1' as const;
export type ArchiveMetadataRevalidation = {
  id: string;
  archiveId: string;
  protocol: typeof ARCHIVE_METADATA_REVALIDATION_PROTOCOL;
  definitionHash: string;
  phase: 'ENTRIES' | 'FILES' | 'METADATA_OBSERVED';
  revision: number;
  controlRevision: number;
  reservationHash: string;
  entryCount: number;
  fileCount: number;
  entryAfterId?: string;
  fileAfterId?: string;
  entryDigest: string;
  fileDigest: string;
  startedAt: string;
  observedAt?: string;
  s3Observation?: ArchiveS3Observation;
};

export interface OwnershipArchiveMetadataRevalidationRepository {
  start(id: string, archiveId: string): Promise<ArchiveMetadataRevalidation>;
  nextPage(id: string, limit: number): Promise<ArchiveMetadataRevalidation>;
}

export function metadataRevalidationDefinition(
  id: string,
  archive: OwnershipArchive,
): string {
  new Uuid(id);
  assertMediaRegistrationArchive(archive);
  return archiveHash({
    protocol: ARCHIVE_METADATA_REVALIDATION_PROTOCOL,
    id,
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    referencePlan: archive.referencePlan,
    materialization: archive.materialization,
    history: archive.history,
    expectedEntryCount: archive.expectedEntryCount,
    expectedFileCount: archive.expectedFileCount,
  });
}

export function assertMetadataRevalidation(
  run: ArchiveMetadataRevalidation,
  archive: OwnershipArchive,
): void {
  const hash = (value: string) =>
    typeof value === 'string' &&
    value.length === 64 &&
    /^[a-f0-9]+$/.test(value);
  if (
    run.protocol !== ARCHIVE_METADATA_REVALIDATION_PROTOCOL ||
    run.archiveId !== archive.id ||
    run.definitionHash !== metadataRevalidationDefinition(run.id, archive) ||
    !['ENTRIES', 'FILES', 'METADATA_OBSERVED'].includes(run.phase) ||
    !Number.isSafeInteger(run.revision) ||
    run.revision < 0 ||
    !Number.isSafeInteger(run.controlRevision) ||
    run.controlRevision < 1 ||
    !Number.isSafeInteger(run.entryCount) ||
    run.entryCount < 0 ||
    run.entryCount > archive.expectedEntryCount! ||
    !Number.isSafeInteger(run.fileCount) ||
    run.fileCount < 0 ||
    run.fileCount > archive.expectedFileCount! ||
    !hash(run.reservationHash) ||
    !hash(run.entryDigest) ||
    !hash(run.fileDigest) ||
    (run.entryCount > 0
      ? !hash(run.entryAfterId ?? '')
      : run.entryAfterId !== undefined ||
        run.entryDigest !== archiveHash([])) ||
    (run.fileCount > 0
      ? !hash(run.fileAfterId ?? '')
      : run.fileAfterId !== undefined || run.fileDigest !== archiveHash([])) ||
    (run.phase === 'ENTRIES' && run.fileCount !== 0) ||
    (run.phase !== 'ENTRIES' &&
      run.entryCount !== archive.expectedEntryCount) ||
    (run.phase === 'METADATA_OBSERVED' &&
      (run.fileCount !== archive.expectedFileCount || !run.observedAt)) ||
    (run.phase !== 'METADATA_OBSERVED' && run.observedAt !== undefined) ||
    !Number.isFinite(Date.parse(run.startedAt)) ||
    (run.observedAt !== undefined &&
      !Number.isFinite(Date.parse(run.observedAt)))
  )
    throw new ConflictError(
      'Archive metadata revalidation identity or progress is inconsistent',
    );
}
