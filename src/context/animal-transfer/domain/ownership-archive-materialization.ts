import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import {
  ArchiveFile,
  ObjectRevision,
  OwnershipArchive,
  archiveHash,
} from './ownership-archive';
import {
  ArchiveEntryReferencePlan,
  ARCHIVE_REFERENCE_PLAN_PROTOCOL,
  assertReferencePlanArchive,
  assertReferencePlanProgress,
} from './ownership-archive-reference-plan';
import { archiveGenerationKey } from './ownership-archive-generation';

export const ARCHIVE_MATERIALIZATION_PROTOCOL =
  'ARCHIVE_MATERIALIZATION_V1' as const;
export const ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL =
  'ARCHIVE_MATERIALIZATION_GENERATIONAL_V1' as const;
export type ArchiveMaterializationProtocol =
  | typeof ARCHIVE_MATERIALIZATION_PROTOCOL
  | typeof ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL;
export type ArchiveMaterialization = {
  protocol: ArchiveMaterializationProtocol;
  definitionHash: string;
  referencePlanHash: string;
  phase: 'MATERIALIZING' | 'MATERIALIZED';
};
export type ArchiveMaterializationIntent = {
  protocol: ArchiveMaterializationProtocol;
  archiveId: string;
  fileId: string;
  fileDefinitionHash: string;
  materializationDefinitionHash: string;
  sourceKey: string;
  source: ObjectRevision;
  destinationKey: string;
  sha256: string;
  definitionHash: string;
};
export type ArchiveFileMaterialization = {
  intent: ArchiveMaterializationIntent;
  state: 'PENDING' | 'MATERIALIZING' | 'VERIFIED';
  leaseToken?: string;
  leaseUntil?: string;
  verified?: ObjectRevision;
};
export interface OwnershipArchiveMaterializationStorage {
  materialize(intent: ArchiveMaterializationIntent): Promise<ObjectRevision>;
}
export interface OwnershipArchiveMaterializationRepository {
  start(
    archiveId: string,
    protocol?: ArchiveMaterializationProtocol,
  ): Promise<OwnershipArchive>;
  claim(
    archiveId: string,
    token: string,
    now: string,
    until: string,
  ): Promise<ArchiveMaterializationIntent | null>;
  complete(
    intent: ArchiveMaterializationIntent,
    token: string,
    revision: ObjectRevision,
  ): Promise<boolean>;
  release(intent: ArchiveMaterializationIntent, token: string): Promise<void>;
  markComplete(archiveId: string): Promise<boolean>;
}
const fail = (): never => {
  throw new ConflictError(
    'Archive materialization identity or provenance is inconsistent',
  );
};
const digestValid = (hash: string): boolean =>
  typeof hash === 'string' && hash.length === 64 && /^[a-f0-9]+$/.test(hash);

