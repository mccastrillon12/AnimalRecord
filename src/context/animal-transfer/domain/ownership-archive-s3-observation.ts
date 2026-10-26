import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { ObjectRevision, archiveHash } from './ownership-archive';
import type { ArchiveMetadataRevalidation } from './ownership-archive-metadata-revalidation';
import {
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  ArchiveMaterializationIntent,
  assertMaterializationIntent,
} from './ownership-archive-materialization';

export const ARCHIVE_S3_OBSERVATION_PROTOCOL =
  'ARCHIVE_S3_OBSERVATION_V1' as const;
export type ArchiveS3Observation = {
  protocol: typeof ARCHIVE_S3_OBSERVATION_PROTOCOL;
  metadataHash: string;
  phase: 'OBSERVING' | 'S3_OBSERVED';
  revision: number;
  count: number;
  afterId?: string;
  manifestDigest: string;
  observationDigest: string;
  startedAt: string;
  observedAt?: string;
};
export type ArchiveS3ObservationItem = {
  fileId: string;
  fileDefinitionHash: string;
  registrationDefinitionHash: string;
  intent: ArchiveMaterializationIntent;
  revision: ObjectRevision;
};
export type ArchiveS3ObservationReceipt = {
  fileId: string;
  revision: ObjectRevision;
  sha256: string;
};
export type ArchiveS3ObservationPage = {
  run: ArchiveMetadataRevalidation;
  limit: number;
  items: ArchiveS3ObservationItem[];
};
export interface OwnershipArchiveS3ObservationRepository {
  startS3(id: string): Promise<ArchiveMetadataRevalidation>;
  s3Page(id: string, limit: number): Promise<ArchiveS3ObservationPage>;
  confirmS3(
    page: ArchiveS3ObservationPage,
    receipts: ArchiveS3ObservationReceipt[],
  ): Promise<ArchiveMetadataRevalidation>;
}
export interface OwnershipArchiveS3ObservationStorage {
  observe(item: ArchiveS3ObservationItem): Promise<ArchiveS3ObservationReceipt>;
}
const fail = (): never => {
  throw new ConflictError(
    'Archive S3 observation identity or progress is inconsistent',
  );
};
const hashValid = (value: string) =>
  typeof value === 'string' && value.length === 64 && /^[a-f0-9]+$/.test(value);
export function s3ObservationMetadataHash(
  run: ArchiveMetadataRevalidation,
): string {
  if (run.phase !== 'METADATA_OBSERVED') fail();
  return archiveHash({
    id: run.id,
    archiveId: run.archiveId,
    definitionHash: run.definitionHash,
    entryDigest: run.entryDigest,
    fileDigest: run.fileDigest,
    entryCount: run.entryCount,
    fileCount: run.fileCount,
  });
}
export function assertS3Observation(run: ArchiveMetadataRevalidation): void {
  const current = run.s3Observation;
  if (
    !current ||
    current.protocol !== ARCHIVE_S3_OBSERVATION_PROTOCOL ||
    current.metadataHash !== s3ObservationMetadataHash(run) ||
    !['OBSERVING', 'S3_OBSERVED'].includes(current.phase) ||
    !Number.isSafeInteger(current.revision) ||
    current.revision < 0 ||
    !Number.isSafeInteger(current.count) ||
    current.count < 0 ||
    current.count > run.fileCount ||
    !hashValid(current.manifestDigest) ||
    !hashValid(current.observationDigest) ||
    (current.count > 0
      ? !hashValid(current.afterId ?? '')
      : current.afterId !== undefined ||
        current.manifestDigest !== archiveHash([]) ||
        current.observationDigest !== archiveHash([])) ||
    (current.phase === 'S3_OBSERVED' &&
      (current.count !== run.fileCount ||
        current.manifestDigest !== run.fileDigest ||
        !current.observedAt)) ||
    (current.phase !== 'S3_OBSERVED' && current.observedAt !== undefined) ||
    !Number.isFinite(Date.parse(current.startedAt)) ||
    (current.observedAt !== undefined &&
      !Number.isFinite(Date.parse(current.observedAt)))
  )
    fail();
}
export function assertS3ObservationItem(item: ArchiveS3ObservationItem): void {
  assertMaterializationIntent(item.intent);
  if (
    item.intent.protocol !== ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL ||
    item.fileId !== item.intent.fileId ||
    item.fileDefinitionHash !== item.intent.fileDefinitionHash ||
    !hashValid(item.registrationDefinitionHash) ||
    typeof item.revision.etag !== 'string' ||
    !item.revision.etag ||
    item.revision.size !== item.intent.source.size ||
    (item.revision.versionId !== undefined &&
      (typeof item.revision.versionId !== 'string' || !item.revision.versionId))
  )
    fail();
}
export function advanceS3Observation(
  run: ArchiveMetadataRevalidation,
  items: ArchiveS3ObservationItem[],
  receipts: ArchiveS3ObservationReceipt[],
  limit: number,
): ArchiveS3Observation {
  assertS3Observation(run);
  if (
    run.s3Observation!.phase !== 'OBSERVING' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    items.length > limit ||
    receipts.length !== items.length
  )
    fail();
  const next = {
    ...run.s3Observation!,
    revision: run.s3Observation!.revision + 1,
  };
  items.forEach((item, index) => {
    assertS3ObservationItem(item);
    const expected = {
      fileId: item.fileId,
      revision: item.revision,
      sha256: item.intent.sha256,
    };
    if (
      item.fileId <= (next.afterId ?? '') ||
      archiveHash(receipts[index]) !== archiveHash(expected)
    )
      fail();
    next.manifestDigest = archiveHash([
      next.manifestDigest,
      item.fileId,
      item.fileDefinitionHash,
      item.registrationDefinitionHash,
    ]);
    next.observationDigest = archiveHash([
      next.observationDigest,
      item.fileId,
      item.intent.definitionHash,
      item.revision,
      item.intent.sha256,
    ]);
    next.afterId = item.fileId;
    next.count++;
  });
  if (items.length < limit) {
    if (next.count !== run.fileCount || next.manifestDigest !== run.fileDigest)
      fail();
    next.phase = 'S3_OBSERVED';
    next.observedAt = new Date().toISOString();
  }
  assertS3Observation({ ...run, s3Observation: next });
  return next;
}
