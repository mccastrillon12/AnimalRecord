import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import { archiveHash } from './ownership-archive';
import type { ArchiveMetadataRevalidation } from './ownership-archive-metadata-revalidation';
import { assertS3Observation } from './ownership-archive-s3-observation';

export const ARCHIVE_PIPELINE_FENCE_PROTOCOL =
  'ARCHIVE_PIPELINE_FENCE_V1' as const;
export type ArchivePipelineFence = {
  protocol: typeof ARCHIVE_PIPELINE_FENCE_PROTOCOL;
  preparationRevision?: number;
  referencePlanRevision?: number;
};
export type ArchiveEvidenceSelection = {
  runId: string;
  archiveId: string;
  expectedRunRevision: number;
  expectedEvidenceHash: string;
};
export type ArchiveEvidenceConsumptionRequest = ArchiveEvidenceSelection & {
  id: string;
};
export type ArchiveEvidenceConsumption = {
  protocol: 'ARCHIVE_EVIDENCE_CONSUMPTION_V1';
  id: string;
  runId: string;
  archiveId: string;
  runDefinitionHash: string;
  evidenceHash: string;
  reservationEpoch: number;
  previousRunRevision: number;
  previousControlRevision: number;
  nextControlRevision: number;
  consumedAt: string;
  definitionHash: string;
};
function revision(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
    throw new ConflictError('Archive pipeline revision is inconsistent');
}
export function buildArchivePipelineFence(
  preparationRevision: number | undefined,
  referencePlanRevision: number | undefined,
): ArchivePipelineFence {
  revision(preparationRevision);
  revision(referencePlanRevision);
  return {
    protocol: ARCHIVE_PIPELINE_FENCE_PROTOCOL,
    ...(preparationRevision !== undefined ? { preparationRevision } : {}),
    ...(referencePlanRevision !== undefined ? { referencePlanRevision } : {}),
  };
}
export function assertArchivePipelineFence(value: ArchivePipelineFence): void {
  if (
    archiveHash(value) !==
    archiveHash(
      buildArchivePipelineFence(
        value.preparationRevision,
        value.referencePlanRevision,
      ),
    )
  )
    throw new ConflictError('Archive pipeline fence identity is inconsistent');
}
export function validateEvidenceConsumptionRequest(
  request: ArchiveEvidenceConsumptionRequest,
): void {
  new Uuid(request.id);
  validateSelection(request, 'Invalid archive evidence consumption request');
}
export function validateArchiveEvidenceSelection(
  request: ArchiveEvidenceSelection,
): void {
  validateSelection(request, 'Invalid archive evidence selection');
}
function validateSelection(
  request: ArchiveEvidenceSelection,
  message: string,
): void {
  for (const id of [request.runId, request.archiveId]) new Uuid(id);
  if (
    !Number.isSafeInteger(request.expectedRunRevision) ||
    request.expectedRunRevision < 0 ||
    typeof request.expectedEvidenceHash !== 'string' ||
    request.expectedEvidenceHash.length !== 64 ||
    !/^[a-f0-9]+$/.test(request.expectedEvidenceHash)
  )
    throw new ConflictError(message);
}
/** A comparison digest of persisted observations, NOT a permission or fresh S3 check. */
export function archiveEvidenceHash(run: ArchiveMetadataRevalidation): string {
  assertS3Observation(run);
  if (
    run.phase !== 'METADATA_OBSERVED' ||
    run.s3Observation!.phase !== 'S3_OBSERVED' ||
    run.consumption !== undefined ||
    !run.pipelineFence ||
    !Number.isSafeInteger(run.reservationEpoch) ||
    run.reservationEpoch! < 1
  )
    throw new ConflictError(
      'Complete supported, unconsumed archive observations are required',
    );
  assertArchivePipelineFence(run.pipelineFence);
  return archiveHash({
    protocol: 'ARCHIVE_EVIDENCE_V1',
    id: run.id,
    archiveId: run.archiveId,
    definitionHash: run.definitionHash,
    revision: run.revision,
    controlRevision: run.controlRevision,
    reservationHash: run.reservationHash,
    reservationEpoch: run.reservationEpoch,
    pipelineFence: run.pipelineFence,
    entryCount: run.entryCount,
    fileCount: run.fileCount,
    entryDigest: run.entryDigest,
    fileDigest: run.fileDigest,
    observedAt: run.observedAt,
    s3Observation: run.s3Observation,
  });
}