export function buildArchiveMaterialization(
  archive: OwnershipArchive,
  protocol: ArchiveMaterializationProtocol = ARCHIVE_MATERIALIZATION_PROTOCOL,
): ArchiveMaterialization {
  if (
    protocol !== ARCHIVE_MATERIALIZATION_PROTOCOL &&
    protocol !== ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL
  )
    fail();
  assertReferencePlanArchive(archive);
  assertReferencePlanProgress(archive, archive.referencePlan);
  if (archive.referencePlan.phase !== 'PLANNED')
    throw new ConflictError(
      'Complete the reference plan before materialization',
    );
  const definition = {
    protocol,
    archiveId: archive.id,
    archiveDefinitionHash: archive.definitionHash,
    referencePlanHash: archiveHash(archive.referencePlan),
    expectedFileCount: archive.expectedFileCount,
  };
  return {
    protocol: definition.protocol,
    definitionHash: archiveHash(definition),
    referencePlanHash: definition.referencePlanHash,
    phase: 'MATERIALIZING',
  };
}
export function assertArchiveMaterialization(archive: OwnershipArchive): void {
  const current = archive.materialization;
  const expected = buildArchiveMaterialization(archive, current?.protocol);
  if (
    !current ||
    current.protocol !== expected.protocol ||
    current.definitionHash !== expected.definitionHash ||
    current.referencePlanHash !== expected.referencePlanHash ||
    !['MATERIALIZING', 'MATERIALIZED'].includes(current.phase)
  )
    fail();
}
export function buildArchiveMaterializationIntent(
  archive: OwnershipArchive,
  file: ArchiveFile,
  plan: ArchiveEntryReferencePlan,
): ArchiveMaterializationIntent {
  assertArchiveMaterialization(archive);
  const { planHash, ...planDefinition } = plan;
  if (
    plan.protocol !== ARCHIVE_REFERENCE_PLAN_PROTOCOL ||
    plan.archiveId !== archive.id ||
    plan.definitionHash !== archive.definitionHash ||
    planHash !== archiveHash(planDefinition)
  )
    fail();
  const binding = plan.bindings.find((b) => b.fileId === file.id);
  const prefix = `users/${archive.recipientId}/animals/${archive.animalId}/`;
  if (
    !binding ||
    file.archiveId !== archive.id ||
    file.state !== 'VERIFIED' ||
    !file.verified ||
    !digestValid(file.verified.sha256) ||
    file.id !== archiveHash([archive.id, file.sourceKey]) ||
    !file.relativeKey ||
    file.relativeKey.includes('\\') ||
    file.relativeKey.split('/').some((p) => !p || p === '.' || p === '..') ||
    /^(ownership-archives|transfer-preparations|upload-intake)\//.test(
      file.relativeKey,
    ) ||
    file.recipientStagingKey !==
      `${prefix}transfer-preparations/${archive.id}/${file.relativeKey}` ||
    file.recipientFinalKey !== `${prefix}${file.relativeKey}` ||
    binding.fileDefinitionHash !== file.definitionHash ||
    binding.sha256 !== file.verified.sha256 ||
    binding.recipient.stagingKey !== file.recipientStagingKey ||
    binding.recipient.plannedFinalKey !== file.recipientFinalKey ||
    archiveHash(binding.recipient.stagingRevision) !==
      archiveHash(file.verified.recipientStaging) ||
    !file.verified.recipientStaging.etag ||
    !Number.isSafeInteger(file.verified.recipientStaging.size) ||
    file.verified.recipientStaging.size < 1 ||
    file.verified.recipientStaging.size !== file.source.size
  )
    fail();
  const fileDefinition = {
    id: file.id,
    archiveId: file.archiveId,
    sourceKey: file.sourceKey,
    relativeKey: file.relativeKey,
    historicalKey: file.historicalKey,
    recipientStagingKey: file.recipientStagingKey,
    recipientFinalKey: file.recipientFinalKey,
    source: file.source,
    ...(file.retained ? { retained: file.retained } : {}),
  };
  if (file.definitionHash !== archiveHash(fileDefinition)) fail();
  const definition: Omit<ArchiveMaterializationIntent, 'definitionHash'> = {
    protocol: archive.materialization!.protocol,
    archiveId: archive.id,
    fileId: file.id,
    fileDefinitionHash: file.definitionHash,
    materializationDefinitionHash: archive.materialization!.definitionHash,
    sourceKey: file.recipientStagingKey,
    source: { ...file.verified!.recipientStaging },
    destinationKey:
      archive.materialization!.protocol ===
      ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL
        ? archiveGenerationKey(archive.id, file.id, file.recipientFinalKey)
        : file.recipientFinalKey,
    sha256: file.verified!.sha256,
  };
  return { ...definition, definitionHash: archiveHash(definition) };
}
export function assertMaterializationIntent(
  intent: ArchiveMaterializationIntent,
): void {
  const { definitionHash, ...definition } = intent;
  if (
    (intent.protocol !== ARCHIVE_MATERIALIZATION_PROTOCOL &&
      intent.protocol !== ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL) ||
    definitionHash !== archiveHash(definition) ||
    !digestValid(intent.fileId) ||
    !digestValid(intent.fileDefinitionHash) ||
    !digestValid(intent.materializationDefinitionHash) ||
    !digestValid(intent.sha256) ||
    !intent.source.etag ||
    !Number.isSafeInteger(intent.source.size) ||
    intent.source.size < 1 ||
    intent.sourceKey === intent.destinationKey
  )
    fail();
  new Uuid(intent.archiveId);
  const parts = intent.sourceKey.split('/');
  if (
    parts[0] !== 'users' ||
    parts[2] !== 'animals' ||
    parts[4] !== 'transfer-preparations' ||
    parts[5] !== intent.archiveId ||
    parts.length < 7 ||
    parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\'))
  )
    fail();
  new Uuid(parts[1]);
  new Uuid(parts[3]);
  const plannedKey = `${parts.slice(0, 4).join('/')}/${parts.slice(6).join('/')}`;
  const expected =
    intent.protocol === ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL
      ? archiveGenerationKey(intent.archiveId, intent.fileId, plannedKey)
      : plannedKey;
  if (intent.destinationKey !== expected) fail();
}

/** Evidence mapping only. Does not authorize access, publication or ownership commit. */
export function verifiedArchiveMaterializationDestination(
  archive: OwnershipArchive,
  file: ArchiveFile,
  plan: ArchiveEntryReferencePlan,
): { key: string; revision: ObjectRevision; sha256: string } {
  const expected = buildArchiveMaterializationIntent(archive, file, plan);
  const current = file.materialization;
  if (
    archive.materialization!.phase !== 'MATERIALIZED' ||
    current?.state !== 'VERIFIED' ||
    archiveHash(current.intent) !== archiveHash(expected) ||
    !current.verified?.etag ||
    current.verified.size !== expected.source.size
  )
    fail();
  return {
    key: expected.destinationKey,
    revision: { ...current!.verified! },
    sha256: expected.sha256,
  };
}
