import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import { ArchiveEvidenceSelection } from './ownership-archive-evidence-consumption';
import { ArchiveMetadataRevalidation } from './ownership-archive-metadata-revalidation';
import { ArchiveRecipientProjection } from './ownership-archive-recipient-projection';

/** Snapshot-local candidate and evidence comparison only, never a commit permit. */
export type ArchiveProjectionRead = {
  protocol: 'ARCHIVE_PROJECTION_READ_V1';
  evidence: ArchiveEvidenceSelection;
  projection: ArchiveRecipientProjection;
};

/** Rebuild the Mongo/remote-manifest digests from the fully validated local candidate.
 * This does not contact S3 or establish that the observed bytes are still current. */
export function assertProjectionObservation(
  projection: ArchiveRecipientProjection,
  run: ArchiveMetadataRevalidation,
): void {
  let entryDigest = archiveHash([]),
    fileDigest = archiveHash([]),
    observationDigest = archiveHash([]);
  for (const entry of projection.entries)
    entryDigest = archiveHash([
      entryDigest,
      entry.entryId,
      entry.sourceContentHash,
      entry.sourcePlanHash,
    ]);
  for (const file of projection.media) {
    fileDigest = archiveHash([
      fileDigest,
      file.fileId,
      file.fileDefinitionHash,
      file.definitionHash,
    ]);
    observationDigest = archiveHash([
      observationDigest,
      file.fileId,
      file.intentDefinitionHash,
      file.revision,
      file.sha256,
    ]);
  }
  if (
    projection.definition.id !== run.archiveId ||
    projection.reservationEpoch !== run.reservationEpoch ||
    projection.entries.length !== run.entryCount ||
    projection.media.length !== run.fileCount ||
    projection.entries.at(-1)?.entryId !== run.entryAfterId ||
    projection.media.at(-1)?.fileId !== run.fileAfterId ||
    projection.media.at(-1)?.fileId !== run.s3Observation?.afterId ||
    entryDigest !== run.entryDigest ||
    fileDigest !== run.fileDigest ||
    fileDigest !== run.s3Observation?.manifestDigest ||
    observationDigest !== run.s3Observation?.observationDigest
  )
    throw new ConflictError(
      'The recipient projection differs from the observed archive evidence',
    );
}
