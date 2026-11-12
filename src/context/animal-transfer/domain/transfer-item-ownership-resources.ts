import { ConflictError } from '../../shared/domain/errors/ConflictError';
import {
  ArchiveDefinition,
  ArchiveRecordInput,
  archiveHash,
  buildArchiveEntry,
} from './ownership-archive';
import type { ItemRecipientFinalMediaRegistration } from './ownership-archive-media-registration';
import {
  ArchiveProjectionUrls,
  ItemRecipientEntryProjection,
  projectItemRecipientEntries,
} from './ownership-archive-recipient-projection';

/** Only the fields the ownership transaction may change on live resources. */
export type ItemOwnershipResourceChange = Readonly<
  { id: string; sourceContentHash: string } & (
    | {
        kind: 'ANIMAL';
        ownerId: string;
        profilePictureUrl?: string;
      }
    | {
        kind: 'DIARY_ENTRY';
        attachmentUrls: readonly string[];
      }
    | {
        kind: 'MEDICAL_DOCUMENT';
        ownerId: string;
        storageKey: string;
      }
  )
>;

export function itemOwnershipResourceChange(
  definition: ArchiveDefinition,
  live: ArchiveRecordInput,
  candidate: ItemRecipientEntryProjection | undefined,
  media: ReadonlyMap<string, ItemRecipientFinalMediaRegistration>,
  urls: ArchiveProjectionUrls,
): ItemOwnershipResourceChange {
  const { entry } = buildArchiveEntry(definition, live, (url) =>
    urls.keyFromUrl(url),
  );
  if (candidate?.sourceContentHash !== entry.contentHash)
    throw new ConflictError(
      'A live transfer resource differs from the sealed capture',
    );

  const registrations = [
    ...new Set(entry.fileBindings.map((b) => b.fileId)),
  ].map((fileId) => {
    const record = media.get(fileId);
    if (!record)
      throw new ConflictError('A live transfer resource has no prepared media');
    return record;
  });
  const [projected] = projectItemRecipientEntries(
    definition,
    [entry],
    registrations,
    urls,
  );
  if (archiveHash(projected) !== archiveHash(candidate))
    throw new ConflictError(
      'A live transfer resource does not reproduce the selected projection',
    );

  const resource = {
    id: entry.resourceId,
    sourceContentHash: entry.contentHash,
  };
  switch (live.kind) {
    case 'ANIMAL':
      return Object.freeze({
        ...resource,
        kind: live.kind,
        ownerId: definition.recipientId,
        ...(entry.fileBindings.length
          ? { profilePictureUrl: projected.payload.profilePictureUrl as string }
          : {}),
      });
    case 'DIARY_ENTRY':
      return Object.freeze({
        ...resource,
        kind: live.kind,
        attachmentUrls: Object.freeze(
          (projected.payload.attachments as Array<{ url: string }>).map(
            ({ url }) => url,
          ),
        ),
      });
    case 'MEDICAL_DOCUMENT':
      return Object.freeze({
        ...resource,
        kind: live.kind,
        ownerId: definition.recipientId,
        storageKey: projected.payload.storageKey as string,
      });
  }
}
