import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  buildArchiveMaterialization,
  buildArchiveMaterializationIntent,
} from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import { buildArchiveMediaRegistration } from '../../../src/context/animal-transfer/domain/ownership-archive-media-registration';
import { buildArchiveEntryReferencePlan } from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
import {
  archiveDefinitionOnly,
  buildArchiveReservation,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import {
  historyKeyFromUrl,
  historyRecord,
  historyUuid,
} from './ownership-archive-history.fixture';
import { metadataRevalidationFixture } from './ownership-archive-metadata-revalidation.fixture';

export const projectionUrls = {
  keyFromUrl: historyKeyFromUrl,
  urlForKey: (key: string) => `https://test/${key}`,
};

/** Synthetic complete set, including shared references and an optional return to A. */
export function recipientProjectionFixture(
  retained = false,
  returning = false,
) {
  const s = metadataRevalidationFixture(1, true, retained);
  const diary = historyRecord(s.archive, {
    kind: 'DIARY_ENTRY',
    data: {
      id: 'diary',
      animalId: s.archive.animalId,
      title: 'Opaque diary text',
      content: 'Do not interpret or rewrite source content',
      date: '2020-01-01',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      attachments: [
        {
          id: 'photo',
          url: s.entries.find((e) => e.kind === 'ANIMAL')!.payload
            .profilePictureUrl as string,
          fileName: 'profile.png',
          mimeType: 'image/png',
          size: 12,
          fileType: 'image',
          createdAt: '2026-01-01',
        },
        ...['audio-1', 'audio-2'].map((id) => ({
          id,
          url: `https://test/users/${s.archive.ownerId}/animals/${s.archive.animalId}/diary/diary/audio.mp3`,
          fileName: 'audio.mp3',
          mimeType: 'audio/mpeg',
          size: 12,
          fileType: 'audio',
          createdAt: '2026-01-01',
        })),
      ],
    },
  });
  s.entries.push(diary.entry);
  for (const file of diary.files)
    if (!s.files.some((existing) => existing.id === file.id))
      s.files.push(file);
  if (returning) {
    const previous = s.archive.recipientId;
    s.archive.recipientId = historyUuid(1);
    s.archive.definitionHash = archiveHash(archiveDefinitionOnly(s.archive));
    s.archive.referencePlan!.definitionHash = s.archive.definitionHash;
    s.archive.reservation = buildArchiveReservation(s.archive, 1);
    for (const file of s.files) {
      file.recipientStagingKey = file.recipientStagingKey.replace(
        `users/${previous}/`,
        `users/${s.archive.recipientId}/`,
      );
      file.recipientFinalKey = file.recipientFinalKey.replace(
        `users/${previous}/`,
        `users/${s.archive.recipientId}/`,
      );
      file.definitionHash = archiveHash({
        id: file.id,
        archiveId: file.archiveId,
        sourceKey: file.sourceKey,
        relativeKey: file.relativeKey,
        historicalKey: file.historicalKey,
        recipientStagingKey: file.recipientStagingKey,
        recipientFinalKey: file.recipientFinalKey,
        source: file.source,
        ...(file.retained ? { retained: file.retained } : {}),
      });
    }
  }
  s.entries.sort((a, b) => a.id.localeCompare(b.id));
  s.files.sort((a, b) => a.id.localeCompare(b.id));
  s.archive.expectedEntryCount = s.entries.length;
  s.archive.expectedFileCount = s.files.length;
  s.archive.referencePlan!.entryCount = s.entries.length;
  s.archive.referencePlan!.afterId = s.entries[s.entries.length - 1].id;
  for (const entry of s.entries)
    entry.referencePlan = buildArchiveEntryReferencePlan(
      s.archive,
      entry,
      s.files.filter((file) =>
        entry.fileBindings.some((b) => b.fileId === file.id),
      ),
      historyKeyFromUrl,
    );
  s.archive.materialization = buildArchiveMaterialization(
    s.archive,
    ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  );
  for (const file of s.files) {
    const plan = s.entries.find((entry) =>
      entry.fileBindings.some((b) => b.fileId === file.id),
    )!.referencePlan!;
    file.materialization = {
      state: 'VERIFIED',
      intent: buildArchiveMaterializationIntent(s.archive, file, plan),
      verified: {
        etag: `final-${file.id}`,
        size: 12,
        versionId: `version-${file.id}`,
      },
    };
  }
  s.archive.materialization.phase = 'MATERIALIZED';
  s.registrations = s.files.map((file) =>
    buildArchiveMediaRegistration(
      s.archive,
      file,
      s.entries.find((entry) =>
        entry.fileBindings.some((b) => b.fileId === file.id),
      )!.referencePlan!,
    ),
  );
  return s;
}
