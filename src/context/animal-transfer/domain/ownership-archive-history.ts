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
import type { PublishedHistoryFileVersion } from './published-ownership-history';
import type {
  PublishedHistoryStagingInput,
  PublishedHistoryStagingIntent,
  PublishedHistoryStagingAttemptInput,
  PublishedHistoryStagingDeclarationInput,
  PublishedHistoryStagingPutAttempt,
  PublishedHistoryStagingPutDeclaration,
  PublishedHistoryStagingReadInput,
} from './published-history-staging';
import type {
  PublishedHistoryStagingPermissionInput,
  PublishedHistoryStagingPutPermission,
  PublishedHistoryStagingTransportInput,
} from './published-history-staging-permission';
import type { PublishedHistoryStagingTransportObservation } from './transfer-item-historical-put-transport';
import type {
  PublishedHistoryFinalAttemptInput,
  PublishedHistoryFinalDeclarationInput,
  PublishedHistoryFinalInput,
  PublishedHistoryFinalIntent,
  PublishedHistoryFinalPutAttempt,
  PublishedHistoryFinalPutDeclaration,
} from './published-history-final';
import type {
  PublishedHistoryStagingPutVersionContext,
  PublishedHistoryStagingPutVersionRecord,
} from './published-history-staging-reconciliation';
import type {
  PublishedHistoryPutPermissionInput,
  PublishedHistoryPutPermission,
  PublishedHistoryPutTransportObservationInput,
} from './published-history-put-permission';
import type { PublishedHistoryPutTransportObservation } from './transfer-item-historical-put-transport';
import type {
  PublishedHistoryPutVersionContext,
  PublishedHistoryPutVersionRecord,
} from './published-history-put-reconciliation';
import type {
  PublishedHistoryCopyInput,
  PublishedHistoryCopyIntent,
  PublishedHistoryCopyAttemptInput,
  PublishedHistoryPutAttempt,
  PublishedHistoryPutDeclarationInput,
  PublishedHistoryPutDeclaration,
  PublishedHistoryPutReadInput,
} from './published-history-copy';
import {
  captureItemObjectRevision,
  isPinnedItemSourceVersion,
} from './transfer-item-copy-intent';

