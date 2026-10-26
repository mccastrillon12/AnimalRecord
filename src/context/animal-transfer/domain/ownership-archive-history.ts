import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import {
  ArchiveEntry,
  ArchiveFile,
  ArchiveHistoryProgress,
  OwnershipArchive,
  archiveHash,
  buildArchiveEntry,
  ArchiveRecordInput,
} from './ownership-archive';

/** Internal persistence boundary; READY alone never establishes inheritance. */
export interface OwnershipArchiveHistoryRepository {
  start(archiveId: string, sourceArchiveId: string): Promise<OwnershipArchive>;
  source(archive: OwnershipArchive): Promise<OwnershipArchive>;
  findFile(archiveId: string, fileId: string): Promise<ArchiveFile | null>;
  checkpoint(
    archiveId: string,
    expected: ArchiveHistoryProgress,
    next: ArchiveHistoryProgress,
  ): Promise<boolean>;
}

const fail = (): never => {
  throw new ConflictError(
    'Retained archive provenance or integrity is inconsistent',
  );
};
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const safeRelativeKey = (key: string): boolean =>
  !!key &&
  !key.includes('\\') &&
  !key.split('/').some((p) => !p || p === '.' || p === '..');

/** Copies metadata, never interprets a historical URL as a current-owner file. */
export function buildRetainedArchiveEntry(
  destination: OwnershipArchive,
  source: OwnershipArchive,
  original: ArchiveEntry,
  sourceFiles: ArchiveFile[],
  keyFromUrl: (url: string) => string | undefined,
): { entry: ArchiveEntry; files: ArchiveFile[] } {
  if (
    original.archiveId !== source.id ||
    source.id === destination.id ||
    source.animalId !== destination.animalId ||
    source.recipientId !== destination.ownerId ||
    source.ownershipVersion + 1 !== destination.ownershipVersion
  )
    fail();
  const originalHash = archiveHash({
    kind: original.kind,
    payload: original.payload,
    fileBindings: original.fileBindings,
    ...(original.retained ? { retained: original.retained } : {}),
  });
  if (original.contentHash !== originalHash) fail();
  if (original.kind !== 'RETAINED_RECORD') {
    if (original.retained) fail();
    const rebuilt = buildArchiveEntry(
      source,
      {
        kind: original.kind,
        data: original.payload,
      } as ArchiveRecordInput,
      keyFromUrl,
    ).entry;
    if (
      rebuilt.id !== original.id ||
      rebuilt.contentHash !== original.contentHash ||
      rebuilt.resourceId !== original.resourceId
    )
      fail();
  } else {
    const root = original.retained;
    if (
      !root ||
      !hash(root.rootEntryId) ||
      !['ANIMAL', 'DIARY_ENTRY', 'MEDICAL_DOCUMENT'].includes(root.kind)
    )
      fail();
    new Uuid(root!.rootArchiveId);
    new Uuid(root!.ownerId);
    new Uuid(root!.periodId);
    if (
      !Number.isSafeInteger(root!.ownershipVersion) ||
      root!.ownershipVersion < 1 ||
      root!.ownershipVersion >= source.ownershipVersion ||
      original.payload.id !== root!.resourceId ||
      root!.rootEntryId !==
        archiveHash([root!.rootArchiveId, root!.kind, root!.resourceId]) ||
      original.resourceId !==
        archiveHash([root!.rootArchiveId, root!.rootEntryId]) ||
      original.id !==
        archiveHash([source.id, 'RETAINED_RECORD', original.resourceId])
    )
      fail();
  }
  const retained = {
    rootArchiveId: original.retained?.rootArchiveId ?? source.id,
    rootEntryId: original.retained?.rootEntryId ?? original.id,
    kind:
      original.retained?.kind ?? (original.kind as ArchiveRecordInput['kind']),
    resourceId: original.retained?.resourceId ?? original.resourceId,
    ownerId: original.retained?.ownerId ?? source.ownerId,
    periodId: original.retained?.periodId ?? source.periodId,
    ownershipVersion:
      original.retained?.ownershipVersion ?? source.ownershipVersion,
    sourceArchiveId: source.id,
    sourceEntryId: original.id,
    sourceContentHash: original.contentHash,
  };
  const resourceId = archiveHash([
    retained.rootArchiveId,
    retained.rootEntryId,
  ]);
  const files = new Map<string, ArchiveFile>();
  const sourceFileMap = new Map(sourceFiles.map((file) => [file.id, file]));
  if (sourceFileMap.size !== sourceFiles.length) fail();
  const fileBindings = original.fileBindings.map((binding) => {
    const file = sourceFileMap.get(binding.fileId);
    if (
      !file ||
      file.archiveId !== source.id ||
      file.state !== 'VERIFIED' ||
      !file.verified ||
      !hash(file.verified.sha256) ||
      !safeRelativeKey(file.relativeKey) ||
      file.historicalKey !==
        `users/${source.ownerId}/animals/${source.animalId}/ownership-archives/${source.id}/${file.relativeKey}` ||
      !file.verified.historical.etag ||
      !Number.isSafeInteger(file.verified.historical.size) ||
      file.verified.historical.size < 1 ||
      file.verified.historical.size !== file.source.size
    )
      fail();
    const pinned = file!;
    const pinnedDefinition = {
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
    if (pinned.definitionHash !== archiveHash(pinnedDefinition)) fail();
    if (
      !pinned.retained &&
      (original.retained ||
        pinned.sourceKey !==
          `users/${source.ownerId}/animals/${source.animalId}/${pinned.relativeKey}`)
    )
      fail();
    if (
      pinned.retained &&
      (!original.retained ||
        pinned.retained.rootArchiveId !== original.retained.rootArchiveId)
    )
      fail();
    const rootArchiveId = pinned.retained?.rootArchiveId ?? source.id;
    const rootFileId = pinned.retained?.rootFileId ?? pinned.id;
    const relative = pinned.retained?.relativeKey ?? pinned.relativeKey;
    new Uuid(rootArchiveId);
    if (
      !hash(rootFileId) ||
      !safeRelativeKey(relative) ||
      /^(ownership-archives|transfer-preparations|upload-intake|retained-history)\//.test(
        relative,
      )
    )
      fail();
    if (pinned.id !== archiveHash([source.id, pinned.sourceKey])) fail();
    if (
      pinned.retained &&
      (pinned.relativeKey !==
        `retained-history/${rootArchiveId}/${rootFileId}/${relative}` ||
        pinned.retained.sha256 !== pinned.verified!.sha256)
    )
      fail();
    const retainedFile = {
      rootArchiveId,
      rootFileId,
      relativeKey: relative,
      sourceArchiveId: source.id,
      sourceFileId: pinned.id,
      sourceDefinitionHash: pinned.definitionHash,
      sha256: pinned.verified!.sha256,
    };
    const relativeKey = `retained-history/${rootArchiveId}/${rootFileId}/${relative}`;
    const id = archiveHash([destination.id, pinned.historicalKey]);
    const definition = {
      id,
      archiveId: destination.id,
      sourceKey: pinned.historicalKey,
      relativeKey,
      historicalKey: `users/${destination.ownerId}/animals/${destination.animalId}/ownership-archives/${destination.id}/${relativeKey}`,
      recipientStagingKey: `users/${destination.recipientId}/animals/${destination.animalId}/transfer-preparations/${destination.id}/${relativeKey}`,
      recipientFinalKey: `users/${destination.recipientId}/animals/${destination.animalId}/${relativeKey}`,
      source: pinned.verified!.historical,
      retained: retainedFile,
    };
    files.set(id, {
      ...definition,
      definitionHash: archiveHash(definition),
      state: 'PENDING',
    });
    return { path: binding.path, fileId: id };
  });
  if (
    sourceFileMap.size !==
    new Set(original.fileBindings.map((binding) => binding.fileId)).size
  )
    fail();
  const payload = JSON.parse(JSON.stringify(original.payload)) as Record<
    string,
    unknown
  >;
  const entry: ArchiveEntry = {
    id: archiveHash([destination.id, 'RETAINED_RECORD', resourceId]),
    archiveId: destination.id,
    kind: 'RETAINED_RECORD',
    resourceId,
    payload,
    fileBindings,
    retained,
    contentHash: archiveHash({
      kind: 'RETAINED_RECORD',
      payload,
      fileBindings,
      retained,
    }),
  };
  return { entry, files: [...files.values()] };
}
