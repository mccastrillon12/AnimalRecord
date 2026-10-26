import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ArchiveMetadataRevalidation,
  ARCHIVE_METADATA_REVALIDATION_PROTOCOL,
} from '../../../src/context/animal-transfer/domain/ownership-archive-metadata-revalidation';
import {
  ArchiveS3ObservationItem,
  ARCHIVE_S3_OBSERVATION_PROTOCOL,
  s3ObservationMetadataHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive-s3-observation';
import { historyUuid } from './ownership-archive-history.fixture';
import { metadataRevalidationFixture } from './ownership-archive-metadata-revalidation.fixture';

export const s3ObservationFixture = (medicalCount = 1, profileFile = true) => {
  const s = metadataRevalidationFixture(medicalCount, profileFile);
  const run: ArchiveMetadataRevalidation = {
    id: historyUuid(800),
    archiveId: s.archive.id,
    protocol: ARCHIVE_METADATA_REVALIDATION_PROTOCOL,
    definitionHash: 'a'.repeat(64),
    phase: 'METADATA_OBSERVED',
    revision: 4,
    controlRevision: 45,
    reservationHash: archiveHash(s.control.transferLock),
    entryCount: s.entries.length,
    fileCount: s.files.length,
    entryDigest: 'b'.repeat(64),
    fileDigest: archiveHash([]),
    startedAt: '2026-10-25T12:00:00.000Z',
    observedAt: '2026-10-25T12:05:00.000Z',
  };
  const items: ArchiveS3ObservationItem[] = s.files.map((file) => ({
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    registrationDefinitionHash: s.registrations.find(
      (row) => row.fileId === file.id,
    )!.definitionHash,
    intent: file.materialization!.intent,
    revision: file.materialization!.verified!,
  }));
  for (const item of items)
    run.fileDigest = archiveHash([
      run.fileDigest,
      item.fileId,
      item.fileDefinitionHash,
      item.registrationDefinitionHash,
    ]);
  run.s3Observation = {
    protocol: ARCHIVE_S3_OBSERVATION_PROTOCOL,
    metadataHash: s3ObservationMetadataHash(run),
    phase: 'OBSERVING',
    revision: 0,
    count: 0,
    manifestDigest: archiveHash([]),
    observationDigest: archiveHash([]),
    startedAt: '2026-10-25T12:06:00.000Z',
  };
  const receipts = items.map((item) => ({
    fileId: item.fileId,
    revision: { ...item.revision },
    sha256: item.intent.sha256,
  }));
  return { ...s, run, items, receipts };
};
