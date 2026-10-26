import {
  ArchiveRecordInput,
  OwnershipArchive,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  buildArchiveMaterialization,
  buildArchiveMaterializationIntent,
} from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import {
  ARCHIVE_REFERENCE_PLAN_PROTOCOL,
  buildArchiveEntryReferencePlan,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
import { buildArchiveMediaRegistration } from '../../../src/context/animal-transfer/domain/ownership-archive-media-registration';
import { buildRetainedArchiveEntry } from '../../../src/context/animal-transfer/domain/ownership-archive-history';
import {
  archiveAnimal,
  archiveMedicalDocument,
} from './ownership-archive.fixture';
import {
  historyArchive,
  historyClone,
  historyKeyFromUrl,
  historyRecord,
} from './ownership-archive-history.fixture';

export const registrationFixture = (
  kind: 'PROFILE' | 'DIARY' | 'MEDICAL' | 'RETAINED' = 'MEDICAL',
  versioned = true,
) => {
  const archive = historyArchive(kind === 'RETAINED' ? 2 : 1);
  archive.state = 'READY';
  archive.expectedEntryCount = 1;
  archive.expectedFileCount = 1;
  const input: ArchiveRecordInput =
    kind === 'PROFILE'
      ? {
          kind: 'ANIMAL',
          data: {
            ...archiveAnimal,
            profilePictureUrl: `https://test/users/${archive.ownerId}/animals/${archive.animalId}/profile_123.png`,
          },
        }
      : kind === 'DIARY'
        ? {
            kind: 'DIARY_ENTRY',
            data: {
              id: 'diary',
              animalId: archive.animalId,
              title: 'audio',
              content: 'note',
              date: '2026-10-25',
              createdAt: '2026-10-25',
              updatedAt: '2026-10-25',
              attachments: [
                {
                  id: 'audio',
                  url: `https://test/users/${archive.ownerId}/animals/${archive.animalId}/diary/diary/audio.mp3`,
                  fileName: 'audio.mp3',
                  fileType: 'audio',
                  mimeType: 'audio/mpeg',
                  size: 12,
                  createdAt: '2026-10-25',
                },
              ],
            },
          }
        : { kind: 'MEDICAL_DOCUMENT', data: archiveMedicalDocument() };
  let record: ReturnType<typeof historyRecord>;
  if (kind === 'RETAINED') {
    const source: OwnershipArchive = {
      ...historyArchive(1),
      state: 'READY',
      expectedEntryCount: 1,
      expectedFileCount: 1,
    };
    const original = historyRecord(source, input);
    archive.history = {
      sourceArchiveId: source.id,
      sourceDefinitionHash: source.definitionHash,
      expectedEntryCount: 1,
      expectedFileCount: 1,
      revision: 1,
      phase: 'COMPLETE',
      entryCount: 1,
    };
    record = buildRetainedArchiveEntry(
      archive,
      source,
      original.entry,
      original.files,
      historyKeyFromUrl,
    );
    record.files[0].state = 'VERIFIED';
    record.files[0].verified = historyClone(original.files[0].verified!);
  } else record = historyRecord(archive, input);
  const { entry, files } = record;
  const file = files[0];
  if (!versioned) delete file.verified!.recipientStaging.versionId;
  archive.referencePlan = {
    protocol: ARCHIVE_REFERENCE_PLAN_PROTOCOL,
    definitionHash: archive.definitionHash,
    phase: 'PLANNED',
    revision: 1,
    afterId: entry.id,
    entryCount: 1,
  };
  entry.referencePlan = buildArchiveEntryReferencePlan(
    archive,
    entry,
    files,
    historyKeyFromUrl,
  );
  archive.materialization = buildArchiveMaterialization(
    archive,
    ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  );
  const intent = buildArchiveMaterializationIntent(
    archive,
    file,
    entry.referencePlan,
  );
  file.materialization = {
    intent,
    state: 'VERIFIED',
    verified: {
      etag: 'final',
      size: 12,
      ...(versioned ? { versionId: 'final-v1' } : {}),
    },
  };
  archive.materialization.phase = 'MATERIALIZED';
  const registration = buildArchiveMediaRegistration(
    archive,
    file,
    entry.referencePlan,
  );
  return { archive, file, entry, intent, registration };
};
