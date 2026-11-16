import { randomUUID } from 'node:crypto';
import {
  LocalMongoTestSettings,
  readLocalMongoTestSettings,
  WriteTestNamespace,
  WRITE_TEST_MARKER,
} from './local-mongo-test-safety';

export const EVIDENCE_TEST_DB_PREFIX = 'animalrecord_evidence_test_';
export const EVIDENCE_TEST_COLLECTIONS = [
  WRITE_TEST_MARKER,
  'animal_ownership_controls',
  'animal_ownership_periods',
  'animal_ownership_archives',
  'animal_ownership_archive_entries',
  'animal_ownership_archive_files',
  'animal_transferred_media',
  'animal_archive_metadata_revalidations',
  '_synthetic_joint_writes',
] as const;

export function readArchiveEvidenceMongoSettings(
  env: NodeJS.ProcessEnv,
): LocalMongoTestSettings {
  if (env.ARCHIVE_EVIDENCE_MONGO_TESTS !== '1')
    throw new Error(
      'Archive evidence integration is opt-in: ARCHIVE_EVIDENCE_MONGO_TESTS=1 is required',
    );
  // Reuse the strict loopback URI parser, never the journal opt-in or app env.
  return readLocalMongoTestSettings({
    ANIMAL_WRITE_MONGO_TESTS: '1',
    ANIMAL_WRITE_MONGO_TEST_URI: env.ARCHIVE_EVIDENCE_MONGO_TEST_URI,
  });
}

export function createEvidenceTestNamespace(): WriteTestNamespace {
  const runId = randomUUID();
  return Object.freeze({
    runId,
    databaseName: EVIDENCE_TEST_DB_PREFIX + runId.replace(/-/g, ''),
  });
}

export function assertOwnedEvidenceTestDatabase(
  namespace: WriteTestNamespace,
  databaseName: string,
  markerRunId: unknown,
  collections: string[],
): void {
  if (
    !/^animalrecord_evidence_test_[a-f0-9]{32}$/.test(namespace.databaseName) ||
    namespace.databaseName !==
      EVIDENCE_TEST_DB_PREFIX + namespace.runId.replace(/-/g, '') ||
    databaseName !== namespace.databaseName ||
    markerRunId !== namespace.runId ||
    !collections.includes(WRITE_TEST_MARKER) ||
    collections.some(
      (name) =>
        !(EVIDENCE_TEST_COLLECTIONS as readonly string[]).includes(name),
    )
  )
    throw new Error(
      'Disposable evidence database ownership could not be verified; cleanup refused',
    );
}
