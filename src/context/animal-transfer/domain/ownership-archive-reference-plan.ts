import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import {
  ArchiveDefinition,
  ArchiveEntry,
  ArchiveFile,
  ArchiveRecordInput,
  ObjectRevision,
  OwnershipArchive,
  archiveHash,
  buildArchiveEntry,
  validateArchiveDefinition,
} from './ownership-archive';

export const ARCHIVE_REFERENCE_PLAN_PROTOCOL = 'REFERENCE_PLAN_V1' as const;
export type ArchiveReferencePlanProgress = {
  protocol: typeof ARCHIVE_REFERENCE_PLAN_PROTOCOL;
  definitionHash: string;
  revision: number;
  phase: 'PLANNING' | 'PLANNED';
  afterId?: string;
  entryCount: number;
};
export type ArchiveEntryReferencePlan = {
  protocol: typeof ARCHIVE_REFERENCE_PLAN_PROTOCOL;
  archiveId: string;
  entryId: string;
  definitionHash: string;
  sourceContentHash: string;
  mode: 'LIVE_RESOURCE' | 'RETAINED_READ_ONLY';
  ownerChange?: { from: string; to: string };
  bindings: Array<{
    path: string;
    format: 'URL' | 'KEY';
    fileId: string;
    fileDefinitionHash: string;
    sha256: string;
    historical: { key: string; revision: ObjectRevision };
    recipient: {
      stagingKey: string;
      stagingRevision: ObjectRevision;
      plannedFinalKey: string;
    };
  }>;
  planHash: string;
};
export interface OwnershipArchiveReferencePlanRepository {
  find(archiveId: string): Promise<OwnershipArchive | null>;
  start(archiveId: string): Promise<OwnershipArchive>;
  findFile(archiveId: string, fileId: string): Promise<ArchiveFile | null>;
  savePage(
    archiveId: string,
    expected: ArchiveReferencePlanProgress,
    plans: ArchiveEntryReferencePlan[],
    next: ArchiveReferencePlanProgress,
  ): Promise<boolean>;
}

const conflict = (): never => {
  throw new ConflictError('Archive reference plan integrity is inconsistent');
};
const isHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const revisionValid = (r: ObjectRevision, size: number) =>
  !!r?.etag && Number.isSafeInteger(r.size) && r.size === size && r.size > 0;
export function assertReferencePlanProgress(
  archive: OwnershipArchive,
  progress: ArchiveReferencePlanProgress | undefined,
): asserts progress is ArchiveReferencePlanProgress {
  if (
    !progress ||
    progress.protocol !== ARCHIVE_REFERENCE_PLAN_PROTOCOL ||
    progress.definitionHash !== archive.definitionHash ||
    !Number.isSafeInteger(progress.revision) ||
    progress.revision < 0 ||
    !Number.isSafeInteger(progress.entryCount) ||
    progress.entryCount < 0 ||
    progress.entryCount > archive.expectedEntryCount! ||
    !['PLANNING', 'PLANNED'].includes(progress.phase) ||
    (progress.entryCount > 0
      ? !isHash(progress.afterId ?? '')
      : progress.afterId !== undefined) ||
    (progress.phase === 'PLANNED' &&
      progress.entryCount !== archive.expectedEntryCount)
  )
    throw new ConflictError('Start a valid archive reference plan first');
}
export function assertReferencePlanArchive(archive: OwnershipArchive): void {
  validateArchiveDefinition(archive);
  const definition: ArchiveDefinition = {
    id: archive.id,
    animalId: archive.animalId,
    ownerId: archive.ownerId,
    recipientId: archive.recipientId,
    periodId: archive.periodId,
    transferId: archive.transferId,
    ownershipVersion: archive.ownershipVersion,
  };
  if (
    archive.state !== 'READY' ||
    archive.definitionHash !== archiveHash(definition) ||
    !Number.isSafeInteger(archive.expectedEntryCount) ||
    archive.expectedEntryCount! < 1 ||
    !Number.isSafeInteger(archive.expectedFileCount) ||
    archive.expectedFileCount! < 0 ||
    (archive.capture &&
      (archive.capture.phase !== 'COMPLETE' ||
        archive.capture.entryCount !== archive.expectedEntryCount)) ||
    (archive.ownershipVersion > 1 && !archive.history) ||
    (archive.history &&
      (archive.history.phase !== 'COMPLETE' ||
        archive.history.entryCount !== archive.history.expectedEntryCount))
  ) {
    throw new ConflictError(
      'Reference planning requires a complete READY archive',
    );
  }
}