/** Internal persistence boundary; READY alone never establishes inheritance. */
export interface OwnershipArchiveHistoryRepository {
  preparePublishedCopyFinal?(input: PublishedHistoryFinalInput): Promise<
    Readonly<{
      intent: PublishedHistoryFinalIntent;
      replayed: boolean;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  previewPublishedFinalAttempt?(
    input: PublishedHistoryFinalAttemptInput,
  ): Promise<
    Readonly<{
      attempt: PublishedHistoryFinalPutAttempt;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  declarePublishedFinalAttempt?(
    input: PublishedHistoryFinalDeclarationInput,
  ): Promise<
    Readonly<{
      declaration: PublishedHistoryFinalPutDeclaration;
      replayed: boolean;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  recordPublishedStagingTransportObservation?(
    input: PublishedHistoryStagingTransportInput,
  ): Promise<PublishedHistoryStagingTransportObservation>;
  readPublishedStagingVersionContext?(
    input: PublishedHistoryStagingPermissionInput,
  ): Promise<PublishedHistoryStagingPutVersionContext | null>;
  recordPublishedStagingVersion?(
    input: PublishedHistoryStagingPermissionInput,
    version: PublishedHistoryStagingPutVersionRecord,
  ): Promise<PublishedHistoryStagingPutVersionRecord>;
  readPublishedStagingAttempt?(
    input: PublishedHistoryStagingReadInput,
  ): Promise<
    Readonly<{
      definition: PublishedHistoryStagingPutAttempt;
      destinationProtection: PublishedHistoryStagingPutDeclaration['protection'];
    }>
  >;
  recordInitialPublishedStagingPermission?(
    input: PublishedHistoryStagingPermissionInput,
  ): Promise<
    Readonly<{
      recorded: true;
      permission: PublishedHistoryStagingPutPermission;
    }>
  >;
  observePublishedStagingPermission?(
    input: PublishedHistoryStagingPermissionInput,
  ): Promise<Readonly<{
    permission: PublishedHistoryStagingPutPermission;
    transportObservation?: PublishedHistoryStagingTransportObservation;
    copyDispatch: 'NOT_AUTHORIZED';
  }> | null>;
  previewPublishedStagingAttempt?(
    input: PublishedHistoryStagingAttemptInput,
  ): Promise<
    Readonly<{
      attempt: PublishedHistoryStagingPutAttempt;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  declarePublishedStagingAttempt?(
    input: PublishedHistoryStagingDeclarationInput,
  ): Promise<
    Readonly<{
      declaration: PublishedHistoryStagingPutDeclaration;
      replayed: boolean;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  preparePublishedCopyStaging?(input: PublishedHistoryStagingInput): Promise<
    Readonly<{
      intent: PublishedHistoryStagingIntent;
      replayed: boolean;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  readPublishedCopyVersionContext?(
    input: PublishedHistoryPutPermissionInput,
  ): Promise<PublishedHistoryPutVersionContext | null>;
  recordPublishedCopyVersion?(
    input: PublishedHistoryPutPermissionInput,
    version: PublishedHistoryPutVersionRecord,
  ): Promise<PublishedHistoryPutVersionRecord>;
  recordPublishedCopyTransportObservation?(
    input: PublishedHistoryPutTransportObservationInput,
  ): Promise<PublishedHistoryPutTransportObservation>;
  recordInitialPublishedCopyPermission?(
    input: PublishedHistoryPutPermissionInput,
    keyFromUrl: (url: string) => string | undefined,
  ): Promise<
    Readonly<{ recorded: true; permission: PublishedHistoryPutPermission }>
  >;
  observePublishedCopyPermission?(
    input: PublishedHistoryPutPermissionInput,
  ): Promise<Readonly<{
    permission: PublishedHistoryPutPermission;
    transportObservation?: PublishedHistoryPutTransportObservation;
    copyDispatch: 'NOT_AUTHORIZED';
  }> | null>;
  readPublishedCopyAttempt?(
    input: PublishedHistoryPutReadInput,
    keyFromUrl: (url: string) => string | undefined,
  ): Promise<
    Readonly<{
      definition: PublishedHistoryPutAttempt;
      destinationProtection: PublishedHistoryPutDeclaration['protection'];
      versionObservationHash: string;
      conservationControlsHash: string;
      requiredThrough: string;
    }>
  >;
  previewPublishedCopyAttempt?(
    input: PublishedHistoryCopyAttemptInput,
    keyFromUrl: (url: string) => string | undefined,
  ): Promise<
    Readonly<{
      attempt: PublishedHistoryPutAttempt;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  declarePublishedCopyAttempt?(
    input: PublishedHistoryPutDeclarationInput,
    keyFromUrl: (url: string) => string | undefined,
  ): Promise<
    Readonly<{
      declaration: PublishedHistoryPutDeclaration;
      replayed: boolean;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  preparePublishedCopy?(
    input: PublishedHistoryCopyInput,
    keyFromUrl: (url: string) => string | undefined,
  ): Promise<
    Readonly<{
      intent: PublishedHistoryCopyIntent;
      requiredThrough: string;
      replayed: boolean;
      copyDispatch: 'NOT_AUTHORIZED';
    }>
  >;
  start(
    archiveId: string,
    sourceArchiveId: string,
    sourcePublicationHash?: string,
  ): Promise<OwnershipArchive>;
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
  publishedVersions?: ReadonlyMap<string, PublishedHistoryFileVersion>,
): { entry: ArchiveEntry; files: ArchiveFile[] } {
  const publicationHash = destination.history?.sourcePublicationHash;
  if (
    original.archiveId !== source.id ||
    source.id === destination.id ||
    source.animalId !== destination.animalId ||
    source.recipientId !== destination.ownerId ||
    source.ownershipVersion + 1 !== destination.ownershipVersion ||
    (publishedVersions === undefined
      ? publicationHash !== undefined ||
        source.ownershipCommitHash !== undefined
      : !publicationHash ||
        source.ownershipCommitHash !== publicationHash ||
        source.ownershipVersion !== 1 ||
        original.kind === 'RETAINED_RECORD')
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
    ...(publicationHash === undefined
      ? {}
      : { sourcePublicationHash: publicationHash }),
  };
  const resourceId = archiveHash([
    retained.rootArchiveId,
    retained.rootEntryId,
  ]);
  const files = new Map<string, ArchiveFile>();
  const sourceFileMap = new Map(sourceFiles.map((file) => [file.id, file]));
  if (
    sourceFileMap.size !== sourceFiles.length ||
    (publishedVersions && publishedVersions.size !== sourceFileMap.size)
  )
    fail();
  const fileBindings = original.fileBindings.map((binding) => {
    const file = sourceFileMap.get(binding.fileId);
    const published = publishedVersions?.get(binding.fileId);
    const revision = published
      ? captureItemObjectRevision(published.revision)
      : file?.verified?.historical;
    const sha256 = published ? published.sha256 : file?.verified?.sha256;
    if (
      !file ||
      file.archiveId !== source.id ||
      (publishedVersions
        ? !published ||
          file.retained !== undefined ||
          published.fileDefinitionHash !== file.definitionHash ||
          published.target.key !== file.historicalKey ||
          !/^[0-9]{12}$/.test(published.target.expectedBucketOwner) ||
          !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(published.target.bucket) ||
          !isPinnedItemSourceVersion(revision?.versionId)
        : file.state !== 'VERIFIED' || !file.verified) ||
      !sha256 ||
      !hash(sha256) ||
      !safeRelativeKey(file.relativeKey) ||
      file.historicalKey !==
        `users/${source.ownerId}/animals/${source.animalId}/ownership-archives/${source.id}/${file.relativeKey}` ||
      !revision?.etag ||
      !Number.isSafeInteger(revision.size) ||
      revision.size < 1 ||
      revision.size !== file.source.size
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
        pinned.retained.sha256 !== sha256)
    )
      fail();
    const retainedFile = {
      rootArchiveId,
      rootFileId,
      relativeKey: relative,
      sourceArchiveId: source.id,
      sourceFileId: pinned.id,
      sourceDefinitionHash: pinned.definitionHash,
      sha256: sha256!,
      ...(published
        ? {
            publishedSource: {
              publicationHash: publicationHash!,
              bucket: published.target.bucket,
              expectedBucketOwner: published.target.expectedBucketOwner,
            },
          }
        : {}),
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
      source: revision!,
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
