import { ConflictError } from '../../shared/domain/errors/ConflictError';
import { archiveHash } from './ownership-archive';
import type { PublishedHistoryFinalMediaRegistration } from './ownership-archive-media-registration';
import type { PublishedHistoryRecipientEntryProjection } from './ownership-archive-recipient-projection';
import type { PublishedHistoryStableCutConsumption } from './transfer-item-stable-cut-evidence';

export function buildPublishedHistoryRetainedReferences(
  consumption: PublishedHistoryStableCutConsumption,
  entries: readonly PublishedHistoryRecipientEntryProjection[],
  media: readonly PublishedHistoryFinalMediaRegistration[],
) {
  const invalid = () =>
    new ConflictError(
      'The retained references do not match the consumed projection',
    );
  const registrations = new Map(media.map((record) => [record.fileId, record]));
  const entryIds = new Set<string>();
  const referenced = new Set<string>();
  const { archiveId, binding } = consumption;
  if (registrations.size !== media.length || !entries.length) throw invalid();
  const records = entries.map((entry) => {
    if (
      entry.kind !== 'RETAINED_RECORD' ||
      entry.mode !== 'RETAINED_READ_ONLY' ||
      entry.retained.sourceArchiveId !== binding.sourceArchiveId ||
      entry.retained.sourcePublicationHash !== binding.publicationHash ||
      entryIds.has(entry.entryId)
    )
      throw invalid();
    entryIds.add(entry.entryId);
    const references = entry.references.map((reference) => {
      const registration = registrations.get(reference.fileId);
      if (
        !registration ||
        registration.id !== reference.registrationId ||
        registration.archiveId !== archiveId ||
        registration.mode !== 'RETAINED_READ_ONLY'
      )
        throw invalid();
      referenced.add(reference.fileId);
      return Object.freeze({
        ...reference,
        registrationDefinitionHash: registration.definitionHash,
      });
    });
    const facts = {
      protocol: 'PUBLISHED_HISTORY_RETAINED_REFERENCES_V1' as const,
      mode: entry.mode,
      archiveId,
      entryId: entry.entryId,
      sourceContentHash: entry.sourceContentHash,
      consumptionHash: consumption.definitionHash,
      references: Object.freeze(references),
    };
    return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
  });
  if (referenced.size !== registrations.size) throw invalid();
  return records;
}

export type PublishedHistoryRetainedReferences = ReturnType<
  typeof buildPublishedHistoryRetainedReferences
>[number];

export function buildPublishedHistoryRetainedReferencesReceipt(
  consumption: PublishedHistoryStableCutConsumption,
  references: readonly PublishedHistoryRetainedReferences[],
  fileCount: number,
) {
  const protocol = 'PUBLISHED_HISTORY_RETAINED_REFERENCES_RECEIPT_V1' as const;
  const referencesDigest = references.reduce(
    (previous, { entryId, definitionHash }) =>
      archiveHash({ previous, entryId, definitionHash }),
    archiveHash([protocol, 'ENTRIES']),
  );
  const facts = {
    protocol,
    archiveId: consumption.archiveId,
    consumptionHash: consumption.definitionHash,
    binding: consumption.binding,
    scopeHash: consumption.scopeHash,
    accreditationHash: consumption.accreditationHash,
    entryCount: references.length,
    fileCount,
    referencesDigest,
    recordedAt: consumption.consumedAt,
  };
  return Object.freeze({ ...facts, definitionHash: archiveHash(facts) });
}

export type PublishedHistoryRetainedReferencesReceipt = ReturnType<
  typeof buildPublishedHistoryRetainedReferencesReceipt
>;
