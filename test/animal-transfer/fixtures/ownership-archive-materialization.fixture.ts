import {
  buildArchiveMaterialization,
  buildArchiveMaterializationIntent,
} from '../../../src/context/animal-transfer/domain/ownership-archive-materialization';
import {
  ARCHIVE_REFERENCE_PLAN_PROTOCOL,
  buildArchiveEntryReferencePlan,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reference-plan';
import { archiveMedicalDocument } from './ownership-archive.fixture';
import {
  historyArchive,
  historyKeyFromUrl,
  historyRecord,
} from './ownership-archive-history.fixture';

export const materializationFixture = (sha256?: string, versioned = true) => {
  const archive = historyArchive(1);
  archive.state = 'READY';
  archive.expectedEntryCount = 1;
  archive.expectedFileCount = 1;
  const { entry, files } = historyRecord(archive, {
    kind: 'MEDICAL_DOCUMENT',
    data: archiveMedicalDocument(),
  });
  const file = files[0];
  if (sha256) file.verified!.sha256 = sha256;
  if (!versioned) delete file.verified!.recipientStaging.versionId;
  archive.referencePlan = {
    protocol: ARCHIVE_REFERENCE_PLAN_PROTOCOL,
    definitionHash: archive.definitionHash,
    phase: 'PLANNED',
    revision: 1,
    entryCount: 1,
    afterId: entry.id,
  };
  entry.referencePlan = buildArchiveEntryReferencePlan(
    archive,
    entry,
    files,
    historyKeyFromUrl,
  );
  archive.materialization = buildArchiveMaterialization(archive);
  const intent = buildArchiveMaterializationIntent(
    archive,
    file,
    entry.referencePlan,
  );
  return { archive, entry, file, intent };
};
