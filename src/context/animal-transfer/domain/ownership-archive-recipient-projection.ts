import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { Uuid } from '../../shared/domain/value-object/Uuid';
import {
  ArchiveDefinition,
  ArchiveEntry,
  ArchiveFile,
  ArchiveRecordInput,
  OwnershipArchive,
  archiveHash,
} from './ownership-archive';
import {
  ArchiveMediaRegistration,
  assertMediaRegistrationArchive,
  assertSameMediaRegistration,
  buildArchiveMediaRegistration,
} from './ownership-archive-media-registration';
import { buildArchiveEntryReferencePlan } from './ownership-archive-reference-plan';
import {
  archiveDefinitionOnly,
  archiveReservationEpoch,
} from './ownership-archive-reservation';

export const ARCHIVE_RECIPIENT_PROJECTION_PROTOCOL =
  'ARCHIVE_RECIPIENT_PROJECTION_V1' as const;

/** Backend-owned synchronous codecs only: no signing, storage or other I/O. */
export type ArchiveProjectionUrls = {
  keyFromUrl(url: string): string | undefined;
  urlForKey(key: string): string;
};
export type ArchiveRecipientEntryProjection = {
  entryId: string;
  resourceId: string;
  kind: ArchiveEntry['kind'];
  sourceKind: ArchiveRecordInput['kind'];
  mode: ArchiveMediaRegistration['mode'];
  sourceContentHash: string;
  sourcePlanHash: string;
  retained?: ArchiveEntry['retained'];
  payload: Record<string, unknown>;
  references: Array<{
    path: string;
    format: 'URL' | 'KEY';
    fileId: string;
    registrationId: string;
  }>;
};
export type ArchiveRecipientProjection = {
  protocol: typeof ARCHIVE_RECIPIENT_PROJECTION_PROTOCOL;
  definition: ArchiveDefinition;
  reservationHash: string;
  reservationEpoch: number;
  referencePlanHash: string;
  materializationDefinitionHash: string;
  entries: ArchiveRecipientEntryProjection[];
  media: ArchiveMediaRegistration[];
  projectionHash: string;
};

const fail = (): never => {
  throw new ConflictError(
    'Archive recipient projection integrity is inconsistent',
  );
};
const digest = (value: string) =>
  typeof value === 'string' &&
  /^[a-f0-9]{64}$/.test(value) &&
  value.length === 64;
const unique = <T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T> => {
  const map = new Map(items.map((item) => [key(item), item]));
  if (map.size !== items.length) fail();
  return map;
};

/** Explicit known fields only; never applies caller-provided JSON pointers. */
function replaceReference(
  payload: Record<string, unknown>,
  kind: ArchiveRecordInput['kind'],
  path: string,
  value: string,
): void {
  if (kind === 'ANIMAL' && path === '/profilePictureUrl') {
    payload.profilePictureUrl = value;
    return;
  }
  if (kind === 'MEDICAL_DOCUMENT' && path === '/storageKey') {
    payload.storageKey = value;
    return;
  }
  if (
    kind === 'MEDICAL_DOCUMENT' &&
    path === '/documentLocations/0/storageKey'
  ) {
    (payload.documentLocations as Array<{ storageKey: string }>)[0].storageKey =
      value;
    return;
  }
  const match = /^\/attachments\/(0|[1-9]\d*)\/url$/.exec(path);
  if (kind === 'DIARY_ENTRY' && match) {
    const item = (payload.attachments as Array<{ url: string }>)[
      Number(match[1])
    ];
    if (!item) fail();
    item.url = value;
    return;
  }
  fail();
}

function destinationUrl(key: string, urls: ArchiveProjectionUrls): string {
  const value = urls.urlForKey(key);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    urls.keyFromUrl(value) !== key
  )
    fail();
  return value;
}