/** Instructions only: never mutates payloads or claims a final object exists. */
export function buildArchiveEntryReferencePlan(
  archive: OwnershipArchive,
  entry: ArchiveEntry,
  files: ArchiveFile[],
  keyFromUrl: (url: string) => string | undefined,
): ArchiveEntryReferencePlan {
  assertReferencePlanArchive(archive);
  if (
    entry.archiveId !== archive.id ||
    entry.contentHash !==
      archiveHash({
        kind: entry.kind,
        payload: entry.payload,
        fileBindings: entry.fileBindings,
        ...(entry.retained ? { retained: entry.retained } : {}),
      })
  )
    conflict();
  const root = entry.retained;
  if ((entry.kind === 'RETAINED_RECORD') !== !!root) conflict();
  if (root) {
    for (const id of [
      root.rootArchiveId,
      root.ownerId,
      root.periodId,
      root.sourceArchiveId,
    ])
      new Uuid(id);
    if (
      !Number.isSafeInteger(root.ownershipVersion) ||
      root.ownershipVersion < 1 ||
      root.ownershipVersion >= archive.ownershipVersion ||
      !isHash(root.sourceContentHash) ||
      !isHash(root.sourceEntryId) ||
      entry.resourceId !==
        archiveHash([root.rootArchiveId, root.rootEntryId]) ||
      entry.id !==
        archiveHash([archive.id, 'RETAINED_RECORD', entry.resourceId])
    )
      conflict();
  }
  const originalDefinition = root
    ? {
        ...archive,
        id: root.rootArchiveId,
        ownerId: root.ownerId,
        periodId: root.periodId,
        ownershipVersion: root.ownershipVersion,
      }
    : archive;
  const kind = root?.kind ?? entry.kind;
  if (!['ANIMAL', 'DIARY_ENTRY', 'MEDICAL_DOCUMENT'].includes(kind)) conflict();
  const rebuilt = buildArchiveEntry(
    originalDefinition,
    { kind, data: entry.payload } as ArchiveRecordInput,
    keyFromUrl,
  );
  if (
    rebuilt.entry.id !== (root?.rootEntryId ?? entry.id) ||
    rebuilt.entry.resourceId !== (root?.resourceId ?? entry.resourceId) ||
    rebuilt.entry.fileBindings.length !== entry.fileBindings.length
  )
    conflict();
  const fileMap = new Map(files.map((file) => [file.id, file]));
  if (
    fileMap.size !== files.length ||
    files.length !== new Set(entry.fileBindings.map((b) => b.fileId)).size
  )
    conflict();
  const bindings: ArchiveEntryReferencePlan['bindings'] =
    entry.fileBindings.map((binding, index) => {
      const expected = rebuilt.entry.fileBindings[index];
      const file = fileMap.get(binding.fileId);
      if (
        !file ||
        binding.path !== expected.path ||
        (root ? file.retained?.rootFileId : file.id) !== expected.fileId ||
        file.archiveId !== archive.id ||
        file.state !== 'VERIFIED' ||
        !file.verified ||
        !isHash(file.verified.sha256) ||
        file.id !== archiveHash([archive.id, file.sourceKey]) ||
        !revisionValid(file.verified.historical, file.source.size) ||
        !revisionValid(file.verified.recipientStaging, file.source.size)
      )
        conflict();
      const pinned = file!;
      const originalFile = rebuilt.files.find((f) => f.id === expected.fileId)!;
      const relativeKey = root
        ? `retained-history/${root.rootArchiveId}/${expected.fileId}/${originalFile.relativeKey}`
        : originalFile.relativeKey;
      const ownerPrefix = `users/${archive.ownerId}/animals/${archive.animalId}/`;
      const recipientPrefix = `users/${archive.recipientId}/animals/${archive.animalId}/`;
      if (
        pinned.relativeKey !== relativeKey ||
        pinned.historicalKey !==
          `${ownerPrefix}ownership-archives/${archive.id}/${relativeKey}` ||
        pinned.recipientStagingKey !==
          `${recipientPrefix}transfer-preparations/${archive.id}/${relativeKey}` ||
        pinned.recipientFinalKey !== `${recipientPrefix}${relativeKey}` ||
        (!root &&
          (pinned.retained || pinned.sourceKey !== originalFile.sourceKey)) ||
        (root &&
          (pinned.retained?.rootArchiveId !== root.rootArchiveId ||
            pinned.retained.sourceArchiveId !== root.sourceArchiveId ||
            pinned.retained.relativeKey !== originalFile.relativeKey ||
            pinned.retained.sha256 !== pinned.verified!.sha256))
      )
        conflict();
      const definition = {
        id: pinned.id,
        archiveId: pinned.archiveId,
        sourceKey: pinned.sourceKey,
        relativeKey: pinned.relativeKey,
        historicalKey: pinned.historicalKey,
        recipientStagingKey: pinned.recipientStagingKey,
        recipientFinalKey: pinned.recipientFinalKey,
        source: pinned.source,
        ...(pinned.retained ? { retained: pinned.retained } : {}),
      };
      if (pinned.definitionHash !== archiveHash(definition)) conflict();
      return {
        path: binding.path,
        format: kind === 'MEDICAL_DOCUMENT' ? 'KEY' : 'URL',
        fileId: pinned.id,
        fileDefinitionHash: pinned.definitionHash,
        sha256: pinned.verified!.sha256,
        historical: {
          key: pinned.historicalKey,
          revision: { ...pinned.verified!.historical },
        },
        recipient: {
          stagingKey: pinned.recipientStagingKey,
          stagingRevision: { ...pinned.verified!.recipientStaging },
          plannedFinalKey: pinned.recipientFinalKey,
        },
      };
    });
  const plan: Omit<ArchiveEntryReferencePlan, 'planHash'> = {
    protocol: ARCHIVE_REFERENCE_PLAN_PROTOCOL,
    archiveId: archive.id,
    entryId: entry.id,
    definitionHash: archive.definitionHash,
    sourceContentHash: entry.contentHash,
    mode: root ? 'RETAINED_READ_ONLY' : 'LIVE_RESOURCE',
    ...(!root && (kind === 'ANIMAL' || kind === 'MEDICAL_DOCUMENT')
      ? { ownerChange: { from: archive.ownerId, to: archive.recipientId } }
      : {}),
    bindings,
  };
  return { ...plan, planHash: archiveHash(plan) };
}
