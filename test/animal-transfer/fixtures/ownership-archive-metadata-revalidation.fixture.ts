import {
  ArchiveEntry,
  ArchiveFile,
  archiveHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  buildArchiveMaterialization,
  buildArchiveMaterializationIntent,
} from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import { buildArchiveMediaRegistration } from '../../../src/context/animal-transfer/domain/ownership-archive-media-registration';
import {
  ARCHIVE_REFERENCE_PLAN_PROTOCOL,
  buildArchiveEntryReferencePlan,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
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

export function metadataRevalidationFixture(
  medicalCount = 2,
  profileFile = true,
  retained = false,
) {
  const archive = historyArchive(retained ? 2 : 1);
  const profile = historyRecord(archive, {
    kind: 'ANIMAL',
    data: {
      ...archiveAnimal,
      ownerId: archive.ownerId,
      ...(profileFile
        ? {
            profilePictureUrl: `https://test/users/${archive.ownerId}/animals/${archive.animalId}/profile_123.png`,
          }
        : {}),
    },
  });
  const entries: ArchiveEntry[] = [profile.entry];
  const files: ArchiveFile[] = [...profile.files];
  for (let i = 0; i < medicalCount; i++) {
    const document = archiveMedicalDocument(`document-${i}`);
    document.storageKey = document.storageKey.replace(
      document.ownerId,
      archive.ownerId,
    );
    document.documentLocations![0].storageKey = document.storageKey;
    document.ownerId = archive.ownerId;
    const record = historyRecord(archive, {
      kind: 'MEDICAL_DOCUMENT',
      data: document,
    });
    entries.push(record.entry);
    files.push(...record.files);
  }
  if (retained) {
    const source = historyArchive(1);
    const record = historyRecord(source, {
      kind: 'MEDICAL_DOCUMENT',
      data: archiveMedicalDocument('older-document'),
    });
    const inherited = buildRetainedArchiveEntry(
      archive,
      source,
      record.entry,
      record.files,
      historyKeyFromUrl,
    );
    inherited.files[0].state = 'VERIFIED';
    inherited.files[0].verified = historyClone(record.files[0].verified!);
    entries.push(inherited.entry);
    files.push(...inherited.files);
    archive.history = {
      sourceArchiveId: source.id,
      sourceDefinitionHash: source.definitionHash,
      expectedEntryCount: 1,
      expectedFileCount: 1,
      phase: 'COMPLETE',
      revision: 1,
      entryCount: 1,
    };
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  files.sort((a, b) => a.id.localeCompare(b.id));
  archive.state = 'READY';
  archive.expectedEntryCount = entries.length;
  archive.expectedFileCount = files.length;
  archive.referencePlan = {
    protocol: ARCHIVE_REFERENCE_PLAN_PROTOCOL,
    definitionHash: archive.definitionHash,
    phase: 'PLANNED',
    revision: 1,
    entryCount: entries.length,
    afterId: entries[entries.length - 1].id,
  };
  for (const entry of entries)
    entry.referencePlan = buildArchiveEntryReferencePlan(
      archive,
      entry,
      files.filter((file) =>
        entry.fileBindings.some((binding) => binding.fileId === file.id),
      ),
      historyKeyFromUrl,
    );
  archive.materialization = buildArchiveMaterialization(
    archive,
    ARCHIVE_GENERATIONAL_MATERIALIZATION_PROTOCOL,
  );
  for (const file of files) {
    const entry = entries.find((entry) =>
      entry.fileBindings.some((binding) => binding.fileId === file.id),
    )!;
    file.materialization = {
      state: 'VERIFIED',
      intent: buildArchiveMaterializationIntent(
        archive,
        file,
        entry.referencePlan!,
      ),
      verified: {
        etag: `final-${file.id}`,
        size: 12,
        versionId: `version-${file.id}`,
      },
    };
  }
  archive.materialization.phase = 'MATERIALIZED';
  const registrations = files.map((file) =>
    buildArchiveMediaRegistration(
      archive,
      file,
      entries.find((entry) =>
        entry.fileBindings.some((binding) => binding.fileId === file.id),
      )!.referencePlan!,
    ),
  );
  const control = {
    animalId: archive.animalId,
    ownerId: archive.ownerId,
    ownershipVersion: archive.ownershipVersion,
    transferLock: {
      transferId: archive.transferId,
      lockedAt: '2026-10-25T12:00:00.000Z',
    },
    activeWrites: [],
    archiveMaterializationRevision: 40,
  };
  return {
    archive,
    entries,
    files,
    registrations,
    control,
    initialDigest: archiveHash([]),
  };
}