/** Local candidate ONLY. No session, control check, S3, consumption, publication or business write. */
export function buildArchiveRecipientProjection(
  archive: OwnershipArchive,
  entries: readonly ArchiveEntry[],
  files: readonly ArchiveFile[],
  registrations: readonly ArchiveMediaRegistration[],
  urls: ArchiveProjectionUrls,
): ArchiveRecipientProjection {
  const reservationEpoch = archiveReservationEpoch(archive);
  assertMediaRegistrationArchive(archive);
  if (archive.history) {
    new Uuid(archive.history.sourceArchiveId);
    if (
      archive.history.sourceArchiveId === archive.id ||
      !digest(archive.history.sourceDefinitionHash) ||
      !Number.isSafeInteger(archive.history.expectedEntryCount) ||
      archive.history.expectedEntryCount < 1 ||
      !Number.isSafeInteger(archive.history.expectedFileCount) ||
      archive.history.expectedFileCount < 0
    )
      fail();
  }
  unique(entries, (entry) => entry.id);
  const fileMap = unique(files, (file) => file.id);
  unique(files, (file) => file.sourceKey);
  const registry = unique(registrations, (record) => record.fileId);
  unique(registrations, (record) => record.id);
  unique(registrations, (record) => record.key);
  const ordered = [...entries].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const retained = entries.filter((entry) => entry.kind === 'RETAINED_RECORD');
  if (
    entries.length !== archive.expectedEntryCount ||
    files.length !== archive.expectedFileCount ||
    registrations.length !== files.length ||
    entries.filter((entry) => entry.kind === 'ANIMAL').length !== 1 ||
    archive.referencePlan!.afterId !== ordered[ordered.length - 1]?.id ||
    retained.length !== (archive.history?.expectedEntryCount ?? 0) ||
    files.filter((file) => file.retained !== undefined).length !==
      (archive.history?.expectedFileCount ?? 0)
  )
    fail();

  const media = new Map<string, ArchiveMediaRegistration>();
  // Validate the ENTIRE set before rendering recipient URLs or constructing payloads.
  const plans = ordered.map((entry) => {
    const selected = [
      ...new Set(entry.fileBindings.map((binding) => binding.fileId)),
    ].map((id) => fileMap.get(id) ?? fail());
    const plan = buildArchiveEntryReferencePlan(
      archive,
      entry,
      selected,
      (url) => urls.keyFromUrl(url),
    );
    if (archiveHash(entry.referencePlan) !== archiveHash(plan)) fail();
    const root = entry.retained;
    if (
      root &&
      (root.sourceArchiveId !== archive.history?.sourceArchiveId ||
        root.resourceId !== entry.payload.id ||
        root.rootEntryId !==
          archiveHash([root.rootArchiveId, root.kind, root.resourceId]) ||
        !digest(root.sourceEntryId) ||
        !digest(root.sourceContentHash))
    )
      fail();
    for (const file of selected) {
      const expected = buildArchiveMediaRegistration(archive, file, plan);
      const stored = registry.get(file.id);
      if (!stored) fail();
      assertSameMediaRegistration(stored!, expected);
      const previous = media.get(file.id);
      if (previous) assertSameMediaRegistration(previous, expected);
      media.set(file.id, expected);
    }
    return plan;
  });
  if (media.size !== files.length) fail(); // No orphan files or unreferenced registrations.

  const projected = ordered.map(
    (entry, index): ArchiveRecipientEntryProjection => {
      const plan = plans[index];
      const payload = structuredClone(entry.payload);
      const kind =
        entry.retained?.kind ?? (entry.kind as ArchiveRecordInput['kind']);
      if (plan.ownerChange) payload.ownerId = plan.ownerChange.to;
      for (const binding of plan.bindings) {
        const key = media.get(binding.fileId)!.key;
        replaceReference(
          payload,
          kind,
          binding.path,
          binding.format === 'KEY' ? key : destinationUrl(key, urls),
        );
      }
      return {
        entryId: entry.id,
        resourceId: entry.resourceId,
        kind: entry.kind,
        sourceKind: kind,
        mode: plan.mode,
        sourceContentHash: entry.contentHash,
        sourcePlanHash: plan.planHash,
        ...(entry.retained
          ? { retained: structuredClone(entry.retained) }
          : {}),
        payload,
        references: plan.bindings.map((binding) => ({
          path: binding.path,
          format: binding.format,
          fileId: binding.fileId,
          registrationId: media.get(binding.fileId)!.id,
        })),
      };
    },
  );
  const definition: Omit<ArchiveRecipientProjection, 'projectionHash'> = {
    protocol: ARCHIVE_RECIPIENT_PROJECTION_PROTOCOL,
    definition: archiveDefinitionOnly(archive),
    reservationHash: archive.reservation!.bindingHash,
    reservationEpoch,
    referencePlanHash: archiveHash(archive.referencePlan),
    materializationDefinitionHash: archive.materialization!.definitionHash,
    entries: projected,
    media: [...media.values()].sort((a, b) =>
      a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0,
    ),
  };
  return { ...definition, projectionHash: archiveHash(definition) };
}
